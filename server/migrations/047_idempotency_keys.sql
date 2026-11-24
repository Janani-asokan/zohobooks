-- Saves made offline are sent later, and a reply can be lost on a weak connection, so the same change can arrive
-- twice. Each change carries an Idempotency-Key: the first time it is done and its answer kept here; a repeat gets
-- the same answer without doing it again. Kept 30 days.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status int NOT NULL DEFAULT 0, -- 0 while the change is being done
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys (created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['idempotency_keys'] LOOP
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
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'platform_support') THEN
      EXECUTE format($p$CREATE POLICY platform_support ON %I
        USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on')$p$, t);
    END IF;
  END LOOP;
END $$;
