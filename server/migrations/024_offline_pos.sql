-- 024: offline counter billing. A bill made on the counter without internet is saved on the device with its own ID and
-- sent when the connection returns. The ID is kept on the invoice so the same bill is never saved twice, however many
-- times the device retries. Nullable column and a partial unique index only: existing invoices are unchanged.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_client_ref_uq ON invoices (shop_id, client_ref) WHERE client_ref IS NOT NULL;
-- When the bill was actually made at the counter (it reaches the server later).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS made_offline_at timestamptz;
