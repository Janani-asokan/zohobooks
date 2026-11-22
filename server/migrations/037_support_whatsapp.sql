-- WhatsApp support: shops tap "WhatsApp us" in Help, WhatsApp opens on their phone or computer with a message
-- already written (shop, name, what they need), and they send it to the support team's WhatsApp number. The team
-- answers from the WhatsApp Business app (free; no WhatsApp API or Meta account needed). Each tap is recorded here,
-- with the help-bot conversation, so the team sees in Customer care who reached out and about what, and can mark it
-- handled. History is never deleted by a cascade (docs/DATABASE.md). Additive only.

ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS support_whatsapp text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS support_whatsapp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  user_id uuid,
  contact_name text NOT NULL,
  question text NOT NULL DEFAULT '',
  chat jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  handled_by uuid REFERENCES super_admins(id) ON DELETE SET NULL,
  staff_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  FOREIGN KEY (shop_id, user_id) REFERENCES users (shop_id, id) ON DELETE SET NULL (user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS support_whatsapp_shop_id_id_key ON support_whatsapp (shop_id, id);
CREATE INDEX IF NOT EXISTS support_whatsapp_shop_idx ON support_whatsapp (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_whatsapp_open_idx ON support_whatsapp (created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS support_whatsapp_user_idx ON support_whatsapp (shop_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_whatsapp_handled_by_idx ON support_whatsapp (handled_by) WHERE handled_by IS NOT NULL;

ALTER TABLE support_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_whatsapp FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'support_whatsapp' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON support_whatsapp
      USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
      WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'support_whatsapp' AND policyname = 'backup_read') THEN
    CREATE POLICY backup_read ON support_whatsapp FOR SELECT USING (current_setting('app.backup_read', true) = 'on');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'support_whatsapp' AND policyname = 'platform_support') THEN
    CREATE POLICY platform_support ON support_whatsapp
      USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');
  END IF;
END $$;
