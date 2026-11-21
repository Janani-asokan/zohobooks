import nodemailer from 'nodemailer';
import { config } from './config';
import { logEmail, trackedCall, trackedFetch, withOutboundShop } from './services/outbound';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  cc?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  /** What the email is for, as recorded in the email log (keys in shared/integrations.ts). */
  kind?: string;
  /** The shop it concerns, when the request does not already say (background jobs, super admin). */
  shopId?: string | null;
}

let transport: nodemailer.Transporter | null = null;
const outbox: Mail[] = []; // kept for tests / dev inspection when no mail provider is configured

/** Splits "Shop Name <billing@shop.in>" into its parts. */
function parseFrom(from: string) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1]!.replace(/^"|"$/g, '') || undefined, email: m[2]!.trim() } : { name: undefined, email: from.trim() };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, provider: string, feature: string) {
  const r = await trackedFetch(provider.toLowerCase(), feature, url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 300);
    throw new Error(`${provider} rejected the email (HTTP ${r.status})${detail ? `: ${detail}` : ''}`);
  }
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}

/* Brevo and Resend send over HTTPS, so they work on hosts that block outgoing SMTP ports (Render's free plan does). */
async function viaBrevo(mail: Mail, apiKey: string, from: string) {
  const sender = parseFrom(from);
  const r = await postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': apiKey }, {
    sender: { email: sender.email, ...(sender.name ? { name: sender.name } : {}) },
    to: [{ email: mail.to }],
    ...(mail.cc ? { cc: [{ email: mail.cc }] } : {}),
    subject: mail.subject,
    textContent: mail.text,
    ...(mail.html ? { htmlContent: mail.html } : {}),
    ...(mail.attachments?.length ? { attachment: mail.attachments.map((a) => ({ name: a.filename, content: a.content.toString('base64') })) } : {}),
  }, 'Brevo', mail.kind ?? 'other');
  return String(r.messageId ?? '');
}

async function viaResend(mail: Mail, apiKey: string, from: string) {
  const r = await postJson('https://api.resend.com/emails', { authorization: `Bearer ${apiKey}` }, {
    from,
    to: [mail.to],
    ...(mail.cc ? { cc: [mail.cc] } : {}),
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
    ...(mail.attachments?.length ? { attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })) } : {}),
  }, 'Resend', mail.kind ?? 'other');
  return String(r.id ?? '');
}

async function viaSmtp(mail: Mail, smtp: NonNullable<typeof config.mail.smtp>, from: string) {
  transport ??= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    // Fail fast instead of hanging when the host blocks the SMTP port.
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  try {
    const { kind: _k, shopId: _s, ...m } = mail;
    const info = await trackedCall('smtp', mail.kind ?? 'other', `${smtp.host}:${smtp.port}`, () => transport!.sendMail({ from, ...m }));
    return String(info.messageId ?? '');
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION' || /timeout/i.test(err.message)) {
      throw new Error(`Could not reach ${smtp.host}:${smtp.port} (${err.code ?? err.message}). Many hosts, including Render's free plan, block outgoing SMTP; use BREVO_API_KEY or RESEND_API_KEY instead.`);
    }
    throw err;
  }
}

/** Which provider will send mail, for the startup log and the Super Admin check. */
export function mailStatus() {
  const m = config.mail;
  const provider = m.brevoKey ? 'brevo' : m.resendKey ? 'resend' : m.smtp ? 'smtp' : null;
  return { configured: !!provider, provider, from: m.from };
}

/** Whether an email provider is set up, so emails really go out. */
export function mailConfigured() {
  const m = config.mail;
  return !!(m.brevoKey || m.resendKey || m.smtp);
}

/**
 * Sends through Brevo, Resend or SMTP (first one configured); otherwise logs and stores in an in-memory outbox.
 * Every email is written to the email log (who, what, which shop, the provider's answer; never the body).
 * Returns whether it was really sent; a provider error is recorded and then thrown as before.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const m = config.mail;
  const provider = m.brevoKey ? 'brevo' : m.resendKey ? 'resend' : m.smtp ? 'smtp' : 'none';
  const record = {
    kind: mail.kind ?? 'other', to: mail.to, cc: mail.cc, subject: mail.subject, provider, shopId: mail.shopId,
    attachments: mail.attachments?.map((a) => ({ name: a.filename, kb: Math.round(a.content.length / 1024) })),
  };
  const t0 = Date.now();
  if (provider === 'none') {
    outbox.push(mail);
    if (outbox.length > 200) outbox.shift();
    const files = mail.attachments?.map((a) => `${a.filename} (${Math.round(a.content.length / 1024)} KB)`).join(', ');
    // In production the body (which may hold a reset link) stays out of the logs.
    if (config.isProd) console.warn(`[mail] Not sent, no email provider configured: to=${mail.to} subject="${mail.subject}"`);
    else if (config.env !== 'test') console.log(`[mail:dev] to=${mail.to} subject="${mail.subject}"${files ? ` attachments=${files}` : ''}\n${mail.text}\n`);
    await logEmail({ ...record, status: 'not_sent', error: 'No email provider is set up (BREVO_API_KEY, RESEND_API_KEY or SMTP_HOST)', durationMs: 0 });
    return false;
  }
  try {
    const messageId = await withOutboundShop(mail.shopId, () => (provider === 'brevo' ? viaBrevo(mail, m.brevoKey, m.from)
      : provider === 'resend' ? viaResend(mail, m.resendKey, m.from)
      : viaSmtp(mail, m.smtp!, m.from)));
    await logEmail({ ...record, status: 'sent', messageId, durationMs: Date.now() - t0 });
    return true;
  } catch (e) {
    await logEmail({ ...record, status: 'failed', error: (e as Error).message, durationMs: Date.now() - t0 });
    throw e;
  }
}

export const devOutbox = () => outbox;
