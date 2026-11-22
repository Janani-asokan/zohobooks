-- Staff attendance (add-on). Staff check in and out from their own phone or laptop:
--   * location: where they were, and how far from their branch (when the branch's location is set);
--   * selfie: a small photo taken at that moment (Face level and up);
--   * device biometric: the phone's or laptop's own fingerprint / face unlock, through WebAuthn (Biometric level).
--     The device keeps the private key; we keep only its public key and check every signature, so a mark can't be
--     made from another device or replayed. The fingerprint itself never leaves the device.
-- The owner sees who is in, each mark's proof, and a monthly report. History is never deleted by a cascade.

ALTER TABLE branches ADD COLUMN IF NOT EXISTS geo_lat double precision CHECK (geo_lat BETWEEN -90 AND 90);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS geo_lng double precision CHECK (geo_lng BETWEEN -180 AND 180);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS geo_radius_m integer NOT NULL DEFAULT 150 CHECK (geo_radius_m BETWEEN 20 AND 5000);

CREATE TABLE IF NOT EXISTS attendance_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  credential_id text NOT NULL,           -- base64url, from the device
  public_key bytea NOT NULL,             -- SubjectPublicKeyInfo (DER)
  algorithm integer NOT NULL,            -- COSE: -7 ES256, -257 RS256, -8 EdDSA
  sign_count bigint NOT NULL DEFAULT 0,
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  removed_at timestamptz,
  UNIQUE (shop_id, credential_id),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, user_id) REFERENCES users (shop_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS attendance_devices_user_idx ON attendance_devices (shop_id, user_id);

CREATE TABLE IF NOT EXISTS attendance_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  user_name text NOT NULL,
  branch_id uuid,
  kind text NOT NULL CHECK (kind IN ('in', 'out')),
  day date NOT NULL,                     -- the working day (India time)
  at timestamptz NOT NULL DEFAULT now(),
  lat double precision CHECK (lat BETWEEN -90 AND 90),
  lng double precision CHECK (lng BETWEEN -180 AND 180),
  accuracy_m real,
  distance_m real,                       -- from the branch, when its location is set
  outside boolean NOT NULL DEFAULT false,
  selfie bytea,                          -- small JPEG
  method text NOT NULL CHECK (method IN ('biometric', 'selfie', 'location', 'manual')),
  device_id uuid,
  marked_by uuid,                        -- set when the owner / manager marked it by hand
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, user_id) REFERENCES users (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, branch_id) REFERENCES branches (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, device_id) REFERENCES attendance_devices (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, marked_by) REFERENCES users (shop_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS attendance_marks_user_day_idx ON attendance_marks (shop_id, user_id, day, at);
CREATE INDEX IF NOT EXISTS attendance_marks_day_idx ON attendance_marks (shop_id, day);
CREATE INDEX IF NOT EXISTS attendance_marks_branch_idx ON attendance_marks (shop_id, branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_marks_device_idx ON attendance_marks (shop_id, device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_marks_marked_by_idx ON attendance_marks (shop_id, marked_by) WHERE marked_by IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_devices', 'attendance_marks'] LOOP
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
