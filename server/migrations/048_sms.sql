-- Bills by SMS (MSG91), set in Super admin → Configuration → SMS:
-- {"authKey": "...", "templateId": "...", "vars": {"name": "var1", ...}, "enabled": true, "dailyPerShop": 200}.
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS sms jsonb;
-- SMS links carry the first 24 characters of a bill's link code (DLT allows at most 30 per variable).
CREATE INDEX IF NOT EXISTS public_links_short_idx ON public_links (left(token, 24));
