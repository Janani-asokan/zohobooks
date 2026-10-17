-- =====================================================================
-- 002 — Zoho Inventory-style purchasing & richer items
-- Purchase orders (receive into stock), itemised bills, expenses,
-- item category / brand / image / MRP.
-- =====================================================================

ALTER TABLE items
  ADD COLUMN category text NOT NULL DEFAULT '',
  ADD COLUMN brand text NOT NULL DEFAULT '',
  ADD COLUMN image text NOT NULL DEFAULT '',
  ADD COLUMN mrp numeric(14,2) CHECK (mrp IS NULL OR mrp >= 0);
CREATE INDEX items_category_idx ON items (shop_id, category);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  number text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  branch_id uuid REFERENCES branches(id),
  date date NOT NULL,
  expected_date date,
  lines jsonb NOT NULL,                 -- [{id,itemId,name,unit,qty,rate,taxRate,amount,received}]
  status text NOT NULL CHECK (status IN ('Draft', 'Issued', 'Partially Received', 'Received', 'Cancelled')),
  sub_total numeric(14,2) NOT NULL DEFAULT 0,
  tax_total numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);

ALTER TABLE bills
  ADD COLUMN lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN branch_id uuid REFERENCES branches(id),
  ADD COLUMN purchase_order_id uuid REFERENCES purchase_orders(id),
  ADD COLUMN stock_added boolean NOT NULL DEFAULT false;

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  date date NOT NULL,
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  vendor_id uuid REFERENCES vendors(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),       -- before GST
  tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  account_id uuid REFERENCES bank_accounts(id),
  reference text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_shop_date_idx ON expenses (shop_id, date DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_orders', 'expenses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
      WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
