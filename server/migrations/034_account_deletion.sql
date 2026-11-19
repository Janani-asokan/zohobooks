-- Account deletion (Google Play requires it for apps that let people sign up).
-- A staff member can delete their own login at once: their name, email and password are wiped and they are signed out.
-- An owner can close the whole shop: everyone is signed out at once and, after 30 days (the window to change their
-- mind through support), the personal details of the shop's logins and owner are wiped. Bills and accounts stay as
-- Indian GST law requires (records_until), then go. Nothing is removed by a cascade (docs/DATABASE.md).

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE shops ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS deletion_reason text NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS personal_data_erased_at timestamptz;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS records_until date;

CREATE INDEX IF NOT EXISTS shops_deletion_due_idx ON shops (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND personal_data_erased_at IS NULL;
