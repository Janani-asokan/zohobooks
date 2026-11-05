-- 025: the shop's bank account as separate fields (account holder, bank, account number, IFSC, branch, note) instead of
-- one text box. The printed "Pay to" text (bank_details) is still kept and is now built from these fields when the
-- profile is saved. Columns with defaults only: shops that typed the old text box keep it, and the profile screen
-- shows it split into the fields until they save.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bank_account_name text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bank_name text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bank_account_no text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bank_ifsc text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bank_branch text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bank_note text NOT NULL DEFAULT '';
