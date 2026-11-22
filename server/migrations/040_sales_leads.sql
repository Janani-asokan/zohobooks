-- Talk to sales. Visitors (landing, login, signup pages) and shops that haven't paid yet reach the sales team, not
-- customer care: Help shows the sales WhatsApp, phone and email, and a "call me back" form that lands here. Paid
-- shops keep customer care (help chat, live chat, call-backs, WhatsApp support). The super admin works the leads in
-- Customer care → Sales leads. A platform table (a visitor has no shop yet), so no row-level security; it is only
-- read by the super admin. Additive only; history is never deleted by a cascade (docs/DATABASE.md).

ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS sales_phone text NOT NULL DEFAULT '';
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS sales_email text NOT NULL DEFAULT '';
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS sales_whatsapp text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS sales_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  business text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  -- Where they asked: landing, login, signup, legal, app (a signed-in shop that hasn't paid).
  source text NOT NULL DEFAULT 'landing',
  page text NOT NULL DEFAULT '',
  shop_id uuid REFERENCES shops(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'won', 'lost')),
  staff_notes text NOT NULL DEFAULT '',
  handled_by uuid REFERENCES super_admins(id) ON DELETE SET NULL,
  ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_leads_created_idx ON sales_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS sales_leads_new_idx ON sales_leads (created_at DESC) WHERE status = 'new';
CREATE INDEX IF NOT EXISTS sales_leads_shop_idx ON sales_leads (shop_id) WHERE shop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_leads_handled_by_idx ON sales_leads (handled_by) WHERE handled_by IS NOT NULL;
