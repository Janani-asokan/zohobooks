-- Sign-up can confirm the owner's mobile with an SMS OTP (when sign-in by OTP is on) instead of an emailed code:
-- channel says which, phone is the 10-digit mobile the SMS went to.
ALTER TABLE signup_verifications ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email';
ALTER TABLE signup_verifications ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';

-- Sign in / sign up with Google (Super admin → Configuration → Google sign-in): {"clientId": "...apps.googleusercontent.com", "enabled": true}.
-- Only the OAuth client ID is needed (it is public); Google's signed ID token is checked on the server.
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS google_auth jsonb;
