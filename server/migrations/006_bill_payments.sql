-- 006 — partial payments against vendor bills ("payments made").
ALTER TABLE bills ADD COLUMN amount_paid numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);

CREATE TABLE bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  number text NOT NULL,
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  tds_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  mode text NOT NULL DEFAULT 'Bank Transfer',
  reference text NOT NULL DEFAULT '',
  account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);
CREATE INDEX bill_payments_idx ON bill_payments (shop_id, date DESC);
CREATE INDEX bill_payments_bill_idx ON bill_payments (bill_id);
ALTER TABLE bill_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bill_payments
  USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid);

-- Backfill: every bill marked Paid so far was paid in full by one bank withdrawal.
-- Tenant tables force row-level security, so the backfill runs shop by shop with app.shop_id set.
DO $$
DECLARE s uuid;
BEGIN
  FOR s IN SELECT id FROM shops LOOP
    PERFORM set_config('app.shop_id', s::text, true);
    INSERT INTO bill_payments (shop_id, number, bill_id, vendor_id, date, amount, mode, account_id)
    SELECT b.shop_id,
           'PM-' || lpad((row_number() OVER (ORDER BY coalesce(t.date, b.date), b.created_at))::text, 4, '0'),
           b.id, b.vendor_id, coalesce(t.date, b.date), b.amount, 'Bank Transfer', t.account_id
    FROM bills b
    LEFT JOIN LATERAL (SELECT date, account_id FROM bank_transactions WHERE shop_id = s AND ref_type = 'bill' AND ref_id = b.id ORDER BY created_at LIMIT 1) t ON true
    WHERE b.shop_id = s AND b.status = 'Paid';
    UPDATE bills SET amount_paid = amount WHERE shop_id = s AND status = 'Paid';
    UPDATE bank_transactions t SET ref_type = 'bill_payment', ref_id = p.id
      FROM bill_payments p WHERE t.shop_id = s AND p.shop_id = s AND t.ref_type = 'bill' AND t.ref_id = p.bill_id;
    INSERT INTO counters (shop_id, key, value)
      SELECT s, 'pm', count(*) FROM bill_payments WHERE shop_id = s HAVING count(*) > 0
      ON CONFLICT (shop_id, key) DO UPDATE SET value = EXCLUDED.value;
  END LOOP;
  PERFORM set_config('app.shop_id', '', true);
END $$;
