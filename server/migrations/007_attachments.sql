-- 007 — files (PDFs, photos) attached to any record.
CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  entity text NOT NULL CHECK (entity IN ('invoice', 'bill', 'item', 'customer', 'vendor', 'expense', 'purchase_order', 'sales_order', 'credit_note')),
  entity_id uuid NOT NULL,
  filename text NOT NULL,
  mime text NOT NULL,
  size int NOT NULL CHECK (size > 0),
  data bytea NOT NULL,
  uploaded_by uuid,
  uploaded_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_entity_idx ON attachments (shop_id, entity, entity_id, created_at DESC);
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attachments
  USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid);
