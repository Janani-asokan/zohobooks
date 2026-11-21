-- A permanent record of what the platform sends out, for escalations ("did the customer get the code?",
-- "why did payments fail on Tuesday?"):
--   email_log  every email: to whom, what (subject and purpose), which shop, the provider's answer and message id.
--              The body is NOT kept: it can hold sign-in codes and password-reset links.
--   api_calls  every call to an outside service (email provider, AI, payments): which feature made it, how long it
--              took, and whether it worked.
-- Platform tables, read by the super admin across shops and written outside the shop's transaction, so no
-- row-level security (listed in schema.test.ts). Old rows are removed after EMAIL_LOG_DAYS / API_LOG_DAYS.
-- Nothing is removed by a cascade (docs/DATABASE.md). Additive only.

CREATE TABLE IF NOT EXISTS email_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  shop_id uuid REFERENCES shops(id) ON DELETE RESTRICT,
  user_id uuid,                          -- who triggered it, when a person did (no FK: logins can be wiped)
  kind text NOT NULL,                    -- signup_code, password_reset, invoice … (shared/integrations.ts)
  recipient text NOT NULL,
  cc text NOT NULL DEFAULT '',
  subject text NOT NULL,
  provider text NOT NULL,                -- brevo, resend, smtp, or none (no provider set up)
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'not_sent')),
  provider_message_id text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]', -- [{ name, kb }]
  duration_ms int
);
CREATE INDEX IF NOT EXISTS email_log_created_idx ON email_log (created_at DESC);
CREATE INDEX IF NOT EXISTS email_log_shop_idx ON email_log (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_log_recipient_idx ON email_log (lower(recipient), created_at DESC);
CREATE INDEX IF NOT EXISTS email_log_problem_idx ON email_log (created_at DESC) WHERE status <> 'sent';

CREATE TABLE IF NOT EXISTS api_calls (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  service text NOT NULL,                 -- brevo, resend, smtp, anthropic, razorpay …
  feature text NOT NULL,                 -- which part of the app made the call (shared/integrations.ts)
  method text NOT NULL DEFAULT 'POST',
  endpoint text NOT NULL,                -- host and path only, never query strings or keys
  status_code int,
  ok boolean NOT NULL,
  duration_ms int NOT NULL,
  error text NOT NULL DEFAULT '',
  shop_id uuid REFERENCES shops(id) ON DELETE RESTRICT,
  user_id uuid,
  ref text NOT NULL DEFAULT ''           -- e.g. the email_log id or the provider's request id
);
CREATE INDEX IF NOT EXISTS api_calls_created_idx ON api_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS api_calls_service_idx ON api_calls (service, created_at DESC);
CREATE INDEX IF NOT EXISTS api_calls_shop_idx ON api_calls (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_calls_problem_idx ON api_calls (created_at DESC) WHERE NOT ok;
