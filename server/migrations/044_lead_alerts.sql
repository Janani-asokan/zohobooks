-- Sales leads must reach a person: who was told, and when a reminder went out for a lead nobody has called yet.
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS notified_to text NOT NULL DEFAULT '';
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
-- Filled from a hidden form field that people never see: kept (never thrown away) but marked, in case a browser's
-- autofill filled it for a real person.
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS suspected_spam boolean NOT NULL DEFAULT false;
