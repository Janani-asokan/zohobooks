/**
 * Every outside service Corpus360 talks to, what each one is used for, and the settings that switch it on.
 * The super admin's Logs → Integrations page is built from this list, so keep it up to date when a feature starts
 * calling a new API. The `feature` keys are what the email log (kind) and the API-call log (feature) record.
 */

export interface Integration {
  key: string;
  name: string;
  what: string;
  /** Where the call is made: from our server (logged) or from the user's browser/phone (not seen by the server). */
  side: 'server' | 'browser';
  host: string;
  /** Server settings that turn it on (names only; values are never shown). */
  settings: string[];
  /** Features that use it: keys as recorded in the logs. */
  features: string[];
  docs?: string;
  note?: string;
}

/** Human names for the feature keys written to email_log.kind and api_calls.feature. */
export const FEATURE_LABELS: Record<string, string> = {
  // Emails
  signup_code: 'Sign-up email code',
  welcome: 'Welcome email after sign-up',
  password_reset: 'Password reset (by the user)',
  password_reset_admin: 'Password reset link (sent by super admin)',
  workspace_ready: 'New shop ready (created by super admin)',
  sales_lead: 'New sales lead (Talk to sales)',
  report: 'Report emailed (PDF, Excel or CSV)',
  shop_closed: 'Shop closed notice',
  invoice: 'Invoice email with PDF',
  payment_reminder: 'Payment reminder to customer',
  transfer_code: 'Stock transfer receipt code',
  licence_expiry: 'Corpus360 licence expiry reminder',
  warehouse_licence_alert: 'Warehouse licence due alert',
  ai_credits_alert: 'AI credits used up / 80% alert',
  test_email: 'Test email (super admin)',
  other: 'Other email',
  // AI
  assistant: 'AI assistant chat (and help-bot AI answers)',
  bill_parse: 'Read a supplier bill from a photo or PDF',
  smart_reader: 'Smart reader: fill a form from a PDF or photo',
  item_suggest: 'Suggest item details',
  stock_advice: 'Stock reorder advice',
  reminder: 'Write a payment reminder',
  column_map: 'Import: match spreadsheet columns',
  field_summary: 'Field staff day summary',
  briefing: 'Morning business briefing',
  // Payments
  plan_payment: 'Pay for a Corpus360 plan online',
  // WhatsApp Business API (support inbox)
  support_reply: 'WhatsApp reply from Customer care',
  support_template: 'WhatsApp template (after 24 hours)',
  support_read: 'WhatsApp read receipt',
  support_media: 'Open a photo or file sent on WhatsApp',
};

const EMAIL_FEATURES = ['signup_code', 'sales_lead', 'report', 'welcome', 'password_reset', 'password_reset_admin', 'workspace_ready', 'shop_closed', 'invoice',
  'payment_reminder', 'transfer_code', 'licence_expiry', 'warehouse_licence_alert', 'ai_credits_alert', 'test_email'];

export const INTEGRATIONS: Integration[] = [
  {
    key: 'brevo', name: 'Brevo', what: 'Sends all emails (first choice)', side: 'server', host: 'api.brevo.com',
    settings: ['BREVO_API_KEY', 'MAIL_FROM'], features: EMAIL_FEATURES, docs: 'https://developers.brevo.com/reference/sendtransacemail',
    note: 'Free plan: 300 emails a day. Delivery and bounces for a message can be looked up in Brevo by its message id.',
  },
  {
    key: 'resend', name: 'Resend', what: 'Sends all emails (used only if Brevo is not set)', side: 'server', host: 'api.resend.com',
    settings: ['RESEND_API_KEY', 'MAIL_FROM'], features: EMAIL_FEATURES, docs: 'https://resend.com/docs/api-reference/emails/send-email',
  },
  {
    key: 'smtp', name: 'SMTP mail server', what: 'Sends all emails (used only if neither Brevo nor Resend is set)', side: 'server', host: 'SMTP_HOST',
    settings: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'], features: EMAIL_FEATURES,
  },
  {
    key: 'anthropic', name: 'Anthropic (Claude AI)', what: 'AI features for shops with the AI add-on', side: 'server', host: 'api.anthropic.com',
    settings: ['ANTHROPIC_API_KEY', 'AI_MODEL'],
    features: ['assistant', 'bill_parse', 'smart_reader', 'item_suggest', 'stock_advice', 'reminder', 'column_map', 'field_summary', 'briefing'],
    docs: 'https://docs.anthropic.com/en/api/messages', note: 'Each call is also counted against the shop’s AI credits (ai_usage).',
  },
  {
    key: 'razorpay', name: 'Razorpay', what: 'Online payment for Corpus360 plans', side: 'server', host: 'api.razorpay.com',
    settings: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'], features: ['plan_payment'], docs: 'https://razorpay.com/docs/api/orders/create/',
    note: 'The card/UPI payment itself happens in Razorpay’s checkout window (checkout.razorpay.com) in the browser.',
  },
  {
    key: 'whatsapp', name: 'WhatsApp Business API (Meta)', what: 'Two-way WhatsApp support inbox in Customer care', side: 'server', host: 'graph.facebook.com',
    settings: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_TEMPLATE'],
    features: ['support_reply', 'support_template', 'support_read', 'support_media'], docs: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    note: 'Incoming messages arrive on the webhook /api/webhooks/whatsapp (checked with the app secret). Replying within 24 hours of the shop’s message is free; templates are charged by Meta. See docs/whatsapp-business-api.md.',
  },
  {
    key: 'razorpay_checkout', name: 'Razorpay Checkout', what: 'The payment window shown to the shop owner', side: 'browser', host: 'checkout.razorpay.com',
    settings: ['RAZORPAY_KEY_ID'], features: ['plan_payment'], note: 'Runs in the browser; the server records the order (above) and checks the payment signature.',
  },
  {
    key: 'osm', name: 'OpenStreetMap tiles', what: 'Map pictures on the field staff screens', side: 'browser', host: 'tile.openstreetmap.de',
    settings: [], features: [], note: 'Website only (field staff). Free, no key.',
  },
  {
    key: 'google_maps_link', name: 'Google Maps links', what: '“Open in maps” links for field visits', side: 'browser', host: 'www.google.com/maps',
    settings: [], features: [], note: 'Just a link; nothing is sent by the server.',
  },
  {
    key: 'whatsapp_link', name: 'WhatsApp links (wa.me)', what: 'Share an invoice or reminder on WhatsApp, and “WhatsApp us” support in Help', side: 'browser', host: 'wa.me',
    settings: [], features: [], note: 'Opens WhatsApp with the message ready; the person sends it. Support taps are recorded in Customer care → WhatsApp; the team replies from the WhatsApp Business app. Automatic WhatsApp messages (WHATSAPP_TOKEN) are not built yet.',
  },
];

export const featureLabel = (key: string) => FEATURE_LABELS[key] ?? key.replace(/_/g, ' ');
