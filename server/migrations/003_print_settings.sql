-- 003 — per-shop print settings (thermal receipts, barcode labels)
ALTER TABLE organizations ADD COLUMN print_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
