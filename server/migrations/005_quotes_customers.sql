-- 005 — quotes (estimates) share the sales-document table with sales orders; customer credit limits and contact history.
ALTER TABLE sales_orders ADD COLUMN kind text NOT NULL DEFAULT 'order' CHECK (kind IN ('quote', 'order'));
ALTER TABLE sales_orders ADD COLUMN source_id uuid REFERENCES sales_orders(id);
ALTER TABLE sales_orders DROP CONSTRAINT sales_orders_status_check;
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check CHECK (status IN ('Draft', 'Sent', 'Accepted', 'Declined'));
CREATE INDEX sales_orders_kind_idx ON sales_orders (shop_id, kind, created_at DESC);

ALTER TABLE customers ADD COLUMN credit_limit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0);

CREATE TABLE customer_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('note', 'call', 'email', 'meeting', 'whatsapp')),
  body text NOT NULL,
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_activity_idx ON customer_activity (shop_id, customer_id, created_at DESC);
ALTER TABLE customer_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_activity
  USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid);
