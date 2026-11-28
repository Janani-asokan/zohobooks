-- Website traffic on the Super admin dashboard (Google Analytics Data API), set in Configuration → Website traffic:
-- {"propertyId": "123456789", "clientEmail": "...@....iam.gserviceaccount.com", "privateKey": "-----BEGIN PRIVATE KEY-----..."}.
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS ga jsonb;
