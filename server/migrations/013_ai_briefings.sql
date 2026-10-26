-- 013 — the AI morning briefing, written once a day per shop and language (refreshable).
CREATE TABLE ai_briefings (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  date date NOT NULL,
  lang text NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, date, lang)
);
ALTER TABLE ai_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_briefings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_briefings
  USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid);
