/**
 * Website traffic for the Super admin dashboard, read from Google Analytics 4 with the Data API.
 *
 * The super admin makes a Google Cloud service account, turns on the "Google Analytics Data API", adds the service
 * account's email to the GA property as a Viewer, and pastes the account's JSON key plus the property ID in
 * Configuration → Website traffic. The server signs in as that account (a signed JWT exchanged for a one-hour token),
 * asks for five reports in one batch plus the realtime count, and keeps the answer for a few minutes.
 */
import { createSign } from 'node:crypto';
import { query } from '../db';
import { badRequest, HttpError } from '../http';
import { trackedFetch } from './outbound';

export interface GaSettings { propertyId: string; clientEmail: string; privateKey: string }

export async function gaSettings(): Promise<GaSettings | null> {
  const [r] = await query<{ ga: GaSettings | null }>('SELECT ga FROM platform_config WHERE id = 1');
  return r?.ga?.propertyId && r.ga.clientEmail && r.ga.privateKey ? r.ga : null;
}

/** The parts of a service-account JSON key file we need, or a plain reason it isn't one. */
export function readKeyFile(json: string): { clientEmail: string; privateKey: string } {
  let k: { type?: string; client_email?: string; private_key?: string };
  try { k = JSON.parse(json); } catch { throw badRequest('That isn’t the JSON key file. Download it from Google Cloud → Service accounts → Keys → Add key → JSON.'); }
  if (k.type !== 'service_account' || !k.client_email || !k.private_key?.includes('PRIVATE KEY')) {
    throw badRequest('That JSON isn’t a service account key (it needs "client_email" and "private_key").');
  }
  return { clientEmail: k.client_email, privateKey: k.private_key };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');
let token: { email: string; value: string; until: number } | null = null;

async function accessToken(s: GaSettings): Promise<string> {
  if (token && token.email === s.clientEmail && token.until > Date.now()) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: s.clientEmail, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  let sig: string;
  try { sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(s.privateKey, 'base64url'); }
  catch { throw badRequest('The private key in the saved JSON key can’t be read. Download a new JSON key and save it again.'); }
  const res = await trackedFetch('google_analytics', 'ga_token', 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await res.json().catch(() => null) as { access_token?: string; expires_in?: number; error_description?: string; error?: string } | null;
  if (!res.ok || !j?.access_token) throw new HttpError(502, `Google refused the service account: ${j?.error_description || j?.error || `HTTP ${res.status}`}. Check the JSON key (or make a new one).`, 'ga_failed');
  token = { email: s.clientEmail, value: j.access_token, until: Date.now() + ((j.expires_in ?? 3600) - 300) * 1000 };
  return token.value;
}

/** Google's error, said so the super admin knows which switch to flip. */
function gaError(status: number, msg: string): HttpError {
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) return new HttpError(502, 'Turn on the “Google Analytics Data API” in Google Cloud (APIs & Services → Library) for the service account’s project, wait two minutes, then try again.', 'ga_failed');
  if (status === 403 || /permission/i.test(msg)) return new HttpError(502, 'Google Analytics says this service account can’t read the property. In Analytics → Admin → Property access management, add the service account’s email as a Viewer.', 'ga_failed');
  if (status === 400 && /property/i.test(msg)) return new HttpError(400, 'That property ID isn’t right. It’s the number in Analytics → Admin → Property details (not the G-… measurement ID).', 'ga_failed');
  return new HttpError(502, `Google Analytics: ${msg || `HTTP ${status}`}`, 'ga_failed');
}

async function gaPost<T>(s: GaSettings, path: string, body: unknown, feature: string): Promise<T> {
  const t = await accessToken(s);
  const res = await trackedFetch('google_analytics', feature, `https://analyticsdata.googleapis.com/v1beta/properties/${s.propertyId}${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json().catch(() => null) as (T & { error?: { message?: string } }) | null;
  if (!res.ok || !j) throw gaError(res.status, j?.error?.message ?? '');
  return j;
}

type Row = { dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> };
type Report = { rows?: Row[] };

export interface Traffic {
  liveNow: number;
  totals: Record<'today' | 'week' | 'month', { users: number; newUsers: number; sessions: number; views: number }>;
  daily: Array<{ date: string; users: number }>;
  pages: Array<{ path: string; views: number; users: number }>;
  sources: Array<{ source: string; sessions: number }>;
  events: { signUps: number; leads: number; logins: number };
  at: string;
}

const num = (r: Row | undefined, i: number) => Number(r?.metricValues?.[i]?.value ?? 0) || 0;
const dim = (r: Row, i = 0) => r.dimensionValues?.[i]?.value ?? '';

/** Turns the batch answer into the dashboard's shape. Exported for tests. */
export function summarise(reports: Report[], live: Report): Omit<Traffic, 'at'> {
  const [totalsR, dailyR, pagesR, sourcesR, eventsR] = reports;
  const range = (name: string) => {
    const r = totalsR?.rows?.find((x) => dim(x) === name);
    return { users: num(r, 0), newUsers: num(r, 1), sessions: num(r, 2), views: num(r, 3) };
  };
  const ev = (name: string) => num(eventsR?.rows?.find((x) => dim(x) === name), 0);
  const daily = (dailyR?.rows ?? []).map((r) => ({ date: dim(r), users: num(r, 0) })).sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, date: `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}` }));
  return {
    liveNow: num(live.rows?.[0], 0),
    totals: { today: range('today'), week: range('week'), month: range('month') },
    daily,
    pages: (pagesR?.rows ?? []).map((r) => ({ path: dim(r), views: num(r, 0), users: num(r, 1) })),
    sources: (sourcesR?.rows ?? []).map((r) => ({ source: dim(r), sessions: num(r, 0) })),
    events: { signUps: ev('sign_up'), leads: ev('generate_lead'), logins: ev('login') },
  };
}

let cache: { key: string; until: number; data: Traffic } | null = null;
const CACHE_MS = 3 * 60_000;

export async function websiteTraffic(opts: { fresh?: boolean; settings?: GaSettings } = {}): Promise<Traffic> {
  const s = opts.settings ?? (await gaSettings());
  if (!s) throw badRequest('Website traffic isn’t set up yet (Configuration → Website traffic).');
  const key = `${s.propertyId}|${s.clientEmail}`;
  if (!opts.fresh && cache && cache.key === key && cache.until > Date.now()) return cache.data;
  const month = { startDate: '27daysAgo', endDate: 'today' };
  const week = { startDate: '6daysAgo', endDate: 'today' };
  const batch = await gaPost<{ reports?: Report[] }>(s, ':batchRunReports', { requests: [
    { dateRanges: [{ ...{ startDate: 'today', endDate: 'today' }, name: 'today' }, { ...week, name: 'week' }, { ...month, name: 'month' }],
      metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }] },
    { dateRanges: [month], dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 40 },
    { dateRanges: [week], dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 8 },
    { dateRanges: [month], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 6 },
    { dateRanges: [month], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }],
      dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: ['sign_up', 'generate_lead', 'login'] } } } },
  ] }, 'ga_report');
  const live = await gaPost<Report>(s, ':runRealtimeReport', { metrics: [{ name: 'activeUsers' }] }, 'ga_realtime').catch(() => ({ rows: [] }));
  const data: Traffic = { ...summarise(batch.reports ?? [], live), at: new Date().toISOString() };
  cache = { key, until: Date.now() + CACHE_MS, data };
  return data;
}

/** Forget the token and the cached numbers (after the settings change). */
export function resetGa() { token = null; cache = null; }
