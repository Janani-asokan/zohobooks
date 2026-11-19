-- Live chat between a shop and the support team (polling, no extra services). A chat waits in the queue until an
-- agent picks it up, then both sides exchange messages; nobody picking it up within a few minutes ends it with an
-- offer of a call-back. Agents count as online while their console is open (support_seen_at, refreshed by polling).
-- History is never deleted by a cascade (docs/DATABASE.md).

ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS support_seen_at timestamptz;

CREATE TABLE IF NOT EXISTS support_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  started_by uuid,
  started_by_name text NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'closed', 'missed')),
  agent_id uuid REFERENCES super_admins(id) ON DELETE SET NULL,
  agent_name text,
  bot_transcript jsonb NOT NULL DEFAULT '[]',
  closed_by text CHECK (closed_by IN ('shop', 'agent', 'system')),
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  picked_at timestamptz,
  closed_at timestamptz,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  shop_seen_at timestamptz NOT NULL DEFAULT now(),
  agent_seen_at timestamptz,
  FOREIGN KEY (shop_id, started_by) REFERENCES users (shop_id, id) ON DELETE SET NULL (started_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS support_chats_shop_id_id_key ON support_chats (shop_id, id);
CREATE INDEX IF NOT EXISTS support_chats_open_idx ON support_chats (status, created_at) WHERE status IN ('waiting', 'active');
CREATE INDEX IF NOT EXISTS support_chats_shop_idx ON support_chats (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_chats_started_by_idx ON support_chats (shop_id, started_by) WHERE started_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_chats_agent_idx ON support_chats (agent_id) WHERE agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_chat_messages (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  chat_id uuid NOT NULL,
  sender text NOT NULL CHECK (sender IN ('shop', 'agent', 'system')),
  sender_name text NOT NULL DEFAULT '',
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (shop_id, chat_id) REFERENCES support_chats (shop_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS support_chat_messages_chat_idx ON support_chat_messages (chat_id, id);
CREATE INDEX IF NOT EXISTS support_chat_messages_shop_idx ON support_chat_messages (shop_id, chat_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_chats', 'support_chat_messages'] LOOP
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
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'platform_support') THEN
      EXECUTE format($p$CREATE POLICY platform_support ON %I
        USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on')$p$, t);
    END IF;
  END LOOP;
END $$;
