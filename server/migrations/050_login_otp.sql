-- Sign in with a mobile OTP (MSG91 OTP API, the DLT-approved OTP template set in Super admin → Configuration → SMS).
-- Each login can carry a 10-digit mobile number; owners start with the number their shop signed up with.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
UPDATE users u SET phone = right(regexp_replace(s.phone, '\D', '', 'g'), 10)
  FROM shops s WHERE s.id = u.shop_id AND u.role = 'Owner' AND u.phone = ''
   AND right(regexp_replace(s.phone, '\D', '', 'g'), 10) ~ '^[6-9][0-9]{9}$';
CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone) WHERE phone <> '';

-- Limits per mobile number, kept by the server (MSG91 makes and checks the code itself): how many codes were sent in
-- the current hour, and how many wrong codes were tried since the last one was sent.
CREATE TABLE IF NOT EXISTS login_otps (
  mobile text PRIMARY KEY,           -- 10 digits
  sent_at timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz NOT NULL DEFAULT now(),
  sends int NOT NULL DEFAULT 0,
  tries int NOT NULL DEFAULT 0
);
