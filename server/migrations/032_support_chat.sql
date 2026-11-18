-- Support chat: a call-back booked from the help chat carries the conversation, so the support agent sees what was
-- already tried before calling. The support team's phone and email are shown in the chat when the bot can't help.
ALTER TABLE support_callbacks ADD COLUMN IF NOT EXISTS chat jsonb NOT NULL DEFAULT '[]';
ALTER TABLE support_callbacks ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'form' CHECK (source IN ('form', 'chat'));
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS support_phone text NOT NULL DEFAULT '';
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS support_email text NOT NULL DEFAULT '';
