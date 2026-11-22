-- WhatsApp Business (Cloud) API inbox for the support team. Messages sent to the support number arrive through
-- Meta's webhook; agents read and reply in Customer care. One conversation per WhatsApp sender, linked to a shop
-- when it can be matched (by the shop's phone, or the "Shop:" line of the "WhatsApp us" message).
-- Platform tables: an incoming message is stored before its shop is known, and the super admin reads them across
-- shops, so no row-level security (listed in schema.test.ts). Nothing is removed by a cascade (docs/DATABASE.md).
-- Additive only.

CREATE TABLE IF NOT EXISTS wa_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_id text NOT NULL UNIQUE,                 -- the sender's WhatsApp number, digits with country code
  profile_name text NOT NULL DEFAULT '',
  shop_id uuid REFERENCES shops(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  assigned_to uuid REFERENCES super_admins(id) ON DELETE SET NULL,
  unread int NOT NULL DEFAULT 0,
  last_inbound_at timestamptz,               -- free-form replies are allowed for 24 hours after this
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_preview text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_conversations_list_idx ON wa_conversations (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS wa_conversations_shop_idx ON wa_conversations (shop_id) WHERE shop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wa_conversations_assigned_idx ON wa_conversations (assigned_to) WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS wa_messages (
  id bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES wa_conversations(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  wa_message_id text UNIQUE,                 -- Meta's id: makes repeated webhook deliveries harmless
  kind text NOT NULL DEFAULT 'text',         -- text, image, document, audio, video, sticker, location, template, other
  body text NOT NULL DEFAULT '',
  media_id text NOT NULL DEFAULT '',
  media_mime text NOT NULL DEFAULT '',
  media_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'sending', 'sent', 'delivered', 'read', 'failed')),
  error text NOT NULL DEFAULT '',
  sent_by uuid REFERENCES super_admins(id) ON DELETE SET NULL,
  sent_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_messages_conv_idx ON wa_messages (conversation_id, id);
CREATE INDEX IF NOT EXISTS wa_messages_sent_by_idx ON wa_messages (sent_by) WHERE sent_by IS NOT NULL;

-- When Meta last reached us, shown in Customer care so staff can tell the webhook is working.
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS wa_webhook_at timestamptz;
