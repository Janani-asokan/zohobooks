# Outside services, and the logs of what we send

Super admin → **Logs** shows all of this live. The list of services and which feature uses which is in
`shared/integrations.ts`. Update it whenever a feature starts calling a new API.

## Which feature uses which service

| Service | Used for | Server settings | Logged |
|---|---|---|---|
| **Brevo** (api.brevo.com) | All emails. It is the first choice when its key is set. | `BREVO_API_KEY`, `MAIL_FROM` | Email log and API calls |
| **Resend** (api.resend.com) | All emails, only if Brevo isn't set | `RESEND_API_KEY`, `MAIL_FROM` | Email log and API calls |
| **SMTP server** | All emails, only if neither of the above is set | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Email log and API calls |
| **Anthropic** (api.anthropic.com) | AI features: assistant (and help-bot AI answers), reading supplier bills, smart reader, item suggestions, stock advice, reminder wording, import column matching, field day summary, morning briefing | `ANTHROPIC_API_KEY`, `AI_MODEL` | API calls, and AI credits in `ai_usage` |
| **Razorpay** (api.razorpay.com) | Online payment for Corpus360 plans | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | API calls |
| Razorpay Checkout (checkout.razorpay.com) | The payment window, which runs in the browser | (`RAZORPAY_KEY_ID`) | Not by the server |
| OpenStreetMap tiles | Field staff maps, on the website only | none | Not by the server |
| Google Maps / WhatsApp (wa.me) links | "Open in maps", "Share on WhatsApp" and "WhatsApp us" (support) links | Support number: Customer care → Support hours | Support taps are recorded in Customer care → WhatsApp |

E-invoice (IRP) and WhatsApp Business API settings exist in `config.ts`, but nothing calls them yet. The app
produces the official JSON for upload on the government portals and uses `wa.me` links instead.

## Emails and their purpose (`email_log.kind`)

| Purpose | When it is sent |
|---|---|
| `signup_code` | Self sign-up, when `SIGNUP_EMAIL_VERIFY` is on: the 6-digit code |
| `welcome` | After a shop is created by sign-up |
| `password_reset` | When someone uses "Forgot password" |
| `password_reset_admin` | When the super admin sends a shop owner a reset link |
| `workspace_ready` | When the super admin creates a shop |
| `shop_closed` | When an owner closes their shop |
| `invoice` | When a shop emails an invoice PDF to a customer |
| `payment_reminder` | Payment reminders to customers, sent by hand or on a schedule |
| `transfer_code` | Receipt code for a stock transfer |
| `licence_expiry` | The shop's Corpus360 licence ends in 15, 7 or 1 days |
| `warehouse_licence_alert` | Warehouse or trade licence due alerts |
| `ai_credits_alert` | 80% or 100% of the month's AI credits are used |
| `test_email` | Super admin → Configuration → Email → Send test |

## What is recorded, and for how long

**Email log** (`email_log`), kept for **2 years** (`EMAIL_LOG_DAYS`). Each row records:
- the time, purpose, shop and the person who triggered it;
- the recipient, cc and subject;
- the provider;
- the result: `sent`, `failed`, or `not_sent` when no provider is set up;
- the provider's message id (in Brevo: Transactional → Logs → search the id to see delivered, opened or bounced);
- the error text, attachment names and sizes, and how long the send took.

The email **body is never stored**, because it can hold sign-in codes and password-reset links. When a shop's
personal data is erased, 30 days after the owner closes it, its rows keep the record but lose the recipient.

**API calls** (`api_calls`), kept for **6 months** (`API_LOG_DAYS`). Each row records:
- the service and feature;
- the method, plus the host and path only (never query strings);
- the HTTP status, whether it worked, and how long it took;
- the error text, the shop and person, and a reference (such as the AI message id, or the steps of a tool run).

Keys, headers and request or response bodies are never recorded.

Both logs are written without ever stopping the work they record. If a log row can't be saved, the server prints
a warning and the email or call still goes ahead. Old rows are removed by the hourly job.

## For an escalation

1. **"The customer didn't get the email":** Logs → Emails, then search their address.
   - **Sent:** use the message id in Brevo's logs to see whether it was delivered or bounced.
   - **Failed:** the error says why. A common cause is a `MAIL_FROM` that isn't a verified sender.
   - **Not sent:** no email provider was set up at the time.
2. **"The AI or payments stopped working":** Logs → API calls, then filter by service and choose "Failures only".
   The status and error show whether it was a bad key (401), no credit or a rate limit (429), or the provider
   being down (5xx or 529).
3. **Export CSV:** gives the filtered list to attach to a support ticket with the provider.
