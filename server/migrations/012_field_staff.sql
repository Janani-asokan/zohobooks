-- 012 — field staff (salesman) tracking: duty days, location pings while on duty, and customer visits.
-- Location is only recorded between "Start day" and "End day", which the staff member taps themselves.

CREATE TABLE field_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_name text NOT NULL,
  date date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  start_lat double precision, start_lng double precision,
  end_lat double precision, end_lng double precision,
  UNIQUE (shop_id, user_id, date)
);

CREATE TABLE field_pings (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  day_id uuid NOT NULL REFERENCES field_days(id) ON DELETE CASCADE,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy real,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_pings_day_idx ON field_pings (day_id, at);

CREATE TABLE field_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  day_id uuid REFERENCES field_days(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  user_name text NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  purpose text NOT NULL DEFAULT 'Sales visit' CHECK (purpose IN ('Sales visit', 'Order', 'Payment collection', 'Delivery', 'Service', 'Other')),
  lat double precision, lng double precision, accuracy real,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_out_at timestamptz,
  outcome text NOT NULL DEFAULT '' CHECK (outcome IN ('', 'Order taken', 'Payment collected', 'Follow up', 'Not interested', 'Shop closed', 'Delivered', 'Other')),
  order_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (order_value >= 0),
  collected numeric(14,2) NOT NULL DEFAULT 0 CHECK (collected >= 0),
  notes text NOT NULL DEFAULT '',
  next_visit date
);
CREATE INDEX field_visits_shop_idx ON field_visits (shop_id, checked_in_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['field_days', 'field_pings', 'field_visits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
      WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
