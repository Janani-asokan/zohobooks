-- Phase 6/7: chart of accounts, manual journals, per-shop role permissions, a Warehouse role,
-- and access to more than one organisation from a single login.

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code text NOT NULL DEFAULT '',
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  subtype text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_name_uq ON accounts (shop_id, lower(name)) WHERE NOT archived;

CREATE TABLE journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  number text NOT NULL,
  date date NOT NULL,
  reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  lines jsonb NOT NULL,
  total numeric(14,2) NOT NULL,
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);
CREATE INDEX journals_date_idx ON journals (shop_id, date);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts', 'journals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
      WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- Identity-level tables (read while resolving a session, before a tenant is chosen), like users.
CREATE TABLE role_permissions (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  role text NOT NULL,
  permissions text[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, role)
);

CREATE TABLE user_shops (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, shop_id)
);

ALTER TABLE sessions ADD COLUMN active_shop_id uuid REFERENCES shops(id) ON DELETE SET NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('Owner', 'Manager', 'Accountant', 'Sales Staff', 'Warehouse', 'Viewer'));

CREATE INDEX IF NOT EXISTS audit_log_shop_at_idx ON audit_log (shop_id, at DESC);
