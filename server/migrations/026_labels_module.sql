-- 026: Barcode & Labels module (spec: Corpus360 Lite Barcode & Thermal Label Printing Module).
-- Barcode identity, label stock, printer, template and print job become separate records. Additive only: items keep
-- their barcode column (the primary barcode), and every existing barcode is copied in as that item's primary.

-- Barcodes per item (BL-01..BL-07). One primary per item, mirrored in items.barcode so billing, search and imports are
-- unchanged. A replaced barcode stays as an alias, so labels already on shelves still scan.
CREATE TABLE IF NOT EXISTS item_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  value text NOT NULL,
  symbology text NOT NULL DEFAULT 'CODE128' CHECK (symbology IN ('CODE128', 'EAN13', 'EAN8', 'UPC', 'QR')),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'alias')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS item_barcodes_value_uq ON item_barcodes (shop_id, value);
CREATE UNIQUE INDEX IF NOT EXISTS item_barcodes_primary_uq ON item_barcodes (item_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS item_barcodes_item_idx ON item_barcodes (item_id);

INSERT INTO item_barcodes (shop_id, item_id, value, symbology, is_primary)
SELECT i.shop_id, i.id, i.barcode,
       CASE WHEN i.barcode ~ '^\d{13}$' THEN 'EAN13' WHEN i.barcode ~ '^\d{12}$' THEN 'UPC' WHEN i.barcode ~ '^\d{8}$' THEN 'EAN8' ELSE 'CODE128' END,
       true
  FROM items i
 WHERE i.barcode <> '' AND NOT i.archived
ON CONFLICT DO NOTHING;

-- Label stock: physical geometry only (spec 4.2). Built-in presets live in code; these are the shop's own.
CREATE TABLE IF NOT EXISTS label_stocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  name text NOT NULL,
  geometry jsonb NOT NULL,          -- shared/labelEngine.ts StockGeometry, all in mm
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Printer profiles (spec 2.5, 6.4): language, dpi, head width, media, calibrated offsets. A workstation picks one.
CREATE TABLE IF NOT EXISTS printer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  settings jsonb NOT NULL,          -- shared/labelEngine.ts PrinterSettings
  last_good jsonb,                  -- settings before the last change, to restore (TP-13)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS printer_profiles_branch_idx ON printer_profiles (branch_id);

-- Templates (spec 2.3): a draft that is edited, and published versions that never change (BL-13).
CREATE TABLE IF NOT EXISTS label_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  name text NOT NULL,
  draft jsonb NOT NULL,             -- { w, h, elements[] }
  current_version int NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  categories text[] NOT NULL DEFAULT '{}',   -- default for these item categories (most specific wins, BL-14)
  archived boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS label_template_versions (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES label_templates(id) ON DELETE RESTRICT,
  version int NOT NULL,
  body jsonb NOT NULL,              -- { w, h, elements[] }, immutable
  published_by uuid,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, version)
);

-- Print jobs (spec 3.4): what was printed, from what, with which template version, stock and printer, and how far it
-- got. Lines keep a data snapshot so a reprint matches the original even after a price change (BP-12).
CREATE TABLE IF NOT EXISTS print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  idem_key text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('items', 'batches', 'purchase_order', 'bill', 'csv', 'scan', 'reprint')),
  source_id uuid,
  source_label text NOT NULL DEFAULT '',
  template_id uuid REFERENCES label_templates(id) ON DELETE SET NULL,
  template_version int NOT NULL DEFAULT 0,
  template_body jsonb NOT NULL,     -- the exact layout printed
  stock jsonb NOT NULL,             -- the stock geometry printed on
  printer_id uuid REFERENCES printer_profiles(id) ON DELETE SET NULL,
  printer jsonb,                    -- printer settings used
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'sending', 'sent', 'printed', 'partial', 'failed')),
  total_count int NOT NULL,
  sent_count int NOT NULL DEFAULT 0,
  printed_count int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_idem_uq ON print_jobs (shop_id, idem_key);
