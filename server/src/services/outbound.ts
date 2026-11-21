/**
 * Records what the platform sends out: every email (email_log) and every call to an outside service (api_calls).
 * Logging never breaks the work it records: a failed insert is reported on the console and ignored.
 * Which feature uses which service is listed in shared/integrations.ts.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { query } from '../db';

/** The shop and person behind the current request, when there is one (set by middleware for /api/shop). */
export interface OutboundCtx { shopId: string | null; userId: string | null }
export const outboundStore = new AsyncLocalStorage<OutboundCtx>();
const ctx = (): OutboundCtx => outboundStore.getStore() ?? { shopId: null, userId: null };
/** Runs fn with the given shop recorded on any API calls it makes (for work outside a shop request, e.g. jobs). */
export const withOutboundShop = <T>(shopId: string | null | undefined, fn: () => Promise<T>) =>
  shopId === undefined || shopId === null ? fn() : outboundStore.run({ shopId, userId: ctx().userId }, fn);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null | undefined) => (v && UUID.test(v) ? v : null);
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Host and path of a URL, without query string or credentials. */
export function endpointOf(url: string) {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return short(url.split('?')[0] ?? url, 200); }
}

export interface ApiCall {
  service: string;
  feature: string;
  method?: string;
  endpoint: string;
  statusCode?: number | null;
  ok: boolean;
  durationMs: number;
  error?: string;
  shopId?: string | null;
  userId?: string | null;
  ref?: string;
}

export async function logApiCall(c: ApiCall) {
  const x = ctx();
  try {
    await query(`INSERT INTO api_calls (service, feature, method, endpoint, status_code, ok, duration_ms, error, shop_id, user_id, ref)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [c.service, c.feature || 'other', c.method ?? 'POST', short(c.endpoint, 300), c.statusCode ?? null, c.ok, Math.round(c.durationMs),
      short(c.error ?? '', 1000), uuidOrNull(c.shopId === undefined ? x.shopId : c.shopId), uuidOrNull(c.userId === undefined ? x.userId : c.userId), short(c.ref ?? '', 200)]);
  } catch (e) { console.error('[outbound] could not record API call:', (e as Error).message); }
}

/**
 * fetch() that records the call. Never records headers or bodies (they hold keys and personal data).
 * Network errors are recorded and then thrown as before.
 */
export async function trackedFetch(service: string, feature: string, url: string, init: RequestInit & { ref?: string } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, init);
    await logApiCall({ service, feature, method: init.method ?? 'GET', endpoint: endpointOf(url), statusCode: res.status, ok: res.ok,
      durationMs: Date.now() - t0, error: res.ok ? '' : `HTTP ${res.status}`, ref: init.ref });
    return res;
  } catch (e) {
    await logApiCall({ service, feature, method: init.method ?? 'GET', endpoint: endpointOf(url), statusCode: null, ok: false,
      durationMs: Date.now() - t0, error: (e as Error).message, ref: init.ref });
    throw e;
  }
}

/** Runs a call made through an SDK (e.g. Anthropic) and records it. */
export async function trackedCall<T>(service: string, feature: string, endpoint: string, fn: () => Promise<T>, ref?: (r: T) => string): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    await logApiCall({ service, feature, endpoint, ok: true, statusCode: 200, durationMs: Date.now() - t0, ref: ref?.(r) ?? '' });
    return r;
  } catch (e) {
    const err = e as Error & { status?: number };
    await logApiCall({ service, feature, endpoint, ok: false, statusCode: typeof err.status === 'number' ? err.status : null, durationMs: Date.now() - t0, error: err.message });
    throw e;
  }
}

export interface EmailRecord {
  kind: string;
  to: string;
  cc?: string;
  subject: string;
  provider: string;
  status: 'sent' | 'failed' | 'not_sent';
  messageId?: string;
  error?: string;
  attachments?: Array<{ name: string; kb: number }>;
  durationMs?: number;
  shopId?: string | null;
}

/** Writes one row of the email log and returns its id (or null if it could not be written). */
export async function logEmail(e: EmailRecord): Promise<number | null> {
  const x = ctx();
  try {
    const [r] = await query<{ id: string }>(`INSERT INTO email_log (shop_id, user_id, kind, recipient, cc, subject, provider, status, provider_message_id, error, attachments, duration_ms)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [uuidOrNull(e.shopId === undefined ? x.shopId : e.shopId), uuidOrNull(x.userId), e.kind || 'other', short(e.to, 320), short(e.cc ?? '', 320), short(e.subject, 300),
      e.provider, e.status, short(e.messageId ?? '', 300), short(e.error ?? '', 1000), JSON.stringify(e.attachments ?? []), e.durationMs ?? null]);
    return r ? Number(r.id) : null;
  } catch (err) { console.error('[outbound] could not record email:', (err as Error).message); return null; }
}

const days = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 30 ? Math.floor(n) : d; };
/** How long the logs are kept: 2 years for emails (escalations, disputes), 6 months for API calls. */
export const LOG_DAYS = { email: days(process.env.EMAIL_LOG_DAYS, 730), api: days(process.env.API_LOG_DAYS, 180) };

/** Daily clean-up of rows older than the keep periods. */
export async function pruneOutboundLogs() {
  await query('DELETE FROM email_log WHERE created_at < now() - make_interval(days => $1)', [LOG_DAYS.email]);
  await query('DELETE FROM api_calls WHERE created_at < now() - make_interval(days => $1)', [LOG_DAYS.api]);
}
