-- Email check for self-service sign-up. When it is switched on (SIGNUP_EMAIL_VERIFY), the sign-up form is kept here
-- (password already hashed, never in plain text) until the person types the 6-digit code emailed to them; only then
-- is the shop created. No shop exists yet, so the table has no shop_id and no row-level security. Rows are deleted a
-- day after they expire or are used (a pending form, not a record). Additive only.
CREATE TABLE IF NOT EXISTS signup_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  form jsonb NOT NULL,                 -- shopName, ownerName, phone, city, businessType, passwordHash
  code_hash text NOT NULL,             -- salt:sha256, never the code
  attempts int NOT NULL DEFAULT 0,
  sends int NOT NULL DEFAULT 1,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signup_verifications_email_idx ON signup_verifications (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS signup_verifications_expires_idx ON signup_verifications (expires_at);
