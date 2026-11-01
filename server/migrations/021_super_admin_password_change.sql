-- 021: a super admin can be asked to set a new password on next sign-in (used when the account still has the public
-- demo password). Adds one column; no data changes.
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
