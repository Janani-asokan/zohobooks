# Inter-branch stock transfers

Stock moves between branches by batch. The destination is priced by location and seasonal rules, and the receipt is confirmed with a code emailed to the destination branch's manager.

| Piece | Where |
| --- | --- |
| Rules: pricing, receipt check, cost averaging, OTP limits | `shared/transfers.ts` (unit tests in `shared/transfers.test.ts`) |
| Schema | `server/migrations/031_branch_transfers.sql` |
| Service: initiate, OTP, verify, cancel | `server/src/services/transfers.ts` |
| API | `server/src/routes/shop/transfers.ts` |
| Billing uses branch and batch prices | `buildLines` in `server/src/services/documents.ts`, `useBranchItems` in `src/api/hooks.ts` |
| Screens | `src/pages/app/Transfers.tsx` (form + OTP dialog), `TransferNote.tsx`, `BranchPricing.tsx`, `Warehouses.tsx` |
| Integration tests | `server/test/transfers.test.ts` |

## 1. Schema

| Requested table | Table here | What it holds |
| --- | --- | --- |
| ProductBatches | `item_batches`, extended | `batch_no`, `qty`, `expiry_date`, and new `unit_cost` (purchase cost, weighted-averaged when the same batch arrives again), `received_on`, `season`, `origin_branch_id`, `selling_price` (this branch's price for the batch) |
| (branch price) | `item_stock.selling_price` | The branch's price for items billed without naming a batch |
| BranchPricingRules | `branch_pricing_rules` | `kind` (location or seasonal), `branch_id` (null = all), `item_id` or `category`, `adjust_type` (percent or amount), `adjust_value`, `starts_on` / `ends_on` (seasonal), `priority`, `round_to`, `active` |
| StockTransfers | `stock_transfers`, extended | Status `Draft`, `In transit`, `Received` or `Cancelled`; `dispatched_at`, `received_at`, `received_by` and name, `verified_via` (otp, owner_override, before_otp), `override_reason`, `discrepancy_note`, `loss_value`, `eway_bill_no`, `vehicle_no`, `cancelled_at` |
| StockTransferItems | `stock_transfer_items` | One row per item and batch: `qty_sent`, `qty_received`, `qty_damaged`, `qty_missing` (CHECK: they add up), `unit_cost`, `source_price`, `dest_price`, `dest_price_applied`, `manual_price`, `price_rules` (the rules used), `hsn`, `tax_rate`, `serials` |
| TransferOTPLogs | `transfer_otps` + `transfer_otp_logs` | `transfer_otps` holds one row per code: the salted SHA-256 hash (never the code), recipient, `attempts`, `expires_at`, `used_at`, `superseded_at`. `transfer_otp_logs` is append-only, with one row per event: sent, resent, send_failed, verify_failed, expired, locked, verified, owner_override or cancelled, plus who, IP and when. |
| (branches) | `branches`, extended | `gstin`, `state`, `manager_user_id` (who gets the code) |

- **Same-shop references.** Every new link is a composite `(shop_id, id)` foreign key, so a row can't point into another shop.
- **No cascading deletes.** References are `RESTRICT` or `SET NULL`.
- **Row-level security.** All new tables have forced RLS and the backup policy.
- **Existing data.** The migration copies transfers saved in the old JSON format into `stock_transfer_items`, one row per batch, and gives existing batches the item's cost.
  - It does this shop by shop with `app.shop_id` set. Row-level security is forced even for the migration's database role, so a plain `UPDATE` on the live server would have changed nothing.
  - This was tested with a database user that can't bypass row-level security.

## 2. State machine

```
Draft ──initiate──► In transit (pending OTP) ──verify OTP──► Received (verified & completed)
  │                   │   ▲  │                                ▲
  │                   │   └──┘ resend: new code, old void     │ owner override (reason, audited)
  └──cancel           └──cancel──► Cancelled (units back in the source batch, code void)
```

| From | Action | Who | Effect |
| --- | --- | --- | --- |
| (new) | Save draft | items.write | Nothing moves |
| Draft or new | Initiate | items.write, at the source branch | Batch stock checked under a row lock and taken from the source batch. Lines are priced for the destination. A code is emailed. The destination stock is unchanged. |
| In transit | Verify receipt | items.write, at the destination, **not the sender** | Code checked. What arrived is added at the destination under the same batch, cost and price. Damaged and missing units are recorded as a loss. |
| In transit | Owner receive | Owner only, with a reason | Same as verify, recorded as an override |
| In transit or Draft | Cancel | The source branch | Units go back into the batch they came from |

The sender can't confirm their own transfer. The one exception is a shop with a single active user, who would otherwise have nobody to confirm it.

## 3. API (`/api/shop`)

| Endpoint | Purpose |
| --- | --- |
| `POST /transfers/initiate` | `{transferId}` sends a draft; or send a full `{fromBranchId, toBranchId, date, lines:[{itemId, batchNo, qty, destPrice?}], vehicleNo, ewayBillNo}` |
| `POST /transfers/resend-otp` | `{transferId}`: new code, the old one stops working, 60 s between sends, at most 6 a day |
| `POST /transfers/verify-receipt` | `{transferId, otp, lines?:[{lineId, received, damaged, missing}], note}` |
| `POST /transfers/owner-receive` | `{transferId, reason, lines?, note}` |
| `POST /transfers/price-preview` | Destination price, rules used, batch cost and code recipient, for the form |
| `GET/POST /stock/transfers`, `GET/PUT /stock/transfers/:id`, `POST /stock/transfers/:id/cancel` | List, draft or create, detail (with code state and log), edit draft, cancel |
| `GET /stock/batches?itemId&branchId`, `PATCH /stock/batches/:id` | Batches to pick from; edit season or price |
| `GET /stock/branch-prices?branchId` | Prices that billing screens pre-fill |
| `GET/POST/PATCH/DELETE /pricing-rules` | Location and seasonal rules |

### Business rules in code

- **Insufficient batch stock.** `planLines` locks the batch row and refuses more than it holds (`400 insufficient_batch_stock`, with the available quantity).
  - Two lines of the same batch count together.
  - A batch-tracked item must name a batch.
  - The item's branch total is checked too.
  - Existing `moveStock` quietly took less than asked when a named batch ran short, so the check happens before any stock moves.
- **Destination price.** It starts from the item's standard price, not the source branch's price, so chained transfers don't stack modifiers. Location rules apply first, then seasonal rules running that day, each in priority order. A percent rule multiplies and an amount rule adds. The result is never below zero and is rounded to the largest step among the rules used.
  - The sender may type a price by hand; it is recorded as "manual".
  - On receipt the price is recalculated with the rules on the day of receipt (unless it was set by hand), stored on the batch and the branch, and used by billing.
  - The batch's purchase cost is never changed by pricing, so profit stays honest.
- **Code generation and storage.** 6 digits from `crypto.randomInt`. The database stores `salt:sha256(salt:id:code:OTP_PEPPER)`, and the check uses a timing-safe comparison.
- **Code limits.** A code expires after 15 minutes and locks after 3 wrong tries. A new code voids the previous one, and a code works only once.
- **Wrong codes are counted even though the request fails.** The handler returns the 400/423 itself, so the transaction commits the attempt count; throwing would roll it back and allow unlimited tries.
- **Code delivery.**
  - The code is only in the email body: subjects show on lock screens and are written to server logs.
  - The sender's screen shows the masked recipient (`ma•••••@shop.com`) and says plainly if the email didn't go out.

## 4. Screens

**Transfer creation form** (Inventory → Transfers → New transfer):

1. **Route:** from (fixed to their own branch for branch staff), to, date, vehicle number, e-way bill number. The e-way bill is flagged when the value is over ₹50,000.
2. **Items:** item, then a batch picker showing quantity, expiry and season for each batch at the source. Quantity is checked against the batch as you type. Each line shows the cost per unit ("kept on the batch") and the price at the destination with the rules that produced it; the price can be typed over. A price below cost shows a warning.
3. **Review:** value at cost, who gets the code (masked email), code validity. Then **Save draft** or **Initiate stock transfer**. The confirmation says where the code went, or that the email failed and what to do.

**Destination confirmation dialog** (the To receive tab, the bell, or the link in the email):

- A table of what was sent: item, batch, expiry, quantity and the price at the destination.
- **Report damaged or missing items** shows damaged and missing columns per line, works out the received quantity, and asks what happened.
- **Receipt code** shows where it was sent, a live expiry countdown, tries left, a 6-digit input (`autocomplete="one-time-code"`), and **Resend code** with a countdown.
- **Verify & receive** completes it. An owner can choose "Receive without the code" and must give a reason.
- **Code history** lists every send, failed try and verification.

**Stock Transfer Note / Delivery Challan:**

- **Contents:** batch, HSN, GST rate, quantity, cost value, destination price and rules, both branches' GSTINs, vehicle and e-way bill, the receipt outcome, and signature blocks.
- **Same GSTIN:** labelled "not a supply" (a challan under Rule 55).
- **Different GSTINs:** flagged as needing a tax invoice, with the approximate GST shown.

## 5. Edge cases

- **Partial receipt.** Received + damaged + missing must equal sent (checked in the API and by a database CHECK), and a note is required. Only received units enter stock. The loss is recorded at batch cost.
- **Serial-numbered items** must be received in full. Damaged serials are then written off one by one through an adjustment.
- **Cost when merging.** If the same batch already has stock at the destination, the cost is averaged by quantity.
- **Transfers from before OTP existed.** Ones still in transit can be received with a fresh code (Resend) or by owner override. Ones already received are labelled "before codes were used".
- **No email service.** If none is set up, codes can't be delivered. The screens say so, and the owner override keeps stock moving while the email service is fixed.
