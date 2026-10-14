-- =====================================================================
-- Ledgerly Books — initial schema
-- Platform tables (super admin scope) + tenant tables (shop scope, RLS).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Platform scope ----------
CREATE TABLE super_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  customer_id_prefix text NOT NULL DEFAULT 'ACS' CHECK (customer_id_prefix ~ '^[A-Z]{2,5}$'),
  fy_start_month int NOT NULL DEFAULT 4 CHECK (fy_start_month BETWEEN 1 AND 12),
  auto_reset_invoice_numbering boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_config (id) VALUES (1);

CREATE TABLE tax_slabs (
  id text PRIMARY KEY,
  name text NOT NULL,
  rate numeric(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (rate)
);
INSERT INTO tax_slabs (id, name, rate) VALUES
  ('tax_0', 'GST Exempt', 0), ('tax_5', 'GST 5%', 5), ('tax_12', 'GST 12%', 12), ('tax_18', 'GST 18%', 18), ('tax_28', 'GST 28%', 28);

CREATE TABLE plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  price_per_year numeric(12,2) NOT NULL,
  trial_days int,                    -- set only for the trial plan
  max_users int NOT NULL,            -- owner + staff
  max_branches int NOT NULL,
  max_invoices_per_month int,        -- null = unlimited
  sort int NOT NULL DEFAULT 0
);
INSERT INTO plans VALUES
  ('trial', 'Trial', 0, 14, 2, 1, 50, 0),
  ('standard', 'Standard', 11999, NULL, 5, 2, NULL, 1),
  ('premium', 'Premium', 24999, NULL, 25, 10, NULL, 2);

CREATE TABLE shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  plan_id text NOT NULL REFERENCES plans(id),
  license_start date NOT NULL,
  license_end date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_expiry_reminder date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SaaS revenue — the platform's own billing, not shop financial data.
CREATE TABLE subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES plans(id),
  years int NOT NULL CHECK (years BETWEEN 1 AND 5),
  amount numeric(12,2) NOT NULL,
  method text NOT NULL CHECK (method IN ('manual', 'razorpay')),
  reference text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('created', 'paid', 'failed')),
  razorpay_order_id text UNIQUE,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Shop users (owner + staff). Identity table — looked up by email at login.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('Owner', 'Manager', 'Accountant', 'Sales Staff', 'Viewer')),
  branch_id uuid,
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_shop_idx ON users (shop_id);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  principal_type text NOT NULL CHECK (principal_type IN ('super', 'user')),
  principal_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_principal_idx ON sessions (principal_type, principal_id);

CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  principal_type text NOT NULL CHECK (principal_type IN ('super', 'user')),
  principal_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Tenant scope (every row carries shop_id; RLS enforced) ----------
CREATE TABLE organizations (
  shop_id uuid PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  legal_name text NOT NULL DEFAULT '',
  gstin text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'Tamil Nadu',
  logo text NOT NULL DEFAULT '',
  invoice_footer text NOT NULL DEFAULT 'Thank you for your business!',
  upi_id text NOT NULL DEFAULT '',
  bank_details text NOT NULL DEFAULT '',
  invoice_template text NOT NULL DEFAULT 'classic' CHECK (invoice_template IN ('classic', 'modern', 'compact')),
  composition_scheme boolean NOT NULL DEFAULT false,
  auto_reminders boolean NOT NULL DEFAULT false,
  reminder_days int NOT NULL DEFAULT 3
);

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX branches_shop_idx ON branches (shop_id);
ALTER TABLE users ADD CONSTRAINT users_branch_fk FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

CREATE TABLE counters (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  key text NOT NULL,
  value int NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, key)
);

CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('Goods', 'Services')),
  name text NOT NULL,
  sku text NOT NULL DEFAULT '',
  barcode text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'pcs',
  hsn text NOT NULL DEFAULT '',
  cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  sp1 numeric(14,2) NOT NULL CHECK (sp1 > 0),
  sp2 numeric(14,2) NOT NULL CHECK (sp2 > 0),
  sp3 numeric(14,2) NOT NULL CHECK (sp3 > 0),
  tax_slab_id text NOT NULL REFERENCES tax_slabs(id),
  reorder_level numeric(14,2) NOT NULL DEFAULT 10,
  track_batches boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_shop_idx ON items (shop_id);
CREATE UNIQUE INDEX items_barcode_uq ON items (shop_id, barcode) WHERE barcode <> '' AND NOT archived;
CREATE UNIQUE INDEX items_sku_uq ON items (shop_id, lower(sku)) WHERE sku <> '' AND NOT archived;

CREATE TABLE item_stock (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  qty numeric(14,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, branch_id)
);

CREATE TABLE item_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  batch_no text NOT NULL,
  expiry_date date,
  qty numeric(14,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, branch_id, batch_no)
);

CREATE TABLE stock_movements (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  qty_change numeric(14,3) NOT NULL,
  reason text NOT NULL CHECK (reason IN ('opening', 'sale', 'sale_cancel', 'credit_note', 'adjustment', 'transfer_in', 'transfer_out', 'purchase')),
  batch_no text NOT NULL DEFAULT '',
  ref_type text NOT NULL DEFAULT '',
  ref_id uuid,
  note text NOT NULL DEFAULT '',
  user_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_item_idx ON stock_movements (shop_id, item_id, at DESC);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  custom_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('Individual', 'Business')),
  name text NOT NULL,
  company_name text NOT NULL DEFAULT '',
  gstin text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  tier text NOT NULL DEFAULT 'SP1' CHECK (tier IN ('SP1', 'SP2', 'SP3')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, custom_id),
  CHECK (type = 'Individual' OR gstin <> '')
);

