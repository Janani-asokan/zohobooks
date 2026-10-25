-- 008 — inventory documents: stock adjustments, two-step transfers, serial numbers, item variants.

-- Variants: a group item (not sold itself) with child items, one per combination of attributes.
ALTER TABLE items ADD COLUMN parent_id uuid REFERENCES items(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN is_group boolean NOT NULL DEFAULT false;
ALTER TABLE items ADD COLUMN variant_attrs jsonb NOT NULL DEFAULT '{}'::jsonb;   -- {"Size":"M","Colour":"Red"} on a variant
ALTER TABLE items ADD COLUMN attributes jsonb NOT NULL DEFAULT '[]'::jsonb;      -- [{"name":"Size","values":["S","M"]}] on a group
ALTER TABLE items ADD COLUMN track_serials boolean NOT NULL DEFAULT false;
CREATE INDEX items_parent_idx ON items (shop_id, parent_id) WHERE parent_id IS NOT NULL;

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('opening', 'sale', 'sale_cancel', 'credit_note', 'adjustment', 'transfer_in', 'transfer_out', 'transfer_cancel', 'purchase'));

CREATE TABLE stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  number text NOT NULL,
  branch_id uuid NOT NULL REFERENCES branches(id),
  date date NOT NULL,
  reason text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('change', 'count')),
  lines jsonb NOT NULL,      -- [{itemId,name,unit,before,change,after,cost,value}]
  value numeric(14,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);

CREATE TABLE stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  number text NOT NULL,
  from_branch_id uuid NOT NULL REFERENCES branches(id),
  to_branch_id uuid NOT NULL REFERENCES branches(id),
  date date NOT NULL,
  status text NOT NULL CHECK (status IN ('In transit', 'Received', 'Cancelled')),
  lines jsonb NOT NULL,      -- [{itemId,name,unit,qty,batches:[{batchNo,qty,expiryDate}],serials:[]}]
  notes text NOT NULL DEFAULT '',
  received_at timestamptz,
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number),
  CHECK (from_branch_id <> to_branch_id)
);

CREATE TABLE item_serials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  serial text NOT NULL,
  status text NOT NULL CHECK (status IN ('In stock', 'Sold', 'In transit', 'Written off')),
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, item_id, serial)
);
CREATE INDEX item_serials_lookup ON item_serials (shop_id, item_id, status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_adjustments', 'stock_transfers', 'item_serials'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
      WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
