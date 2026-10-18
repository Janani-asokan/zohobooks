# Ledgerly Books

A multi-tenant GST billing, inventory and accounting SaaS for Indian businesses. Its menus and workflow follow **Zoho Books**; its look follows **Billbook** (clean white workspaces, soft shadows, Plus Jakarta Sans), with a full dark mode.

| Layer | Stack |
|---|---|
| Web app | React 18, TypeScript, Vite, React Router 6, TanStack Query, lucide-react |
| API | Node 20+, Express 4, TypeScript, zod validation, bcrypt, helmet |
| Database | PostgreSQL 16 with **row-level security** per shop |
| Shared | `shared/`: tax maths, financial year, GST codes, permissions, CSV (used by both sides) |
| Tests | Vitest unit + API integration tests (supertest), Playwright smoke script |

---

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
| Manager / Sales staff / Accountant | manager@ / sales@ / accounts@shop.com | manager123 / sales123 / accounts123 |

There's no role picker on the login page: the server works out who you are from your account.

### Deploy to Render (free, one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Janani-asokan/zohobooks)

The `render.yaml` blueprint creates a PostgreSQL database and the web service (built from the `Dockerfile`). On first start it loads the demo shops. **Demo mode is on** (`DEMO_SIMPLE_PASSWORDS=1`): the demo logins use the simple passwords (`owner@shop.com` / `owner123`, `admin@ledgerly.in` / `admin123`, …) and the login page lists them, so anyone with the link can sign in. Before real use, set `DEMO_SIMPLE_PASSWORDS=0`. A fresh seed then gives the demo accounts the generated `DEMO_PASSWORD` instead; an existing database keeps the simple passwords until you change them, so change them yourself. To start with an empty platform instead, remove `SEED_DEMO` and set `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`.

Free-tier notes: the service sleeps after 15 minutes without visitors (the first request then takes about 50 seconds), and Render's free PostgreSQL expires after 30 days. Use paid plans for real shops.

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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Sends password-reset, reminder and license emails. Without these, emails are only logged |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Lets shop owners renew their license online |
| `BACKUPS_ENABLED=1`, `BACKUP_DIR`, `BACKUP_KEEP` | Daily `pg_dump` backups (on by default in production) |
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

**Super Admin:** dashboard (active shops, new this month, subscription revenue, expiring licenses), creating shops with a temporary password, activate/deactivate (ends sessions immediately), license renewals with payment records, owner password-reset links, **plans & limits** (users, branches, invoices per month, enforced by the server), **configuration** (customer-ID prefix, FY auto-reset, **Tax Lab**), audit log, subscription payments, backups.

**Shop: billing and GST**
- Invoices with server-side totals. CGST+SGST or IGST is chosen from the place of supply.
- **Net (no tax) / GST toggle**, **Bill of Supply** for composition dealers and exempt sales, **reverse charge**, **TCS**.
- Partial payments with **TDS**, and credit notes that can restock returned goods.
- Printable A4 invoices in **3 templates** with a **UPI QR** for the exact balance, bank details, and the amount in words.
- **GSTR-1 JSON** in the GSTN offline-tool layout (B2B, B2CL, B2CS, CDNR, nil-rated, HSN, documents issued), **GSTR-3B** with input credit from purchase bills, and an **HSN summary**.
- **E-invoice JSON** (NIC v1.1) and **e-way bill JSON** (bulk upload format).

**Shop: selling**
- **POS counter billing:** scan, then cart, then Cash/UPI/Card, with change calculation, an 80 mm thermal receipt and WhatsApp bills.
- **Share on WhatsApp** (wa.me), email from your own mail app, copy a public link.
- **Payment reminders:** WhatsApp, email on demand, or automatic email reminders.
- **Recurring invoices**, generated hourly. **Sales orders** move Draft → Sent → Accepted and convert to an invoice.

**Shop: inventory**
- Items with SP1/SP2/SP3 price tiers, barcode scanning (USB scanner or camera), inline editing, and bulk tax-slab changes or archiving.
- **Stock per branch** with adjustments, **transfers between branches** and full movement history.
- **Batches & expiry** with first-expiry-first-out on sale, reorder-level alerts, and expiring-batch alerts.
- **Barcode label sheets** (A4, 24 per page).
- **CSV import/export** for items and customers (Excel → Save as CSV).

**Shop: team**
- **Staff logins** with the roles Manager, Accountant, Sales Staff and Viewer. **Permissions are enforced on the server**, and Sales Staff can't see cost prices.
- Multiple branches and an activity log.
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
- **SMS** isn't implemented. **Email** needs SMTP settings. **Online license payments** need Razorpay keys.

## Testing

```bash
npm test            # shared unit tests + API integration tests (uses the ledgerly_test database)
npm run test:e2e    # Playwright smoke test against a running `npm run dev`
npm run typecheck
```
The API tests cover login and lock-out, CSRF, password reset, forced password change, role permissions, **shop isolation (including database-level row-level security)**, concurrent invoice numbering, FY reset, tax treatment, stock deduction and restock, payments with TDS, credit-note limits, POS sales, plan limits, recurring generation, public links, GSTR-1/3B, HSN, and e-invoice/e-way bill payloads.

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
