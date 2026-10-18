-- 004 — fields printed on tax invoices: ship-to address, terms, e-way bill reference
ALTER TABLE invoices ADD COLUMN ship_to jsonb;
ALTER TABLE invoices ADD COLUMN terms text NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN eway jsonb;
