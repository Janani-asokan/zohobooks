-- 022: festival offers and loyalty points (shared/offers.ts). Adds two tables and columns with defaults only, so
-- every existing shop, invoice and customer stays exactly as it is.

-- Offers a shop runs for a festival or a sale. Never deleted: an ended offer stays for the bills that used it.
CREATE TABLE offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('item', 'bill')),
  discount_kind text NOT NULL CHECK (discount_kind IN ('percent', 'amount')),
  value numeric(12,2) NOT NULL CHECK (value > 0),
  scope text NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'category', 'items')),
  categories text[] NOT NULL DEFAULT '{}',
  item_ids uuid[] NOT NULL DEFAULT '{}',
  min_bill numeric(12,2) NOT NULL DEFAULT 0 CHECK (min_bill >= 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  message text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (kind = 'bill' OR discount_kind = 'percent'),
  CHECK (discount_kind = 'amount' OR value <= 100)
);
CREATE INDEX offers_shop_dates_idx ON offers (shop_id, starts_on, ends_on);
CREATE INDEX offers_shop_id_idx ON offers (shop_id);
CREATE INDEX offers_created_by_idx ON offers (created_by);

-- Every change to a customer's points, so a balance can always be explained. Reversals add a row; nothing is edited.
CREATE TABLE loyalty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  credit_note_id uuid REFERENCES credit_notes(id) ON DELETE RESTRICT,
  points numeric(12,2) NOT NULL CHECK (points <> 0),
  kind text NOT NULL CHECK (kind IN ('earn', 'redeem', 'reverse', 'adjust')),
  note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_ledger_customer_idx ON loyalty_ledger (shop_id, customer_id, created_at DESC);
CREATE INDEX loyalty_ledger_shop_id_idx ON loyalty_ledger (shop_id);
CREATE INDEX loyalty_ledger_customer_id_idx ON loyalty_ledger (customer_id);
CREATE INDEX loyalty_ledger_invoice_id_idx ON loyalty_ledger (invoice_id);
CREATE INDEX loyalty_ledger_credit_note_id_idx ON loyalty_ledger (credit_note_id);
CREATE INDEX loyalty_ledger_created_by_idx ON loyalty_ledger (created_by);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['offers', 'loyalty_ledger'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
      WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)$p$, t);
    EXECUTE format($p$CREATE POLICY backup_read ON %I FOR SELECT USING (current_setting('app.backup_read', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- What offers and points did on each invoice, for the printed bill and reports.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS offers_applied jsonb NOT NULL DEFAULT '[]';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS offers_skipped jsonb NOT NULL DEFAULT '[]';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS loyalty_points_used numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS loyalty_discount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS loyalty_points_earned numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS loyalty_balance_after numeric(12,2);

-- The shop's loyalty rules (shared/offers.ts LoyaltySettings). Empty = loyalty off.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS loyalty jsonb NOT NULL DEFAULT '{}';

-- Shops that have every add-on with no end date (demo and complimentary shops) get this new add-on the same way.
INSERT INTO shop_features (shop_id, feature_key, level, status, source, starts_on, note, decided_by)
SELECT sf.shop_id, 'offers_loyalty', 'standard', 'active', sf.source, current_date, 'Added with offers and loyalty', 'migration 022'
FROM shop_features sf
WHERE sf.feature_key = 'pos' AND sf.status = 'active' AND sf.ends_on IS NULL AND sf.source IN ('grandfathered', 'complimentary')
  AND NOT EXISTS (SELECT 1 FROM shop_features x WHERE x.shop_id = sf.shop_id AND x.feature_key = 'offers_loyalty' AND x.status = 'active');
