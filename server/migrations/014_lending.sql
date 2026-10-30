-- 014 — money lending: an optional module per business (borrowers, loans, collections and late charges).
-- Pricing and repayment rules live in shared/lending.ts; the ledger posts loans and receipts from these tables.

ALTER TABLE organizations ADD COLUMN lending_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('Owner', 'Manager', 'Accountant', 'Sales Staff', 'Warehouse', 'Collector', 'Viewer'));

CREATE TABLE lending_areas (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z]{2,4}$'),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (shop_id, code)
);

CREATE TABLE borrowers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  father_name text NOT NULL DEFAULT '',
  mobile text NOT NULL,
  address text NOT NULL DEFAULT '',
  area_code text NOT NULL,
  guarantor text NOT NULL DEFAULT '',
  -- Aadhaar is stored encrypted (AES-256-GCM); a keyed hash finds duplicates; only the last 4 digits are shown.
  aadhaar_enc jsonb,
  aadhaar_hash text,
  aadhaar_last4 text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Pending Verification' CHECK (status IN ('Pending Verification', 'Verified', 'Manual Verification Approved', 'Verification Failed')),
  status_note text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, code),
  UNIQUE (shop_id, mobile),
  FOREIGN KEY (shop_id, area_code) REFERENCES lending_areas(shop_id, code)
);
CREATE UNIQUE INDEX borrowers_aadhaar_uq ON borrowers (shop_id, aadhaar_hash) WHERE aadhaar_hash IS NOT NULL;

CREATE TABLE lending_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  number text NOT NULL,
  borrower_id uuid NOT NULL REFERENCES borrowers(id),
  loan_type text NOT NULL CHECK (loan_type IN ('Daily 100-Day', 'Weekly', 'Monthly EMI')),
  principal numeric(14,2) NOT NULL CHECK (principal > 0),
  monthly_rate numeric(7,4) NOT NULL,
  periods int NOT NULL CHECK (periods BETWEEN 1 AND 600),
  collector_id uuid REFERENCES users(id) ON DELETE SET NULL,
  collector_name text NOT NULL DEFAULT '',
  borrow_date date NOT NULL,
  first_due date NOT NULL,
  maturity date NOT NULL,
  instalment numeric(14,2) NOT NULL,
  upfront_interest numeric(14,2) NOT NULL,
  processing_fee numeric(14,2) NOT NULL DEFAULT 0,
  net_disbursed numeric(14,2) NOT NULL,
  calculated_net numeric(14,2) NOT NULL,
  cash_rounding numeric(14,2) NOT NULL DEFAULT 0,
  apr numeric(10,4) NOT NULL DEFAULT 0,
  late_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  disbursement_mode text NOT NULL DEFAULT 'Cash' CHECK (disbursement_mode IN ('Cash', 'UPI', 'Bank Transfer')),
  account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  ack_reference text NOT NULL DEFAULT '',
  existing_loan boolean NOT NULL DEFAULT false,
  already_repaid numeric(14,2) NOT NULL DEFAULT 0,
  entered_on date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Closed', 'Written Off')),
  closed_at timestamptz,
  closed_by text NOT NULL DEFAULT '',
  closure_reason text NOT NULL DEFAULT '',
  schedule jsonb NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);
CREATE INDEX lending_loans_borrower_idx ON lending_loans (borrower_id);
CREATE INDEX lending_loans_shop_status_idx ON lending_loans (shop_id, status);

CREATE TABLE lending_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES lending_loans(id),
  receipt_no text NOT NULL,
  date date NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  mode text NOT NULL CHECK (mode IN ('Cash', 'UPI', 'Bank Transfer', 'Opening balance')),
  reference text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('Collection', 'Prepayment', 'Closure', 'Opening balance')),
  principal_part numeric(14,2) NOT NULL DEFAULT 0,
  penalty_part numeric(14,2) NOT NULL DEFAULT 0,
  balance_before numeric(14,2) NOT NULL,
  balance_after numeric(14,2) NOT NULL,
  collector_id uuid REFERENCES users(id) ON DELETE SET NULL,
  collector_name text NOT NULL DEFAULT '',
  account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  request_id text,
  status text NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Reversed')),
  reversed_reason text NOT NULL DEFAULT '',
  reversed_by text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  UNIQUE (shop_id, receipt_no)
);
CREATE UNIQUE INDEX lending_payments_request_uq ON lending_payments (shop_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX lending_payments_loan_idx ON lending_payments (loan_id, at);
CREATE INDEX lending_payments_shop_date_idx ON lending_payments (shop_id, date);

CREATE TABLE lending_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES lending_loans(id),
  kind text NOT NULL CHECK (kind IN ('Late charge', 'Penalty', 'Penalty waiver')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  instalment int,
  reason text NOT NULL DEFAULT '',
  date date NOT NULL DEFAULT current_date,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lending_charges_late_uq ON lending_charges (loan_id, instalment) WHERE kind = 'Late charge';
CREATE INDEX lending_charges_loan_idx ON lending_charges (loan_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lending_areas', 'borrowers', 'lending_loans', 'lending_payments', 'lending_charges'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
      WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
