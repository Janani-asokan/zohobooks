-- AI usage limits. Every AI call is recorded with its real token counts and cost, each AI level includes a monthly
-- allowance of AI credits (1 credit = US$0.004 of AI cost), and the platform can grant extra credits for a month.
-- Like shop_features, these are platform billing records read with the shop id in code, so no row-level security.

-- Credits included per month with a feature level (only the AI levels use it; null = no allowance).
ALTER TABLE feature_prices ADD COLUMN IF NOT EXISTS included_credits integer CHECK (included_credits >= 0);

-- What one top-up pack gives and costs; the platform owner can change both.
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS ai_topup_credits integer NOT NULL DEFAULT 500 CHECK (ai_topup_credits > 0);
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS ai_topup_price numeric(12,2) NOT NULL DEFAULT 249 CHECK (ai_topup_price >= 0);

-- One row per AI request (a multi-step assistant answer writes one row per step). Never updated or deleted.
CREATE TABLE ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  purpose text NOT NULL,                       -- assistant, smart_reader, bill_parse, …
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  credits numeric(12,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_shop_id_idx ON ai_usage (shop_id, created_at);
CREATE INDEX ai_usage_user_id_idx ON ai_usage (user_id);

-- Extra credits for one month: asked for by the shop, granted (after payment) or declined by the platform.
CREATE TABLE ai_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  credits integer NOT NULL CHECK (credits > 0),
  price numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  status text NOT NULL CHECK (status IN ('requested', 'granted', 'declined')),
  note text NOT NULL DEFAULT '',
  requested_by text NOT NULL DEFAULT '',
  decided_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX ai_topups_shop_id_idx ON ai_topups (shop_id, month);
CREATE UNIQUE INDEX ai_topups_one_request ON ai_topups (shop_id) WHERE status = 'requested';
