-- Inter-branch stock transfers with batches, destination pricing and email-OTP receipt (docs/stock-transfers.md).
--
--   branches ── manager_user_id ──► users          (who gets the receipt OTP; falls back to the branch's managers, then the owner)
--   item_batches (ProductBatches)                  + purchase cost, received date, season, origin branch, branch selling price
--   item_stock                                     + branch selling price, for items without batches
--   branch_pricing_rules (BranchPricingRules)      location and seasonal modifiers
--   stock_transfers (StockTransfers)               + Draft status, receiver, verification method, e-way bill, discrepancy
--   stock_transfer_items (StockTransferItems)      one row per item and batch: sent / received / damaged / missing, cost, prices
--   transfer_otps + transfer_otp_logs (TransferOTPLogs)  hashed codes, and every send, failed try and verification
-- History is never deleted by a cascade (docs/DATABASE.md): references are RESTRICT or SET NULL.

/* ---------- Branches: GST registration and the receiving manager ---------- */
ALTER TABLE branches ADD COLUMN IF NOT EXISTS gstin text NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_user_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branches_manager_fk') THEN
    ALTER TABLE branches ADD CONSTRAINT branches_manager_fk FOREIGN KEY (shop_id, manager_user_id) REFERENCES users (shop_id, id) ON DELETE SET NULL (manager_user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS branches_manager_idx ON branches (shop_id, manager_user_id) WHERE manager_user_id IS NOT NULL;

/* ---------- Batches (ProductBatches) ---------- */
ALTER TABLE item_batches ADD COLUMN IF NOT EXISTS unit_cost numeric(14,4) CHECK (unit_cost IS NULL OR unit_cost >= 0);
ALTER TABLE item_batches ADD COLUMN IF NOT EXISTS received_on date;
ALTER TABLE item_batches ADD COLUMN IF NOT EXISTS season text NOT NULL DEFAULT '';
ALTER TABLE item_batches ADD COLUMN IF NOT EXISTS origin_branch_id uuid;
ALTER TABLE item_batches ADD COLUMN IF NOT EXISTS selling_price numeric(14,2) CHECK (selling_price IS NULL OR selling_price >= 0);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_batches_origin_fk') THEN
    ALTER TABLE item_batches ADD CONSTRAINT item_batches_origin_fk FOREIGN KEY (shop_id, origin_branch_id) REFERENCES branches (shop_id, id) ON DELETE SET NULL (origin_branch_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS item_batches_origin_idx ON item_batches (shop_id, origin_branch_id) WHERE origin_branch_id IS NOT NULL;

ALTER TABLE item_stock ADD COLUMN IF NOT EXISTS selling_price numeric(14,2) CHECK (selling_price IS NULL OR selling_price >= 0);

/* ---------- Location and seasonal price modifiers (BranchPricingRules) ---------- */
CREATE TABLE IF NOT EXISTS branch_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('location', 'seasonal')),
  branch_id uuid,                                   -- null: every branch
  item_id uuid,                                     -- null: every item, or the category below
  category text,
  adjust_type text NOT NULL CHECK (adjust_type IN ('percent', 'amount')),
  adjust_value numeric(12,4) NOT NULL,
  starts_on date,
  ends_on date,
  priority int NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 10000),
  round_to numeric(8,2) NOT NULL DEFAULT 0 CHECK (round_to >= 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (adjust_type <> 'percent' OR adjust_value BETWEEN -95 AND 500),
  CHECK (kind = 'location' OR (starts_on IS NOT NULL AND ends_on IS NOT NULL AND ends_on >= starts_on)),
  FOREIGN KEY (shop_id, branch_id) REFERENCES branches (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, item_id) REFERENCES items (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, created_by) REFERENCES users (shop_id, id) ON DELETE SET NULL (created_by)
);
CREATE INDEX IF NOT EXISTS branch_pricing_rules_branch_idx ON branch_pricing_rules (shop_id, branch_id);
CREATE INDEX IF NOT EXISTS branch_pricing_rules_item_idx ON branch_pricing_rules (shop_id, item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS branch_pricing_rules_created_by_idx ON branch_pricing_rules (shop_id, created_by) WHERE created_by IS NOT NULL;

/* ---------- Transfers (StockTransfers) ---------- */
CREATE UNIQUE INDEX IF NOT EXISTS stock_transfers_shop_id_id_key ON stock_transfers (shop_id, id);
ALTER TABLE stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_status_check;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_status_check CHECK (status IN ('Draft', 'In transit', 'Received', 'Cancelled'));
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS received_by uuid;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS received_by_name text NOT NULL DEFAULT '';
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS verified_via text CHECK (verified_via IN ('otp', 'owner_override', 'before_otp'));
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS override_reason text NOT NULL DEFAULT '';
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS discrepancy_note text NOT NULL DEFAULT '';
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS loss_value numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS eway_bill_no text NOT NULL DEFAULT '';
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS vehicle_no text NOT NULL DEFAULT '';
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_received_by_fk') THEN
    ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_received_by_fk FOREIGN KEY (shop_id, received_by) REFERENCES users (shop_id, id) ON DELETE SET NULL (received_by);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS stock_transfers_received_by_idx ON stock_transfers (shop_id, received_by) WHERE received_by IS NOT NULL;

/* ---------- Transfer lines (StockTransferItems) ---------- */
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  transfer_id uuid NOT NULL,
  line_no int NOT NULL,
  item_id uuid NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT '',
  hsn text NOT NULL DEFAULT '',
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  batch_no text NOT NULL DEFAULT '',
  expiry_date date,
  season text NOT NULL DEFAULT '',
  serials text[] NOT NULL DEFAULT '{}',
  qty_sent numeric(14,3) NOT NULL CHECK (qty_sent > 0),
  qty_received numeric(14,3) CHECK (qty_received >= 0),
  qty_damaged numeric(14,3) CHECK (qty_damaged >= 0),
  qty_missing numeric(14,3) CHECK (qty_missing >= 0),
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,       -- the batch's purchase cost, carried unchanged to the destination
  source_price numeric(14,2),                       -- selling price at the source when sent
  dest_price numeric(14,2),                         -- destination price worked out when sent (shown on the transfer note)
  dest_price_applied numeric(14,2),                 -- price set at the destination on receipt (rules on that day)
  manual_price boolean NOT NULL DEFAULT false,
  price_rules jsonb NOT NULL DEFAULT '[]',          -- the rules used, for the record
  UNIQUE (transfer_id, line_no),
  CHECK (qty_received IS NULL OR qty_received + coalesce(qty_damaged, 0) + coalesce(qty_missing, 0) = qty_sent),
  FOREIGN KEY (shop_id, transfer_id) REFERENCES stock_transfers (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, item_id) REFERENCES items (shop_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS stock_transfer_items_item_idx ON stock_transfer_items (shop_id, item_id);


/* ---------- Existing data ----------
 * Row-level security is forced on these tables, also for the role migrations run as, so the data steps run once per
 * shop with that shop set (a plain UPDATE here would see no rows on a server whose database role can't bypass RLS). */
DO $$
DECLARE s uuid;
BEGIN
  FOR s IN SELECT id FROM shops LOOP
    PERFORM set_config('app.shop_id', s::text, true);
    -- Batches already on hand: their cost is the item's cost today (the best record there is).
    UPDATE item_batches b SET unit_cost = i.cost, received_on = b.created_at::date FROM items i
     WHERE i.id = b.item_id AND b.shop_id = s AND b.unit_cost IS NULL;
    UPDATE stock_transfers SET verified_via = 'before_otp' WHERE shop_id = s AND status = 'Received' AND verified_via IS NULL;
    UPDATE stock_transfers SET dispatched_at = created_at WHERE shop_id = s AND dispatched_at IS NULL AND status <> 'Draft';
    -- Earlier transfers kept their lines as JSON: copy them into rows (one per batch), so every transfer reads the same way.
    INSERT INTO stock_transfer_items (shop_id, transfer_id, line_no, item_id, name, unit, hsn, tax_rate, batch_no, expiry_date, serials,
                                      qty_sent, qty_received, qty_damaged, qty_missing, unit_cost, source_price, dest_price, dest_price_applied)
    SELECT t.shop_id, t.id, (row_number() OVER (PARTITION BY t.id ORDER BY l.ord, b.ord))::int, i.id, coalesce(l.v->>'name', i.name), coalesce(l.v->>'unit', i.unit), i.hsn,
           coalesce(ts.rate, 0), coalesce(b.v->>'batchNo', ''), nullif(b.v->>'expiryDate', '')::date,
           CASE WHEN b.ord IS NULL OR b.ord = 1 THEN coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(l.v->'serials', '[]'))), '{}') ELSE '{}' END,
           coalesce((b.v->>'qty')::numeric, (l.v->>'qty')::numeric),
           CASE WHEN t.status = 'Received' THEN coalesce((b.v->>'qty')::numeric, (l.v->>'qty')::numeric) END,
           CASE WHEN t.status = 'Received' THEN 0 END, CASE WHEN t.status = 'Received' THEN 0 END,
           i.cost, i.sp1, i.sp1, CASE WHEN t.status = 'Received' THEN i.sp1 END
      FROM stock_transfers t
      CROSS JOIN LATERAL jsonb_array_elements(t.lines) WITH ORDINALITY AS l(v, ord)
      JOIN items i ON i.id = (l.v->>'itemId')::uuid
      LEFT JOIN tax_slabs ts ON ts.id = i.tax_slab_id
      LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_array_length(coalesce(l.v->'batches', '[]')) > 0 THEN l.v->'batches' END) WITH ORDINALITY AS b(v, ord) ON true
     WHERE t.shop_id = s AND NOT EXISTS (SELECT 1 FROM stock_transfer_items x WHERE x.transfer_id = t.id);
  END LOOP;
  PERFORM set_config('app.shop_id', '', true);
