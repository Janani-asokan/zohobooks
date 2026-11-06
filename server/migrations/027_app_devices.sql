-- 027: CorpusLite phone app. Each phone or tablet that bills is registered once and gets its own short code (A1,
-- A2 … Z9). Bills it makes are numbered in its own continuous GST series, CODE/FY/SEQUENCE (for example
-- A1/2026-27/0001), so the final invoice number prints even with no internet. Additive only.
CREATE TABLE IF NOT EXISTS app_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  client_id text NOT NULL,           -- the phone's own random id, kept on the phone
  code text NOT NULL,                -- A1 … Z9: the prefix of its invoice series
  name text NOT NULL DEFAULT '',
  registered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_devices_client_uq ON app_devices (shop_id, client_id);
CREATE UNIQUE INDEX IF NOT EXISTS app_devices_code_uq ON app_devices (shop_id, code);
CREATE INDEX IF NOT EXISTS app_devices_registered_by_idx ON app_devices (registered_by);

-- Which device series an invoice belongs to (null: the shop's normal series).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES app_devices(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS invoices_device_idx ON invoices (device_id);

ALTER TABLE app_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_devices FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_devices' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON app_devices
      USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
      WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_devices' AND policyname = 'backup_read') THEN
    CREATE POLICY backup_read ON app_devices FOR SELECT USING (current_setting('app.backup_read', true) = 'on');
  END IF;
END $$;
