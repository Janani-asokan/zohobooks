-- 029: Customer support call-backs.
-- A shop owner books a call-back in a slot the system offers (support days, hours, slot length and how many calls
-- each slot can take are set by the platform). Platform staff (super admins) see every request in the Customer care
-- console, check the shop's account, call back and record the outcome. Additive only.

ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS support_days int[] NOT NULL DEFAULT '{1,2,3,4,5,6}'; -- ISO: 1 = Monday … 7 = Sunday
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS support_start text NOT NULL DEFAULT '10:00' CHECK (support_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS support_end text NOT NULL DEFAULT '18:00' CHECK (support_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS support_slot_minutes int NOT NULL DEFAULT 30 CHECK (support_slot_minutes IN (15, 20, 30, 45, 60));
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS support_slot_capacity int NOT NULL DEFAULT 2 CHECK (support_slot_capacity BETWEEN 1 AND 50);
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS support_booking_days int NOT NULL DEFAULT 14 CHECK (support_booking_days BETWEEN 1 AND 60);

CREATE TABLE IF NOT EXISTS support_callbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  contact_name text NOT NULL,
  phone text NOT NULL,
  topic text NOT NULL CHECK (topic IN ('billing', 'printing', 'gst', 'stock', 'account', 'other')),
  message text NOT NULL DEFAULT '',
  slot_start timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'missed', 'cancelled')),
  assigned_to uuid REFERENCES super_admins(id) ON DELETE SET NULL,
  staff_notes text NOT NULL DEFAULT '',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_callbacks_shop_idx ON support_callbacks (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_callbacks_slot_idx ON support_callbacks (slot_start) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS support_callbacks_requested_by_idx ON support_callbacks (requested_by);
CREATE INDEX IF NOT EXISTS support_callbacks_assigned_to_idx ON support_callbacks (assigned_to);

-- A shop sees only its own requests (tenant_isolation). Platform staff read and update every shop's requests through a
-- policy their sessions switch on (app.platform = 'on', set only by the Customer care routes). Backups read all.
ALTER TABLE support_callbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_callbacks FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'support_callbacks' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON support_callbacks
      USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
      WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'support_callbacks' AND policyname = 'backup_read') THEN
    CREATE POLICY backup_read ON support_callbacks FOR SELECT USING (current_setting('app.backup_read', true) = 'on');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'support_callbacks' AND policyname = 'platform_support') THEN
    CREATE POLICY platform_support ON support_callbacks
      USING (current_setting('app.platform', true) = 'on')
      WITH CHECK (current_setting('app.platform', true) = 'on');
  END IF;
END $$;
