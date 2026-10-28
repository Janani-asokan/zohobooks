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

There's no role picker on the login page: the server works out who you are from your account.

### Deploy to Render (free, one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Janani-asokan/zohobooks)

The `render.yaml` blueprint creates a PostgreSQL database and the web service (built from the `Dockerfile`). On first start it loads the demo shops. **Demo mode is on** (`DEMO_SIMPLE_PASSWORDS=1`): the demo logins use the simple passwords (`owner@shop.com` / `owner123`, `admin@ledgerly.in` / `admin123`, …) and the login page lists them, so anyone with the link can sign in. Before real use, set `DEMO_SIMPLE_PASSWORDS=0`. A fresh seed then gives the demo accounts the generated `DEMO_PASSWORD` instead; an existing database keeps the simple passwords until you change them, so change them yourself. To start with an empty platform instead, remove `SEED_DEMO` and set `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`.

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
- **Audit log** of every change, per shop and for the platform. **Backups** with `pg_dump`. They can't be downloaded from the console because they hold every shop's data.

## Features

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
- **Stock summary & valuation**: opening, in, out and closing for any period and warehouse, valued at cost, by item or by category, with CSV and print.
- Full movement history per item.
- **Batches & expiry** with first-expiry-first-out on sale, reorder-level alerts, and expiring-batch alerts.
- **Barcode label sheets** (A4, 24 per page).
- **CSV import/export** for items and customers (Excel → Save as CSV).

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
