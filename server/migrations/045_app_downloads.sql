-- Apps offered on the website: the Android app (APK uploaded by the super admin, and/or its Play Store link).
-- The Windows installer is built with the server and needs no row here.
CREATE TABLE IF NOT EXISTS app_downloads (
  platform text PRIMARY KEY CHECK (platform IN ('android')),
  version text NOT NULL DEFAULT '',
  file_name text NOT NULL DEFAULT '',
  file bytea,
  bytes int NOT NULL DEFAULT 0,
  sha256 text NOT NULL DEFAULT '',
  play_url text NOT NULL DEFAULT '',
  uploaded_by uuid REFERENCES super_admins(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_downloads_uploaded_by_idx ON app_downloads (uploaded_by) WHERE uploaded_by IS NOT NULL;
