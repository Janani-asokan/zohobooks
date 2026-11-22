-- Report files shared on WhatsApp. WhatsApp links can't carry a file, so "Share on WhatsApp" keeps the PDF, Excel or
-- CSV here for 7 days behind an unguessable link and sends that link. Like public_links, the row is found by its
-- token before the shop is known, so no row-level security; only the token opens a file. Expired files are removed
-- when new ones are shared. Additive only.

CREATE TABLE IF NOT EXISTS shared_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  token text NOT NULL UNIQUE,
  filename text NOT NULL,
  mime text NOT NULL,
  data bytea NOT NULL,
  title text NOT NULL DEFAULT '',
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS shared_files_shop_idx ON shared_files (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shared_files_expires_idx ON shared_files (expires_at);
