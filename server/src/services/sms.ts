/**
 * Bills by SMS through MSG91 (Flow API), with the DLT-approved template set in Super admin → Configuration → SMS.
 *
 * The approved template reads, for example:
 *   "Dear {#var#}, thank you for shopping at {#var#}. Your bill {#var#} for Rs.{#var#} is ready.
 *    View and download: https://corpus360lite.com/share/{#var#} -CORPUS360"
 * In MSG91 the same template has named variables (##var1## …); the settings say which name holds which value:
 * customer name, shop name, bill number, amount, and the link code (first 24 characters of the bill's link, since DLT
 * allows at most 30 characters per variable). Every value is cut to 30 characters for the same reason.
 */
import { one, query, type Db } from '../db';
import { badRequest, HttpError } from '../http';
import { trackedFetch } from './outbound';

export interface SmsSettings {
  authKey: string; templateId: string; enabled: boolean; dailyPerShop: number;
  vars: { name: string; shop: string; bill: string; amount: string; code: string };
}
export const DEFAULT_VARS: SmsSettings['vars'] = { name: 'var1', shop: 'var2', bill: 'var3', amount: 'var4', code: 'var5' };

export async function smsSettings(): Promise<SmsSettings | null> {
  const [r] = await query<{ sms: SmsSettings | null }>('SELECT sms FROM platform_config WHERE id = 1');
  return r?.sms?.authKey && r.sms.templateId ? { ...r.sms, vars: { ...DEFAULT_VARS, ...r.sms.vars } } : null;
}
export const smsOn = async () => !!(await smsSettings())?.enabled;

/** A 10-digit Indian mobile (with or without +91 / 0) as MSG91 wants it: 91XXXXXXXXXX. */
export function smsNumber(phone: string): string | null {
  const d = phone.replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null;
}

const cut = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 30);

export interface BillSms { phone: string; customer: string; shop: string; bill: string; amount: number; linkToken: string }

/** Sends one bill SMS. Throws a clear error when MSG91 refuses it. */
export async function sendBillSms(b: BillSms, s?: SmsSettings, opts: { test?: boolean } = {}) {
  const set = s ?? (await smsSettings());
  if (!set) throw badRequest('SMS isn’t set up yet (Super admin → Configuration → SMS).');
  if (!set.enabled && !opts.test) throw badRequest('Sending bills by SMS is switched off.');
  const to = smsNumber(b.phone);
  if (!to) throw badRequest('Enter a 10-digit Indian mobile number.', { phone: 'Enter a 10-digit Indian mobile number' });
  const v = set.vars;
  const recipient: Record<string, string> = { mobiles: to };
  recipient[v.name] = cut(b.customer || 'Customer');
  recipient[v.shop] = cut(b.shop);
  recipient[v.bill] = cut(b.bill);
  recipient[v.amount] = b.amount.toFixed(2);
  recipient[v.code] = b.linkToken.slice(0, 24);
  const res = await trackedFetch('msg91', opts.test ? 'sms_test' : 'sms_invoice', 'https://control.msg91.com/api/v5/flow', {
    method: 'POST', headers: { authkey: set.authKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ template_id: set.templateId, short_url: '0', recipients: [recipient] }), signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => null) as { type?: string; message?: string } | null;
  if (!res.ok || body?.type === 'error') {
    const why = body?.message || `HTTP ${res.status}`;
    throw new HttpError(res.status === 401 || /auth/i.test(why) ? 502 : 400, `MSG91 didn’t send it: ${why}`, 'sms_failed');
  }
  return { requestId: body?.message ?? '', to };
}

/** How many bill SMS this shop sent today (India time): the ones MSG91 accepted (each leaves an audit entry). */
export async function smsSentToday(db: Db, shopId: string) {
  const r = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM audit_log WHERE shop_id = $1 AND action = 'sms_sent'
      AND at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`, [shopId]);
  return r?.n ?? 0;
}
