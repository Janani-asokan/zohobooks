# Corpus360

*Billing and stock, without the paperwork.*

A multi-tenant GST billing, inventory and accounting SaaS for Indian businesses. It covers what Zoho Books and Zoho Inventory do, with a calm, keyboard-friendly interface (Inter, ink blue, light and dark themes). Upload a PDF or photo of a bill, price list, GST certificate or receipt and the form fills itself.

| Layer | Stack |
|---|---|
| Web app | React 18, TypeScript, Vite, React Router 6, TanStack Query, lucide-react |
| API | Node 20+, Express 4, TypeScript, zod validation, bcrypt, helmet |
| Database | PostgreSQL 16 with **row-level security** per shop |
| Shared | `shared/`: tax maths, financial year, GST codes, permissions, CSV (used by both sides) |
| Tests | Vitest unit + API integration tests (supertest), Playwright smoke script |

---

## Look and feel

A warm **Rose & Sage** theme (#C75F71 rose, #F0B8B8 blush, #A2AE9D sage, #54463A cocoa) with soft gradient backgrounds, rounded cards, colourful icon tiles, big action buttons on the dashboard, picture-style upload boxes and gentle animations (switched off automatically for people who prefer reduced motion). Light and dark themes. The landing page has photo slots — see `public/img/README.md` for the photos to add.

## Quick start

```bash
# 1. PostgreSQL (once)
sudo -u postgres psql -c "CREATE ROLE ledgerly LOGIN PASSWORD 'ledgerly' CREATEDB;"
sudo -u postgres createdb -O ledgerly ledgerly
sudo -u postgres createdb -O ledgerly ledgerly_test     # for npm test

# 2. App
npm install
npm run db:seed     # creates the schema + demo data (wipes the database!)
npm run dev         # API on :4000, web on http://localhost:5173 (proxied)
```

| Demo account | Email | Password |
|---|---|---|
| Shop owner | owner@shop.com | owner123 |
| Super admin | admin@ledgerly.in | admin123 |
| Manager / Sales staff / Accountant / Warehouse | manager@ / sales@ / accounts@ / warehouse@shop.com | manager123 / sales123 / accounts123 / warehouse123 |
| Loan collector | collector@shop.com | collector123 |

There's no role picker on the login page: the server works out who you are from your account.

### Deploy to Render (free, one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Janani-asokan/zohobooks)

The `render.yaml` blueprint creates a PostgreSQL database and the web service (built from the `Dockerfile`). On first start it loads the demo shops. **Demo mode is on** (`DEMO_SIMPLE_PASSWORDS=1`): the demo shop logins use the simple passwords (`owner@shop.com` / `owner123`, …) and the login page lists them, so anyone with the link can sign in to the demo shop. The super admin is never a public demo login: it can reset any owner's password and download every shop's backup. It is left off the login page, and if it still has the demo password `admin123` it must set a new password at its next sign-in. For local testing only, `DEMO_SUPER_ADMIN=1` keeps the old behaviour. Before real use, set `DEMO_SIMPLE_PASSWORDS=0`. A fresh seed then gives the demo accounts the generated `DEMO_PASSWORD` instead; an existing database keeps the simple passwords until you change them, so change them yourself. To start with an empty platform instead, remove `SEED_DEMO` and set `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`.

Free-tier notes: the service sleeps after 15 minutes without visitors (the first request then takes about 50 seconds), and Render's free PostgreSQL expires after 30 days. Use paid plans for real shops.

### Render free plan: first visit after a quiet spell
Render's free plan stops the server after about 15 minutes without visitors; the next visit waits roughly 30–60 seconds while it starts, and the app shows "Starting up Corpus360…" meanwhile. To avoid it, upgrade the web service to a paid instance, or have a free uptime monitor (for example UptimeRobot or cron-job.org) open `https://<your-app>.onrender.com/api/health` every 10 minutes.

### Production

```bash
npm run build                      # typecheck + web build (dist/) + API bundle (server/dist)
NODE_ENV=production DATABASE_URL=postgres://… APP_URL=https://books.example.com npm start
```
In production the API serves the built web app too, so you deploy one process. Migrations run automatically on start.

| Env var | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_URL` | Public URL, used in reset links, shared invoice links and emails |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to make write requests |
| `AADHAAR_KEY` | Microfinance: encrypts borrowers’ Aadhaar numbers. Any long random string; set it once and never change it. Without it, Aadhaar entry is off |
| `BREVO_API_KEY` or `RESEND_API_KEY`, and `MAIL_FROM` | Sends password-reset, invoice, reminder and license emails over HTTPS (works on Render's free plan). See *Email* below |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP instead, where the host allows it. Without any provider, emails are not sent |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Lets shop owners renew their license online |
| `BACKUPS_ENABLED=1`, `BACKUP_DIR`, `BACKUP_KEEP` | Daily `pg_dump` backups (on by default in production) |
| `ANTHROPIC_API_KEY` | Optional. Turns on the smart reader for uploads (scanned PDFs, handwriting, messy layouts). Without it, uploads use the built-in PDF text reader and OCR |
| `AI_MODEL` | Model for the smart reader (default `claude-opus-5-5`) |
| `CHROMIUM_PATH` | Chromium used to print invoices to PDF (the Docker image sets `/usr/bin/chromium`) |
| `RENDER_ORIGIN` | Where that browser loads the print page from. Defaults to this server (`http://127.0.0.1:$PORT`) in production and Vite in development |
| `EINVOICE_API_URL`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | Reserved for direct GSP/IRP filing and the WhatsApp Business API (see below) |

---

## Security & multi-tenancy

- **Two locks on shop data.** Every shop query filters by `shop_id`, and PostgreSQL row-level security (`FORCE ROW LEVEL SECURITY`) hides other shops' rows even if a query forgets that filter. Each request runs in a transaction that sets `app.shop_id`.
- **The Super Admin console can't reach shop data.** Platform routes never set a shop context, so the database itself returns nothing from shop tables. Tests check this.
- **Passwords:** stored only as bcrypt hashes. The policy is at least 8 characters with a letter and a number. New owners and staff must change their temporary password on first sign-in.
- **Sessions:** random tokens in `httpOnly`, `SameSite=Lax` cookies; only a SHA-256 of each token is stored. "Keep me signed in" lasts 7 days, otherwise until the browser closes. A password reset or change signs out other sessions.
- **Lock-out:** 5 failed attempts lock the account for 15 minutes. Login, forgot-password and reset are rate-limited. Unknown emails get the same error and response time as wrong passwords, so attackers can't discover accounts.
- **CSRF:** write requests must carry an `X-Requested-With` header and come from an allowed origin.
- **Invoice numbering is atomic:** the counter is incremented under a row lock, so simultaneous invoices never share a number. Drafts get no number. Issued invoices can't be deleted, only cancelled (the number stays in the series) or corrected with a credit note.
- **Audit log** of every change, per shop and for the platform. **Backups** with `pg_dump`, which reads through row-level security with a read-only `backup_read` policy that only the backup job switches on. A backup is refused rather than saved incomplete, and the tests restore one on every run. Backups can't be downloaded from the console because they hold every shop's data.
- **No data is lost when features change.** Migrations only add, and never edit, drop, rename or delete. Foreign keys refuse deletes instead of cascading, records with history are archived or cancelled, and switching a module off hides it without deleting anything. Applied migrations are checksummed, only one server migrates at a time, and with backups on a backup is taken first. The rules are in [docs/DATABASE.md](docs/DATABASE.md), and `server/test/schema.test.ts` enforces them.

## Features

**Pay only for what you use.** Every shop gets core billing: GST invoices, customers, items and stock, payments, banking, and the sales, profit and GST reports. Add-ons are turned on one by one:

- quotes, orders and challans
- recurring invoices
- counter billing (POS)
- purchases and expenses
- advanced inventory
- full accounting
- Tally export and import
- field sales team
- AI assistant
- microfinance management

How it works:

- **The owner** opens *Settings → Features & add-ons* to see each add-on's price and ask for it in one tap.
- **The platform owner** sets prices and approves requests in *Console → Features & prices*, with an end date, an agreed price and a note.
- **Levels:** a feature can have levels (attendance will offer manual, face and biometric), each with its own price.
- **What is in code:** the catalogue in `shared/features.ts` says what each feature unlocks. The server blocks the API calls of features a shop doesn't have, and the app hides their menus and shows a clear "turn this on" screen.
- **Nothing is lost:** turning a feature off never deletes data, so turning it back on shows everything again. Every period is kept as history.
- **New and existing shops:** new shops get a 14-day trial of everything. Shops that existed before pay-per-feature keep every feature.

**Business templates.** At signup, or later from *Settings → Business profile*, the owner picks what the business sells. The 11 types are:

- general
- fruits & vegetables
- kirana
- supermarket
- pharmacy
- gold & silver jewellery
- steel
- hardware
- garments
- toys & games
- mobiles

The template:

- **Add-ons:** a new shop tries only that trade's add-ons, so the menus start simple.
- **Trade fields on items:**
  - local name for vegetables and kirana;
  - manufacturer, composition and schedule for pharmacy;
  - purity, weights, making charge, wastage and HUID for jewellery;
  - grade, size and weight for steel;
  - model and warranty for mobiles.
- **Units:** the trade's units (bunch, strip, ton, …).
- **New items:** the usual GST rate, for example 0% for fresh vegetables.
- **Receipt paper:** 58 or 80 mm.
- **Common items:** loaded with HSN codes and local names. Their prices are examples to change, and the GST rates are the usual ones, to be checked with the shop's CA.
- **Today's rates:** for daily-price trades, *Inventory → Today's rates* updates every selling price on one screen, with Enter moving down the list.
- **Trade details:** drug licence or BIS number on the business profile.

How it is built:

- **Plain data:** templates live in `shared/templates.ts`, so adding a business type is a data change.
- **Only adds:** applying one adds fields, units and items; it never deletes or overwrites anything, and applying it twice changes nothing more.

**Barcode counter (toy shops, garments, supermarkets).**

- **Scan to bill:** any USB or Bluetooth barcode scanner works in *POS* with no software. A scan is caught even after the cashier taps a tile or button, so no scan is lost.
- **Same code, any scanner:** a 12-digit UPC and the same code sent as 13 digits with a leading 0 match the same item.
- **Unknown barcode:** *POS* offers *Add as a new item* with the code filled in.
- **Price tags:** generate a barcode for loose items, then print labels on a 50 × 25 mm (or other) label printer or A4 sheets. *Print settings* explains the driver and calibration steps.
- **Receipts:** 58 or 80 mm thermal receipts. *Print settings → Thermal receipt* explains one-click printing with Chrome's `--kiosk-printing`.
- **One price is enough:** on a new item, SP2 and SP3 can be left empty and use the standard price.
- **Barcodes for everything in one go:** *Items* shows how many goods have no barcode and gives each its own shop barcode (a valid EAN-13 starting with 2, never a maker's code). The labels page then opens with one label per piece in stock.
- **Receiving stock by scanning:** on a purchase bill (and a purchase order), scan each box as it arrives. A new item adds a line, a repeat adds one more, and an unknown code offers *Add it as a new item* in a new tab so the bill isn't lost. From a saved bill, *Print labels for these items* prints one label per piece received.
- **Importing a supplier's list:** the *Items → Import* file (and *Tally & Import*) reads MRP, category and brand. A list with only MRP is priced at MRP. Rows without a GST rate get the shop's usual rate for its trade (5% for toys) instead of 18%. A box listed as a 12-digit UPC updates the item with the 13-digit code.

**Festival offers, promo line and loyalty points** (add-on *Offers & loyalty*, *Sales → Offers & loyalty*).

- **Offers start themselves:** create a Diwali, Children's Day, Christmas or other offer from a one-tap preset, with start and end dates. Between those dates it applies by itself at the counter and on invoices.
- **Item or bill offers:** an item offer is a percentage off every item, some categories or chosen items. A bill offer is a percentage or rupee amount off bills above a minimum.
- **No double discounts:** a line gets the bigger of its own discount and the best item offer, and only the best bill offer applies. The cashier can take an offer off one bill.
- **On the bill:** the discount is spread into the lines, so GST is charged on the reduced price and returns stay exact. The bill shows what each offer saved and prints the offer's message.
- **Promo line:** a message printed on every receipt and invoice (*Print settings*), for example "Diwali sale till 5 Nov".
- **Loyalty points:** the owner sets the rules: points per ₹100, what a point is worth, the minimum before points can be used, and the share of a bill points may pay.
  - Customer mobile numbers are optional; when given they must be a real 10-digit Indian mobile (with or without +91 / 0), and are saved as "+91 98765 43210". A customer list import keeps the customer and drops a wrong number with a warning.
  - On a new invoice, bill or purchase order the **+** next to the customer or vendor adds one in a pop-up, picks it, and stays on the document.
  - Points are earned on bills for a saved customer. At the counter, typing the customer's mobile number finds them, or adds them in one step.
  - Points can pay part of a later bill. Cancelling a bill undoes its points, and a return takes back the points earned on what came back.
  - Every change is kept in a points history, with owner adjustments and their reasons. Two counters can't spend the same points at once.
- **Safe for existing data:** offers and points live in their own tables (`offers`, `loyalty_ledger`). Shops without the add-on bill exactly as before.

**Invoices that follow the GST rules and the trade.**

- **Reprints match the original:** when an invoice is issued, its business details, layout, trade field labels, branch and the customer's earlier dues are saved with it. Changing the profile or print settings later changes new invoices only. Drafts always use the current settings.
- **GST fields stay on:** HSN/SAC, unit, place of supply, authorised signatory and the e-invoice IRN/QR cannot be turned off in *Print settings*; they show "Required by GST".
- **Trade details on the bill:** the drug licence or BIS number prints under the GSTIN. Item fields marked for print (schedule and manufacturer for medicines, purity and weights for jewellery, grade and size for steel, model and warranty for mobiles) print under the item name, with MRP when the template prints it.
- **Invoice fields:** some templates add boxes to the invoice itself, such as patient and doctor for a pharmacy or vehicle number for steel. They print next to the place of supply.
- **Copies:** print or download as *Original for recipient*, *Duplicate for transporter*, *Triplicate for supplier*, or all three in one file.
- **More on the bill:** a Paid, Part paid or Due stamp; an optional HSN summary; and for credit customers, the previous balance, this invoice and the total outstanding.
- **Share links can be turned off:** *Turn off link and make a new one* on the invoice stops the old WhatsApp or email link and makes a fresh one.
- **Clear PDF names,** for example `INV-2026-27-0012-Nila-Textiles.pdf`.
- **Safe upgrade:** existing issued invoices got their saved layout from the shop's settings at upgrade time, so they look the same as before.

**AI credits.** Every AI call is metered, so a shop can never run up an unlimited AI bill.

- **What a credit is:** one credit is US$0.004 of real AI cost. Input, output and cached tokens are each counted at their own price (`shared/features.ts`).
- **Allowance:** AI Standard includes 600 credits a month and AI Plus 2,500. Credits reset on the 1st.
- **Every call checked:** each call is checked first (AI feature on, credits left), and every step of a multi-step answer is recorded by shop, user and tool (`server/src/services/aiUsage.ts`). An AI call made outside a shop request is refused, so nothing goes unmetered.
- **Alerts:** at 80% the owner gets an email and an alert in the bell. At 100% AI tools pause until the 1st with a clear message.
  - Bill photos fall back to the offline reader, and the daily plan to its plain-words version.
  - Billing and everything else keep working.
- **Owner's view:** *Settings → Features & add-ons* shows credits left, use by person and by tool, and *Ask for more*.
- **Platform owner's view:** the console shows every shop's use and real cost, adds top-up packs (500 credits for ₹249 by default) and sets the credits included with each level.

**Upload a PDF or photo, get a filled form.** Every create form has a *Fill from a PDF or photo* box (drop, pick, paste a screenshot, or take a photo on a phone). You see what was read, untick anything wrong, then apply.

| Form | What it reads | What it fills |
|---|---|---|
| Item | Product sheet, supplier invoice, photo of the box or label | Name, brand, category, SKU, barcode, HSN, unit, MRP, selling price (e.g. "30k" → ₹30,000 on all price levels), cost, GST rate, description; a photo also becomes the product picture |
| Items → *From price list* | Supplier price list or catalogue | Many items at once; products already in the catalogue are skipped |
| Bill / purchase order | Vendor's tax invoice, quotation or proforma | Vendor (matched by GSTIN or name, or added), bill number, dates, line items (matched to the catalogue, or added), taxable value and GST |
| Expense | Electricity, rent, fuel, internet or any receipt | Category (guessed from the merchant), date, amount, GST, vendor, reference |
| Customer / vendor | GST certificate, visiting card, letterhead | Business name, GSTIN, state, phone, email, address |
| Invoice / quote / sales order | Customer's purchase order, enquiry, photo of a handwritten list | Customer, items and quantities, their reference |

The uploaded file is kept on the record it filled. Every record also has an **Attachments** panel (PDF, PNG, JPG, WebP; 10 MB each, 500 MB per business) for delivery challans, warranty cards, signed copies and so on. Files are type-checked by content, served with `nosniff` and a sandboxing CSP, and visible only to roles that can see the record.

Without `ANTHROPIC_API_KEY`, reading runs entirely on the server: PDF text extraction (pdf.js) and English OCR (Tesseract, model bundled, no download). Photos and screenshots are scaled up and contrast-boosted before OCR, and scanned PDFs (no text layer) are rendered and OCR'd page by page. With the key, the smart reader (Claude) also handles handwriting, small screenshots and unusual layouts, and falls back to the built-in reader if it is unavailable.

**Billing extras:** MRP (GST-inclusive) billing, a discount on the whole bill, POS split payments (cash + UPI + card), bill-wise profit (item cost saved on each line; hidden from roles without cost access), and delivery challans (packed → dispatched → delivered → invoiced).

**Smart Reorder (Inventory):** sales speed per item, days of stock left against the supplier's delivery time, suggested order quantities and the usual vendor, one-click draft purchase orders, dead stock, slow movers and batches expiring within 60 days.

**Tally & Import (Accounting):** Tally XML export of masters and vouchers (sales, receipts, purchases, payments; every voucher balances), Tally masters import (UTF-8 or UTF-16), and CSV import from any software with column matching.

**Field staff:** *My Day* for salespeople (start/end day, GPS check-in at customers, outcome, order value, collection) and *Field Team* for owners (map of routes and visits, totals, export). Location is recorded only between Start day and End day. Map tiles come from OpenStreetMap (with a mirror as fallback); each visit also has a Google Maps link.

**Business health score (Dashboard):** five checks from your own books, 20 points each (collections, cash coming in, sales growth, stock health, profit margin), with the biggest win to work on. No AI needed.

**Microfinance management (optional module):** switch it on in Microfinance settings (owner). Daily 100-day, weekly and monthly loans with interest taken upfront, exactly as in the Sri Sakthi Thirumurugan Finance system it replaces:
- **Borrowers** by area (codes like KUN001), verification (approve, manual approval with a note, failed), a risk score, and Aadhaar stored encrypted (AES-256-GCM) with only the last 4 digits shown; the owner can view the full number with a reason, which is audited. Duplicates are caught by Aadhaar or mobile.
- **Give a loan** with a live quote (cash to hand over, upfront interest, instalment, dates, effective yearly rate), cash rounding by up to ₹100, borrower acknowledgement, collector, and **existing loans** brought in from a paper register with what was already repaid.
- **Collections:** collect with a confirm step and an 80 mm receipt (print or WhatsApp), prepayments, full closure with typed confirmation, owner-only reversal. A retried request never saves twice, and two collectors can't overpay the same loan. Loans close themselves at zero.
- **Dues** for any date (paid, less paid, not paid, arrears) by plan cycle, alerts at day 90/95/100/130 and EMIs past grace, **late charges for defaulters only** (oldest unpaid instalment 30+ days), owner waivers.
- **Collector** role: sees and collects only the loans assigned to them, with a phone-first home screen.
- **Reports:** daily collection, monthly cash flow, loan book, defaulters, areas, collectors, interest and recovery; every one exports.
- **Books:** loans, receipts and late charges post to the ledger (Loans given, Interest income, Late charges), so P&L and the Balance Sheet include microfinance.
- **One login, both businesses:** a shop that runs retail and microfinance sees both on the main dashboard (sales, receivables and stock, plus active loans, outstanding, today's collection and defaulters), for staff who can see loans. Each module keeps its own tables (borrowers, lending_loans, lending_payments… beside invoices, items, bills…) in the same database, every one isolated per shop by row-level security, so loan records never mix with sales records; they meet only in the ledger, where both must post for the P&L and Balance Sheet to be right.
- Not yet carried over from the original: SMS OTP (mobile verification, borrower acknowledgement), Aadhaar OTP via a provider, restructuring and write-off, daily cash close and collector deposits.

**Weighing scale:** POS reads USB/serial scales (Chrome or Edge on a computer) and bills weighed items by the reading.

**AI features (with `ANTHROPIC_API_KEY`):**

- **Smart reader** for every upload box above.
- **Today's plan** on the Dashboard: every morning the AI writes up to five jobs for the day from your books (overdue dues to collect, items to reorder, expiring batches, field follow-ups, slow stock) with one-tap buttons, in English, Hindi or Tamil. It is saved for the day; without the key the same jobs are listed in plain words.
- **Ask AI** (top bar): ask about sales, dues, customers, stock, bills and expenses in plain words. It answers from the shop's live data through read-only lookups that respect the user's role (sales staff can't see purchases, cost prices need `items.cost`), and it can't change anything. Ask by voice with the mic button and turn on read-aloud to hear the answer.
- **Fill with AI** on the new-item form: suggests the HSN/SAC code, GST rate, unit, category, brand and a short description from the item name. It only fills empty fields.
- **Type or speak the bill** on invoices and POS (English, Hinglish, 9 Indian languages by voice): finds your items and customer, discount and payment mode.
- **AI stock advice** on Smart Reorder, with festival tips from a fixed festival calendar.
- **AI payment reminders** for WhatsApp in 10 languages and three tones.
- **AI column matching** when importing lists from other software.
- **AI day summary** of the field team.

Without the key these buttons are hidden and everything else works as before. Set the key in the Render dashboard (Environment → `ANTHROPIC_API_KEY`); never commit it.


**Super Admin:** dashboard (active shops, new this month, subscription revenue, expiring licenses), creating shops with a temporary password, activate/deactivate (ends sessions immediately), license renewals with payment records, owner password-reset links, **plans & limits** (users, branches, invoices per month, enforced by the server), **configuration** (customer-ID prefix, FY auto-reset, **Tax Lab**), audit log, subscription payments, backups.

**Shop: billing and GST**
- Invoices with server-side totals. CGST+SGST or IGST is chosen from the place of supply.
- **Net (no tax) / GST toggle**, **Bill of Supply** for composition dealers and exempt sales, **reverse charge**, **TCS**.
- Partial payments with **TDS**, and credit notes that can restock returned goods.
- **One invoice document everywhere.** `/invoices/:id/print` renders only the tax invoice, on **A4, A5, or a 58 mm or 80 mm thermal roll** (pick the roll each time, or set the default in Print settings). The in-app Print button, *Download PDF*, *Email invoice* (PDF attached) and the WhatsApp share link all produce that same document. The server makes PDFs by printing the route in headless Chromium.
- Print layout: `@page` margins of 13–14 mm, the column header repeats on every page, rows never split, the totals block stays together, and *Page X of Y* sits in the footer (Chrome and Edge draw it from CSS; Firefox adds its own). Colour is limited to the title and rules, so it reads well on black-and-white printers.
- Full GST layout: seller and buyer GSTIN, bill-to and ship-to, place of supply with state code, S.No / Item / HSN / Qty / Unit / Rate / Discount / Taxable value / GST % / Tax / Amount, tax breakup by rate, amount in words, bank details with a **UPI QR** for the balance, terms, signatory with an optional signature image, and the **e-invoice IRN, acknowledgement and QR** plus the e-way bill number once they are recorded.
- **Print settings → Invoice:** choose a template (Standard, Modern, Compact), paper, logo, brand colour, which fields to show, default terms and signatory, all with a live preview.
- **GSTR-1 JSON** in the GSTN offline-tool layout (B2B, B2CL, B2CS, CDNR, nil-rated, HSN, documents issued), **GSTR-3B** with input credit from purchase bills, and an **HSN summary**.
- **E-invoice JSON** (NIC v1.1) and **e-way bill JSON** (bulk upload format).

**Shop: selling**
- **Quote → sales order → invoice.** Quotes (QT-) and orders (SO-) carry lines, prices and notes forward; each conversion links back to its source.
- Invoice statuses: **Draft, Sent, Partially Paid, Paid, Overdue, Void**.
- **Item picker** searches name, SKU, HSN and barcode as you type; Enter picks and moves to quantity, so an invoice is N → customer → item → quantity → Ctrl+Enter.
- Customers have a **credit limit** (issuing past it needs a confirmation that is audited), a **statement of account** for any date range with ageing buckets (print or CSV), and a **contact history** of calls, notes, invoices, payments and reminders.
- Customers and Invoices open a **split-view panel** beside the list; Esc closes it.
- **POS counter billing:** scan, then cart, then Cash/UPI/Card, with change calculation, an 80 mm thermal receipt and WhatsApp bills.
- **Share on WhatsApp** (wa.me), email from your own mail app, copy a public link.
- **Payment reminders:** WhatsApp, email on demand, or automatic email reminders.
- **Recurring invoices**, generated hourly. **Sales orders** move Draft → Sent → Accepted and convert to an invoice.

**Shop: purchases**
- Pay vendor bills **in part or in full**, with mode, reference and TDS. Each payment (PM-0001…) is a bank or cash withdrawal; removing one reopens the bill and reverses the withdrawal.
- **Payments Made** list and a **payables ageing** table (not due, 1–30, 31–60, 61–90, 90+ days).
- **Vendor statement** for any date range in a split-view panel, with print and CSV.

**Shop: inventory**
- Items with SP1/SP2/SP3 price tiers, barcode scanning (USB scanner or camera), inline editing, and bulk tax-slab changes or archiving.
- **Warehouses**: every shop, godown or branch holds its own stock, with stock value per warehouse.
- **Stock adjustments** as numbered documents (reason, who, when), including a **stock count** mode that posts the difference between what is on the shelf and what is on record.
- **Transfers between warehouses** that stay *in transit* until the other side receives them, and can be cancelled back to the source.
- **Variants**: turn an item into a group (Size × Colour …) with one sellable item per combination, each with its own SKU, price and stock.
- **Serial / IMEI numbers**: register serials for stock on hand, pick them on the invoice (sale is blocked without them), print them on the invoice, and they return to stock if the invoice is cancelled or edited.
  - **On purchases**: an itemised bill (or receiving a purchase order) has a box under each serial-tracked line for one IMEI / serial per unit, typed, pasted or scanned (scan the box, then its IMEI). The bill can't be saved until the count matches the quantity. Each number remembers its vendor, bill or order and date received, for warranty; the item page and the serial lookup show where each unit came from and who bought it.
  - **Unique in the whole shop**: a number already in the stock records (under any item) is refused, and so is the same number twice on one bill.
  - **In imports**: an item sheet with an IMEI column (IMEI, IMEI No., Serial Number, IMEI 1…; an IMEI 2 column is kept too) saves every number. Either one row per phone (the item repeated) or several numbers in one cell; stock is the count of numbers. A "Serial No." column that only counts rows (1, 2, 3…) is ignored, and IMEIs that Excel shortened to 3.57E+14 in a CSV are flagged.
- **Stock summary & valuation**: opening, in, out and closing for any period and warehouse, valued at cost, by item or by category, with CSV and print.
- Full movement history per item.
- **Batches & expiry** with first-expiry-first-out on sale, reorder-level alerts, and expiring-batch alerts.
- **Barcode label sheets** (A4, 24 per page).
- **Excel (.xlsx) and CSV import**, CSV export, for items and customers. An Excel workbook is uploaded as it is (read in the browser, every digit of long numbers kept); old .xls files are asked to be saved as .xlsx or CSV first.

**Shop: accounting & reports**
- **Double-entry ledger built from your documents**: invoices, payments, credit notes, bills, payments made, expenses, banking and every stock movement post automatically, so the books can't drift from the source records.
- **Chart of accounts** with live balances (built-in accounts, one per bank account and expense category, plus your own), **manual journals** that must balance, and a **general ledger** with running balance per account.
- **Profit & Loss, Balance Sheet, Cash Flow, Trial Balance, Sales by Customer, Sales by Item, Receivables and Payables Ageing**, Stock Summary and Inventory Valuation. Every report has date presets (this month, quarter, financial year…) and exports to **PDF** (rendered on the server), **Excel (.xlsx)** and **CSV**.

**Shop: team & control**
- **Roles**: Owner, Manager, Accountant, Sales Staff, Warehouse and Viewer, with a **permissions matrix per module** the owner can change. **Permissions are enforced on the server** on every request.
- **Audit log of every change**: who, what, which record, when and from which IP, searchable and exportable. Changes a route doesn't log itself are still recorded.
- **Organisation switcher**: run several businesses from one login, each with its own data, books and settings.
- Multiple branches.
- License renewal, through Razorpay when configured.

**Polish**
- Dark / light / system theme.
- **English, हिन्दी, தமிழ்** for navigation, the shell, the dashboard and login. Longer help text is still English.
- Keyboard shortcuts: press `?` to see them.
- Bulk actions, **saved filter views**, skeleton loading states.
- Installable **PWA** with a read-only **offline mode**: shop data you've already viewed stays readable; changes need a connection.

### What needs your accounts
- **Direct e-invoice IRN / e-way bill generation** needs a GSP or ASP licence and credentials. Until then the app produces the official JSON for upload on the government portals.
- **Automatic WhatsApp messages** need the WhatsApp Business API. Until then sharing uses `wa.me` links, which open WhatsApp with the message ready to send.
- **SMS** isn't implemented. **Email** needs a provider (below). **Online license payments** need Razorpay keys.

### Email (password resets, invoices, reminders)
Without a provider nothing is emailed: the server logs a warning and Super Admin → Configuration → Email shows *Not set up*. Render's free plan blocks outgoing SMTP ports, so use an HTTPS provider there:

1. Sign up at [brevo.com](https://www.brevo.com) (free, 300 emails a day), verify the sender address you want to send from (Senders & IP → Senders), and create an API key (SMTP & API → API keys).
2. In Render → the web service → Environment, add `BREVO_API_KEY` and `MAIL_FROM` (for example `Corpus360 <you@gmail.com>`, using the verified address). Save; Render redeploys.
3. Super Admin → Configuration → Email → *Send test*. Any error from the provider is shown there.

`RESEND_API_KEY` works the same way (Resend needs a verified domain to email other people). `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` work on hosts that allow SMTP. When email can't be sent, the Super Admin's *reset owner password* button shows the link to pass on instead.

## Testing

```bash
npm test            # shared unit tests + API integration tests (uses the ledgerly_test database)
npm run test:e2e    # Playwright smoke test against a running `npm run dev`
npm run typecheck
```
The API tests cover login and lock-out, CSRF, password reset, forced password change, role permissions, **shop isolation (including database-level row-level security)**, concurrent invoice numbering, FY reset, tax treatment, stock deduction and restock, payments with TDS, credit-note limits, POS sales, plan limits, recurring generation, public links, GSTR-1/3B, HSN, and e-invoice/e-way bill payloads, the ledger (trial balance, balance sheet, cash-flow reconciliation, journals), the roles matrix, the audit log and organisation switching.

## Project layout

```
shared/            tax maths, financial year, GST state codes, permissions, CSV, status
server/
  migrations/      SQL schema (with row-level security policies)
  src/             app, auth, db, jobs (recurring, reminders, license emails, backups), seed
  src/routes/      auth, platform (super admin), public links, shop/* (catalog, sales, money, reports, core)
  src/services/    documents (invoices, payments, credit notes), stock, GST returns, provisioning, backups
  src/integrations razorpay, GSTN JSON builders
  test/            API integration tests
src/               web app (api client + hooks, contexts, components, layouts, pages)
public/            PWA manifest, service worker, icons
e2e/               Playwright smoke test
```
