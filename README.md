# Ledgerly Books

A multi-tenant GST billing and accounting SaaS. Its menus and workflow follow **Zoho Books**, and its look follows **Billbook**: white workspaces, soft shadows, subtle gray borders and Plus Jakarta Sans.

Stack: React 18 + TypeScript + Vite + React Router 6 + Immer + lucide-react. This is a frontend-only build. All data lives in `localStorage` behind a single store (`src/context/StoreContext.tsx`), so a backend API can replace it later.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Customer Admin (shop owner) | owner@shop.com | owner123 |
| Super Admin (SaaS owner) | admin@ledgerly.in | admin123 |

To reset the demo data, clear the site's local storage.

---

## Routing & auth

| Route | Access |
|---|---|
| `/login` | Public. Split-screen page with a form, validation and a role selector used for testing. |
| `/super-admin`, `/super-admin/configuration` | `SuperAdmin` only |
| `/app/**` | `CustomerAdmin` only |

`AuthContext` checks the credentials against the user directory and works out the real role. The role chosen on the login page must match that role. Shop owners whose workspace is **deactivated** or whose **license has expired** cannot log in. `ProtectedRoute` sends signed-out users to `/login` and sends users with the wrong role to their own home page.

## Requirements → implementation

### Super Admin (SaaS operations, `src/pages/super`)
- **Dashboard**
  - Cards: Total Active Shops, New Customers This Month, Total Revenue (Subscriptions), Expiring Licenses (≤30 days).
  - Subscription-revenue chart and license-mix breakdown.
  - Shop-owner table with search, status filters, pagination and an **activate/deactivate toggle**.
- **Create shop owner**: sets up the login and an empty, isolated workspace, and assigns a **license plan** (Trial, 1, 2 or 3 years). **Renew** extends the expiry date.
- **Configuration**: three cards, each with *Save Changes* and a toast.
  1. **Customer ID prefix**, e.g. `ACS` → `XYZ`. New IDs use the new prefix; existing IDs keep theirs.
  2. **Financial year**: 1 April – 31 March, with the **Auto-Reset Invoice Numbering** master toggle.
  3. **Tax Lab**: create, rename, enable/disable and remove GST slabs (0/5/12/18/28 plus custom ones).
- **Privacy**: `usePlatform()` exposes only shop metadata and platform config. The console never reads tenant data such as invoices, prices or customers.

### Customer Admin (shop owner, `src/pages/app`)
- **Layout**
  - Top bar: shop logo and company name, global search (Ctrl K) across items, customers and invoices, license pill, and profile menu.
  - Sidebar (collapsible): **Home · Items · Sales (Customers, Sales Orders, Invoices) · Purchases · Banking · Reports**.
  - The sidebar has **no Configuration tab**.
- **Items**
  - Goods/Services tabs and a **New Item** form with an **autofocused barcode field**. USB scanners type the code and press Enter; a camera option uses `BarcodeDetector` where the browser supports it.
  - Fields: name, SKU, HSN/SAC, unit, tax slab, **Base Cost**, and mandatory **SP1 (Standard) / SP2 (Loyal) / SP3 (New)** with a live margin and a warning when a price is below cost.
  - Filterable table with **inline editing**: click a value, then Enter saves and Esc cancels.
  - Quick scan: scanning a barcode looks up the item, or starts a new item if none matches.
- **Customers**
  - Each customer gets an automatic **Custom ID** (`<prefix>-<sequence>`, e.g. `ACS-1582`).
  - Individual or Business. Business requires a **GSTIN**, which is format-validated.
  - Each customer has a default price tier, and their state decides CGST+SGST vs IGST.
- **Sales Orders**: Draft → Sent → Accepted pipeline (board or list), editing, and **Convert to invoice**.
- **Invoices**
  - The line-item table picks from your Items. You can also add items by barcode or SKU, and set the price tier, discount and quantity per line.
  - A global toggle switches between **Calculate Net Price (No Tax)** and **Calculate with GST**.
  - Invoices can be saved as Draft, Unpaid or Paid. Saving a non-draft invoice reduces stock.
  - **Printable A4 invoice** with the shop's logo, company name and GSTIN, a CGST/SGST or IGST breakup, the amount in words, and a signature block. Use *Print / PDF*.
- **Invoice numbering**: `INV-<FY>-0001`. When auto-reset is on, the sequence **restarts at 0001 every 1 April**. When it is off, numbering continues across years.
- **Purchases** (vendors, bills), **Banking** (accounts, transactions, balances), **Reports** (sales summary, GST summary, sales by customer and item, receivables aging).
- **Profile menu**:
  - **Organization profile**: logo upload and invoice details.
  - **Staff, roles & branches**: invite staff, assign Manager/Accountant/Sales/Viewer roles, view the permission matrix, and manage multiple branches. Each invoice records its branch.

## Project layout

```
src/
  lib/          types, seed data, financial-year, tax totals, formatting
  context/      Store (persistence), Auth, Tenant (scoped data), Toasts
  components/   UI kit, charts, barcode input, line-item editor
  layouts/      Super Admin shell, Customer Admin shell, sidebar
  pages/        Login, super/*, app/*
  styles/       global.css (tokens & components), layout.css (shells, login, A4 print)
```
