-- GSTIN lookups (Validate next to a GST number): what the lookup service returned, kept for 30 days so the same
-- number isn't paid for twice. Public register data, the same for every shop, so a platform table without row-level
-- security; nothing about the shop that asked is stored. Additive only.
CREATE TABLE IF NOT EXISTS gstin_lookups (
  gstin text PRIMARY KEY CHECK (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  data jsonb,                       -- null: the service said there is no such GSTIN
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gstin_lookups_fetched_idx ON gstin_lookups (fetched_at);
