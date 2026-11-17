-- Warehouse licences: statutory permits of a warehouse (FSSAI, fire NOC, bonded warehouse …) and the capacity / seat
-- licences a warehouse sells to its storage clients. Billing checks them before an invoice is issued (see
-- server/src/services/licenses.ts and docs/warehouse-licenses.md).
--
--   shops (company / SaaS tenant) 1─* branches (warehouses) 1─* warehouse_licenses *─0..1 customers (storage client)
--   warehouse_licenses 1─* license_overrides   (grace extensions and documented invoice overrides, append-only)
--   warehouse_licenses 1─* license_alerts      (one row per expiry reminder sent: 90/60/30/7 days and on expiry)
--   invoices *─* warehouse_licenses via invoice_licenses (what was checked when the invoice was issued)

-- Composite keys let a child row prove its parent is in the same shop (shop_id, id), so a licence can never point at
-- another shop's warehouse, customer, item or invoice, whatever the application does.
CREATE UNIQUE INDEX IF NOT EXISTS branches_shop_id_id_key ON branches (shop_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS customers_shop_id_id_key ON customers (shop_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS items_shop_id_id_key ON items (shop_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_shop_id_id_key ON invoices (shop_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS users_shop_id_id_key ON users (shop_id, id);

CREATE TABLE IF NOT EXISTS warehouse_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  customer_id uuid,                                   -- the storage client a capacity / seat licence is sold to
  license_type text NOT NULL CHECK (license_type IN ('regulatory', 'saas_seat', 'storage_capacity')),
  regulatory_kind text CHECK (regulatory_kind IN ('fssai', 'fire_noc', 'bonded_warehouse', 'trade', 'drug', 'pollution', 'other')),
  license_number text NOT NULL CHECK (length(trim(license_number)) BETWEEN 1 AND 60),
  issuing_authority text NOT NULL DEFAULT '',
  issue_date date NOT NULL,
  expiry_date date NOT NULL,
  grace_days int NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 365),
  max_capacity numeric(14,3) CHECK (max_capacity IS NULL OR max_capacity > 0),
  capacity_unit text NOT NULL DEFAULT '',             -- pallets, sq ft, seats …
  document_url text NOT NULL DEFAULT '',
  -- Kept up to date by every write and the daily job; billing always recomputes it from the dates (never trusts it).
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expiring_soon', 'grace', 'expired', 'suspended')),
  suspended boolean NOT NULL DEFAULT false,
  suspended_reason text NOT NULL DEFAULT '',
  -- Which invoices this licence gates: every invoice from the warehouse, only invoices with service lines (storage,
  -- inward handling, subscriptions), or none (kept for records and printing only).
  enforce_scope text NOT NULL DEFAULT 'service_items' CHECK (enforce_scope IN ('all', 'service_items', 'none')),
  print_on_invoice boolean NOT NULL DEFAULT true,
  -- Billing terms (capacity / seat licences sold to a client).
  term_start date NOT NULL,                           -- start of the current paid term, for proration
  renewal_item_id uuid,                               -- service item used on renewal and upgrade invoices
  renewal_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (renewal_price >= 0),  -- price of one full term, before tax
  term_months int NOT NULL DEFAULT 12 CHECK (term_months BETWEEN 1 AND 60),
  auto_renewal_invoice boolean NOT NULL DEFAULT false,
  renewal_lead_days int NOT NULL DEFAULT 30 CHECK (renewal_lead_days BETWEEN 1 AND 120),
  renewal_invoiced_for date,                          -- the expiry date a renewal invoice was already made for
  usage_item_id uuid,                                 -- the item storage / seat usage is billed with
  overage_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK (overage_rate >= 0),  -- per unit above max_capacity
  credit_balance numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_balance >= 0), -- from downgrades, used on the next renewal
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expiry_date >= issue_date),
  CHECK (term_start <= expiry_date),
  CHECK ((license_type = 'regulatory') = (regulatory_kind IS NOT NULL)),
  CHECK (license_type = 'regulatory' OR max_capacity IS NOT NULL),
  FOREIGN KEY (shop_id, branch_id) REFERENCES branches (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, renewal_item_id) REFERENCES items (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, usage_item_id) REFERENCES items (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, created_by) REFERENCES users (shop_id, id) ON DELETE SET NULL (created_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_licenses_number_key ON warehouse_licenses (shop_id, license_type, coalesce(regulatory_kind, ''), upper(license_number));
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_licenses_shop_id_id_key ON warehouse_licenses (shop_id, id);
CREATE INDEX IF NOT EXISTS warehouse_licenses_branch_idx ON warehouse_licenses (shop_id, branch_id);
CREATE INDEX IF NOT EXISTS warehouse_licenses_customer_idx ON warehouse_licenses (shop_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS warehouse_licenses_expiry_idx ON warehouse_licenses (expiry_date);
CREATE INDEX IF NOT EXISTS warehouse_licenses_status_idx ON warehouse_licenses (shop_id, status);

-- History is never deleted by a cascade (docs/DATABASE.md): every reference below is RESTRICT or SET NULL.

-- Append-only: a grace extension or invoice override is never edited, only revoked (revoked_at), so the trail stays.
CREATE TABLE IF NOT EXISTS license_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  license_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('grace_extension', 'invoice_override')),
  extra_days int CHECK (extra_days BETWEEN 1 AND 90),
  for_expiry date NOT NULL,                           -- the expiry it was granted against; a renewal retires it
  invoice_id uuid,
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  granted_by uuid,
  granted_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_name text,
  CHECK ((kind = 'grace_extension') = (extra_days IS NOT NULL)),
  FOREIGN KEY (shop_id, license_id) REFERENCES warehouse_licenses (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, invoice_id) REFERENCES invoices (shop_id, id) ON DELETE SET NULL (invoice_id),
  FOREIGN KEY (shop_id, granted_by) REFERENCES users (shop_id, id) ON DELETE SET NULL (granted_by)
);
CREATE INDEX IF NOT EXISTS license_overrides_license_idx ON license_overrides (license_id, created_at DESC);
CREATE INDEX IF NOT EXISTS license_overrides_invoice_idx ON license_overrides (invoice_id) WHERE invoice_id IS NOT NULL;

-- One row per reminder: the primary key makes the daily job idempotent (re-runs and two servers send it once).
CREATE TABLE IF NOT EXISTS license_alerts (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  license_id uuid NOT NULL,
  threshold int NOT NULL CHECK (threshold IN (90, 60, 30, 7, 0)),
  for_expiry date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivered boolean NOT NULL DEFAULT false,
  PRIMARY KEY (license_id, for_expiry, threshold),
  FOREIGN KEY (shop_id, license_id) REFERENCES warehouse_licenses (shop_id, id) ON DELETE RESTRICT
);

-- Which licences each issued invoice was checked against, their status then, and the override used if any.
CREATE TABLE IF NOT EXISTS invoice_licenses (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  license_id uuid NOT NULL,
  status_at_issue text NOT NULL,
  override_id uuid REFERENCES license_overrides(id) ON DELETE SET NULL,
  PRIMARY KEY (invoice_id, license_id),
  FOREIGN KEY (shop_id, invoice_id) REFERENCES invoices (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, license_id) REFERENCES warehouse_licenses (shop_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS invoice_licenses_license_idx ON invoice_licenses (license_id);
CREATE INDEX IF NOT EXISTS invoice_licenses_override_idx ON invoice_licenses (override_id) WHERE override_id IS NOT NULL;

-- Compliance Manager: a staff role for licences (see shared/permissions.ts).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('Owner', 'Manager', 'Accountant', 'Sales Staff', 'Warehouse', 'Collector', 'Compliance Manager', 'Viewer'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['warehouse_licenses', 'license_overrides', 'license_alerts', 'invoice_licenses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
        USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
        WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)$p$, t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'backup_read') THEN
      EXECUTE format($p$CREATE POLICY backup_read ON %I FOR SELECT USING (current_setting('app.backup_read', true) = 'on')$p$, t);
    END IF;
  END LOOP;
END $$;
