-- 028: one printer profile per shop can be the default. Computers that have not picked a printer start with it, and
-- choosing a printer loads the label stock and turn saved on it (printer_profiles.settings.stockId / .turn).
ALTER TABLE printer_profiles ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS printer_profiles_default_uq ON printer_profiles (shop_id) WHERE is_default;
