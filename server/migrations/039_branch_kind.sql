-- Stores and warehouses. Every branch was a store; a warehouse is a stock location that doesn't bill customers.
-- The plan's branch limit covers stores (plus the "More stores" add-on); warehouses come with the "More warehouses"
-- add-on. Existing branches stay stores, so nothing changes for shops until they add a warehouse. Additive only.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'store' CHECK (kind IN ('store', 'warehouse'));