CREATE TABLE sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  number text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  date date NOT NULL,
  expiry_date date NOT NULL,
  lines jsonb NOT NULL,
  with_gst boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('Draft', 'Sent', 'Accepted')),
  notes text NOT NULL DEFAULT '',
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);

CREATE TABLE recurring_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  start_date date NOT NULL,
  end_date date,
  next_date date NOT NULL,
  lines jsonb NOT NULL,
  with_gst boolean NOT NULL,
  terms_days int NOT NULL DEFAULT 15,
  branch_id uuid REFERENCES branches(id),
  notes text NOT NULL DEFAULT '',
  auto_issue boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  number text,                       -- assigned when issued (drafts get one too, at creation)
  fy text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  customer jsonb NOT NULL,           -- snapshot of bill-to details at time of issue
  date date NOT NULL,
  due_date date NOT NULL,
  branch_id uuid REFERENCES branches(id),
  lines jsonb NOT NULL,
  with_gst boolean NOT NULL,
  doc_type text NOT NULL DEFAULT 'TAX INVOICE' CHECK (doc_type IN ('TAX INVOICE', 'INVOICE', 'BILL OF SUPPLY')),
  place_of_supply text NOT NULL DEFAULT '',
  inter_state boolean NOT NULL DEFAULT false,
  reverse_charge boolean NOT NULL DEFAULT false,
  tcs_rate numeric(5,3) NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('Draft', 'Issued', 'Cancelled')),
  sub_total numeric(14,2) NOT NULL DEFAULT 0,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  tax_total numeric(14,2) NOT NULL DEFAULT 0,
  cgst numeric(14,2) NOT NULL DEFAULT 0,
  sgst numeric(14,2) NOT NULL DEFAULT 0,
  igst numeric(14,2) NOT NULL DEFAULT 0,
  tcs numeric(14,2) NOT NULL DEFAULT 0,
  round_off numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  amount_paid numeric(14,2) NOT NULL DEFAULT 0,
  amount_credited numeric(14,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'pos', 'recurring')),
  sales_order_id uuid REFERENCES sales_orders(id),
  recurring_id uuid REFERENCES recurring_profiles(id),
  public_token text NOT NULL UNIQUE,
  einvoice jsonb,
  last_reminder_at timestamptz,
  cancel_reason text NOT NULL DEFAULT '',
  cancelled_at timestamptz,
  issued_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);
CREATE INDEX invoices_shop_date_idx ON invoices (shop_id, date DESC);
CREATE INDEX invoices_customer_idx ON invoices (shop_id, customer_id);

-- Token → shop lookup for public (unauthenticated) invoice links. Not tenant data itself.
CREATE TABLE public_links (
  token text PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  tds_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  mode text NOT NULL CHECK (mode IN ('Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque')),
  reference text NOT NULL DEFAULT '',
  account_id uuid,
  notes text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_invoice_idx ON payments (shop_id, invoice_id);

CREATE TABLE credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  number text NOT NULL,
  fy text NOT NULL,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  date date NOT NULL,
  reason text NOT NULL,
  lines jsonb NOT NULL,
  with_gst boolean NOT NULL,
  inter_state boolean NOT NULL,
  sub_total numeric(14,2) NOT NULL,
  tax_total numeric(14,2) NOT NULL,
  cgst numeric(14,2) NOT NULL,
  sgst numeric(14,2) NOT NULL,
  igst numeric(14,2) NOT NULL,
  total numeric(14,2) NOT NULL,
  restock boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);

CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name text NOT NULL,
  gstin text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  number text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  vendor_bill_no text NOT NULL DEFAULT '',
  date date NOT NULL,
  due_date date NOT NULL,
  taxable_amount numeric(14,2) NOT NULL CHECK (taxable_amount >= 0),
  tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  amount numeric(14,2) NOT NULL,
  status text NOT NULL CHECK (status IN ('Open', 'Paid')),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);

CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name text NOT NULL,
  bank text NOT NULL DEFAULT '',
  account_no text NOT NULL DEFAULT '',
  type text NOT NULL CHECK (type IN ('Bank', 'Cash', 'Card')),
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payments ADD CONSTRAINT payments_account_fk FOREIGN KEY (account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  date date NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  category text NOT NULL DEFAULT 'Other',
  ref_type text NOT NULL DEFAULT '',
  ref_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_tx_account_idx ON bank_transactions (shop_id, account_id, date DESC);

CREATE TABLE reminder_log (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  channel text NOT NULL,          -- email | whatsapp | manual
  status text NOT NULL,           -- sent | skipped | failed
  detail text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);

-- Audit trail. shop_id NULL = platform-level event (visible to super admin only).
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  shop_id uuid REFERENCES shops(id) ON DELETE CASCADE,
  actor_type text NOT NULL,
  actor_id uuid,
  actor_name text NOT NULL DEFAULT '',
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_shop_idx ON audit_log (shop_id, at DESC);

-- ---------- Row-level security ----------
-- Every request runs inside a transaction that sets app.shop_id. Rows from any
-- other shop are invisible even if a query forgets its WHERE shop_id clause.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','branches','counters','items','item_stock','item_batches','stock_movements','customers',
    'sales_orders','recurring_profiles','invoices','payments','credit_notes','vendors','bills',
    'bank_accounts','bank_transactions','reminder_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
      WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_scope ON audit_log
  USING (shop_id IS NOT DISTINCT FROM nullif(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (shop_id IS NOT DISTINCT FROM nullif(current_setting('app.shop_id', true), '')::uuid);