CREATE INDEX IF NOT EXISTS print_jobs_shop_created_idx ON print_jobs (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS print_jobs_source_idx ON print_jobs (shop_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS print_jobs_template_idx ON print_jobs (template_id);
CREATE INDEX IF NOT EXISTS print_jobs_printer_idx ON print_jobs (printer_id);

CREATE TABLE IF NOT EXISTS print_job_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES print_jobs(id) ON DELETE RESTRICT,
  position int NOT NULL,
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  batch_no text NOT NULL DEFAULT '',
  quantity int NOT NULL CHECK (quantity >= 0),
  snapshot jsonb NOT NULL            -- name, sku, barcode, prices, batch, expiry… as printed
);
CREATE INDEX IF NOT EXISTS print_job_lines_job_idx ON print_job_lines (job_id, position);
CREATE INDEX IF NOT EXISTS print_job_lines_item_idx ON print_job_lines (shop_id, item_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_barcodes', 'label_stocks', 'printer_profiles', 'label_templates', 'label_template_versions', 'print_jobs', 'print_job_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
        USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
        WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)$p$, t);
    END IF;
    -- Backups read every shop (migration 015).
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'backup_read') THEN
      EXECUTE format($p$CREATE POLICY backup_read ON %I FOR SELECT USING (current_setting('app.backup_read', true) = 'on')$p$, t);
    END IF;
  END LOOP;
END $$;

-- Keep item_barcodes in step with items.barcode, whichever screen changes it (item form, CSV import, bulk generate):
-- the new value becomes the primary; a replaced value stays as an alias so labels already on shelves still scan
-- (BL-06). A value already used by another item (as its barcode or an alias) is refused (BL-05).
CREATE OR REPLACE FUNCTION items_barcode_sync() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.barcode IS NOT DISTINCT FROM OLD.barcode AND NEW.archived IS NOT DISTINCT FROM OLD.archived THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.barcode <> '' AND OLD.barcode IS DISTINCT FROM NEW.barcode THEN
    UPDATE item_barcodes SET is_primary = false, status = 'alias' WHERE item_id = NEW.id AND value = OLD.barcode;
  END IF;
  IF NEW.barcode <> '' AND NOT NEW.archived THEN
    UPDATE item_barcodes SET is_primary = false WHERE item_id = NEW.id AND is_primary AND value <> NEW.barcode;
    INSERT INTO item_barcodes (shop_id, item_id, value, symbology, is_primary, status)
    VALUES (NEW.shop_id, NEW.id, NEW.barcode,
            CASE WHEN NEW.barcode ~ '^\d{13}$' THEN 'EAN13' WHEN NEW.barcode ~ '^\d{12}$' THEN 'UPC' WHEN NEW.barcode ~ '^\d{8}$' THEN 'EAN8' ELSE 'CODE128' END,
            true, 'active')
    ON CONFLICT (shop_id, value) DO UPDATE SET is_primary = (item_barcodes.item_id = EXCLUDED.item_id) OR item_barcodes.is_primary,
                                                status = CASE WHEN item_barcodes.item_id = EXCLUDED.item_id THEN 'active' ELSE item_barcodes.status END;
    IF EXISTS (SELECT 1 FROM item_barcodes WHERE shop_id = NEW.shop_id AND value = NEW.barcode AND item_id <> NEW.id) THEN
      RAISE EXCEPTION 'Barcode % is already used by another item', NEW.barcode USING ERRCODE = '23505';
    END IF;
  END IF;
  -- An archived item frees its values for reuse.
  IF NEW.archived THEN DELETE FROM item_barcodes WHERE item_id = NEW.id; END IF; -- data-safety: reviewed (a mirror of items.barcode; an archived item frees its codes for reuse)
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS items_barcode_sync ON items;
CREATE TRIGGER items_barcode_sync AFTER INSERT OR UPDATE OF barcode, archived ON items FOR EACH ROW EXECUTE FUNCTION items_barcode_sync();

-- Barcode generator settings (BL-03, BL-04): Code 128 from the SKU or a number series, the shop's in-store EAN-13
-- (prefix 2), or EAN-13 with the shop's GS1 company prefix once an admin enters it.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS label_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