END $$;

/* ---------- OTP codes and their log (TransferOTPLogs) ---------- */
CREATE TABLE IF NOT EXISTS transfer_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  transfer_id uuid NOT NULL,
  code_hash text NOT NULL,                          -- HMAC-SHA256 of the code; the code itself is never stored
  sent_to_user_id uuid,
  sent_to_email text NOT NULL,
  delivered boolean NOT NULL DEFAULT false,
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  superseded_at timestamptz,
  FOREIGN KEY (shop_id, transfer_id) REFERENCES stock_transfers (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, sent_to_user_id) REFERENCES users (shop_id, id) ON DELETE SET NULL (sent_to_user_id)
);
CREATE INDEX IF NOT EXISTS transfer_otps_transfer_idx ON transfer_otps (transfer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfer_otps_user_idx ON transfer_otps (shop_id, sent_to_user_id) WHERE sent_to_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transfer_otps_shop_id_id_key ON transfer_otps (shop_id, id);

CREATE TABLE IF NOT EXISTS transfer_otp_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  transfer_id uuid NOT NULL,
  otp_id uuid,
  event text NOT NULL CHECK (event IN ('sent', 'resent', 'send_failed', 'verify_failed', 'expired', 'locked', 'verified', 'owner_override', 'cancelled')),
  user_id uuid,
  user_name text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '',
  detail jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (shop_id, transfer_id) REFERENCES stock_transfers (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, otp_id) REFERENCES transfer_otps (shop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id, user_id) REFERENCES users (shop_id, id) ON DELETE SET NULL (user_id)
);
CREATE INDEX IF NOT EXISTS transfer_otp_logs_transfer_idx ON transfer_otp_logs (transfer_id, at DESC);
CREATE INDEX IF NOT EXISTS transfer_otp_logs_otp_idx ON transfer_otp_logs (shop_id, otp_id) WHERE otp_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transfer_otp_logs_user_idx ON transfer_otp_logs (shop_id, user_id) WHERE user_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branch_pricing_rules', 'stock_transfer_items', 'transfer_otps', 'transfer_otp_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
        USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
        WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)$p$, t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'backup_read') THEN
      EXECUTE format($p$CREATE POLICY backup_read ON %I FOR SELECT USING (current_setting('app.backup_read', true) = 'on')$p$, t);
    END IF;
  END LOOP;
END $$;
