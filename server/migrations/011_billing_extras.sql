-- 011 — bill-level discount, MRP (tax-inclusive) billing and delivery challans.

-- What the user chose on the bill; the lines already carry the effective rates and discounts.
ALTER TABLE invoices ADD COLUMN bill_discount jsonb;                       -- {kind:'percent'|'amount', value}
ALTER TABLE invoices ADD COLUMN prices_include_tax boolean NOT NULL DEFAULT false;

-- Goods sent to a customer: with or without a sale yet. Tracks the order from dispatch to delivery.
CREATE TABLE delivery_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  number text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  customer jsonb NOT NULL,
  date date NOT NULL,
  purpose text NOT NULL DEFAULT 'Supply' CHECK (purpose IN ('Supply', 'Job work', 'On approval', 'Sales return', 'Other')),
  sales_order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  lines jsonb NOT NULL,      -- [{itemId,name,hsn,unit,qty,rate}]
  value numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Packed' CHECK (status IN ('Packed', 'Dispatched', 'Delivered', 'Invoiced', 'Cancelled')),
  transporter text NOT NULL DEFAULT '',
  vehicle_no text NOT NULL DEFAULT '',
  lr_no text NOT NULL DEFAULT '',
  received_by text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  dispatched_at timestamptz,
  delivered_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);
CREATE INDEX delivery_challans_shop_idx ON delivery_challans (shop_id, date DESC);

ALTER TABLE delivery_challans ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_challans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delivery_challans
  USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid);

-- Challans can carry attachments (signed copies, LR receipts).
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_entity_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_entity_check CHECK (entity IN (
  'invoice', 'bill', 'item', 'customer', 'vendor', 'expense', 'purchase_order', 'sales_order', 'credit_note',
  'stock_adjustment', 'stock_transfer', 'journal', 'payment', 'bill_payment', 'bank_transaction', 'delivery_challan'
));
