-- Business templates (shared/templates.ts): a shop's business type, the trade-specific fields its items carry,
-- its extra units and its trade details (drug licence, BIS registration, …). Everything is added with a default,
-- so existing shops and items stay exactly as they are.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT '';
-- Field definitions for items, e.g. [{"key":"purity","label":"Purity","type":"select","options":["22K","18K"]}]
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS item_fields jsonb NOT NULL DEFAULT '[]';
-- Units offered in the item form on top of the standard list, e.g. ["bunch","ton"]
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS units jsonb NOT NULL DEFAULT '[]';
-- Trade registrations shown to the owner and (later) on invoices, e.g. {"drugLicence":"TN-123"}
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trade_details jsonb NOT NULL DEFAULT '{}';

-- Values of the trade fields for one item, keyed by field key.
ALTER TABLE items ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}';

-- GST on gold, silver and jewellery is 3%; the slab was missing.
INSERT INTO tax_slabs (id, name, rate, active) VALUES ('tax_3', 'GST 3%', 3, true) ON CONFLICT (id) DO NOTHING;
