-- Pay-per-feature. The catalogue (what each feature unlocks) is in shared/features.ts. This adds the prices the
-- platform owner sets, and which features each shop has, with full history.
--
-- Like subscription_payments, these are the platform's own billing records, not shop data. They are read before a
-- shop context exists (on every request, to check the shop's features), so they do not use row-level security.
-- Every query filters by shop_id in code.

CREATE TABLE feature_prices (
  feature_key text NOT NULL,
  level text NOT NULL,
  monthly numeric(12,2) NOT NULL CHECK (monthly >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT '',
  PRIMARY KEY (feature_key, level)
);

-- One row per period a shop had (or asked for) a feature. Rows are never deleted: ending a feature sets
-- status = 'ended', so the history of who had what, when and at what price is kept.
CREATE TABLE shop_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  feature_key text NOT NULL,
  level text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested', 'active', 'ended')),
  source text NOT NULL CHECK (source IN ('grandfathered', 'trial', 'paid', 'complimentary', 'request')),
  starts_on date NOT NULL DEFAULT current_date,
  ends_on date,                                  -- null = no end date
  monthly_price numeric(12,2),                   -- the price agreed for this period, kept even if prices change later
  note text NOT NULL DEFAULT '',
  requested_by text NOT NULL DEFAULT '',
  decided_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX shop_features_shop_id_idx ON shop_features (shop_id);
-- At most one live period and one open request per shop and feature.
CREATE UNIQUE INDEX shop_features_one_active ON shop_features (shop_id, feature_key) WHERE status = 'active';
CREATE UNIQUE INDEX shop_features_one_request ON shop_features (shop_id, feature_key) WHERE status = 'requested';

-- Every shop that exists today keeps every feature it has today, with no end date, so nothing changes for them.
INSERT INTO shop_features (shop_id, feature_key, level, status, source, starts_on, note, decided_by)
SELECT s.id, f.key, 'standard', 'active', 'grandfathered', s.license_start, 'Included before pay-per-feature', 'migration 016'
FROM shops s
CROSS JOIN (VALUES ('quotes_orders'), ('recurring'), ('pos'), ('purchases'), ('inventory_plus'), ('accounting'),
                   ('tally'), ('field'), ('ai'), ('microfinance')) AS f(key);
