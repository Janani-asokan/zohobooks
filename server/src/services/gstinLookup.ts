/**
 * GSTIN lookup: the legal name, trade name, status and address of a GST number, from the lookup service set in
 * Super admin → Configuration → GST number lookup (or, as before, the GSTIN_LOOKUP_URL environment variables).
 * Any provider works: its URL / method / headers / body are set there with {gstin} where the number goes. Most pass
 * through the GST portal's taxpayer record ("lgnm", "pradr"…); others use plain names (legal_name_of_business,
 * principal_place_address…). Both are read wherever they sit in the reply. Results are kept for 30 days.
 */
import { config } from '../config';
import { query } from '../db';
import { stateFromCode } from '../../../shared/gst';
import { trackedFetch } from './outbound';

export interface Taxpayer {
  legalName: string; tradeName: string; status: string; registeredOn: string; cancelledOn: string;
  constitution: string; taxpayerType: string; address: string; city: string; district: string; state: string; pincode: string;
}

const KEEP_DAYS = 30;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** Finds the GST portal record (the object with "lgnm") anywhere in a provider's reply. */
function findRecord(x: unknown, depth = 0): Record<string, any> | null {
  if (!x || typeof x !== 'object' || depth > 6) return null;
  if ('lgnm' in (x as object) || 'tradeNam' in (x as object)) return x as Record<string, any>;
  for (const v of Object.values(x as object)) { const r = findRecord(v, depth + 1); if (r) return r; }
  return null;
}

/** Providers that don't pass the portal record through: find an object with a legal / trade name field. */
const LEGAL = ['legal_name_of_business', 'legal_name', 'legalName', 'legalname', 'lgnm', 'business_name', 'name_of_business'];
const TRADE = ['trade_name_of_business', 'trade_name', 'tradeName', 'tradename'];
function findFlat(x: unknown, depth = 0): Record<string, any> | null {
  if (!x || typeof x !== 'object' || depth > 6) return null;
  if ([...LEGAL, ...TRADE].some((k) => typeof (x as any)[k] === 'string' && (x as any)[k].trim())) return x as Record<string, any>;
  for (const v of Object.values(x as object)) { const r = findFlat(v, depth + 1); if (r) return r; }
  return null;
}
const pick = (o: Record<string, any>, keys: string[]) => { for (const k of keys) { const v = str(o?.[k]); if (v) return v; } return ''; };

function parseFlat(r: Record<string, any>, gstin: string): Taxpayer {
  const split = (r.principal_place_split_address ?? r.address_details ?? r.addressDetails ?? {}) as Record<string, any>;
  const addrVal = r.principal_place_address ?? r.address ?? r.principal_address ?? r.principalPlaceOfBusiness ?? '';
  const address = typeof addrVal === 'string' ? addrVal.trim() : [addrVal?.address, addrVal?.city, addrVal?.state, addrVal?.pincode].map(str).filter(Boolean).join(', ');
  const pincode = pick(split, ['pincode', 'pin_code', 'pin']) || pick(r, ['pincode', 'pin_code']) || (/\b(\d{6})\b/.exec(address)?.[1] ?? '');
  return {
    legalName: pick(r, LEGAL), tradeName: pick(r, TRADE),
    status: pick(r, ['gst_in_status', 'gstin_status', 'status', 'sts', 'taxpayer_status']),
    registeredOn: pick(r, ['date_of_registration', 'registration_date', 'rgdt']), cancelledOn: pick(r, ['date_of_cancellation', 'cancellation_date', 'cxdt']),
    constitution: pick(r, ['constitution_of_business', 'constitution', 'ctb']), taxpayerType: pick(r, ['taxpayer_type', 'taxpayerType', 'dty']),
    address, city: pick(split, ['city', 'location']) || pick(r, ['city']), district: pick(split, ['district']), pincode,
    state: stateFromCode(gstin.slice(0, 2)),
  };
}

/** The parts of the portal record a bill needs, with the address written the way it is printed. */
export function parseTaxpayer(reply: unknown, gstin: string): Taxpayer | null {
  const r = findRecord(reply);
  if (!r) { const f = findFlat(reply); return f ? parseFlat(f, gstin) : null; }
  const a = r.pradr?.addr ?? {};
  const parts = [a.bno, a.flno, a.bnm, a.st, a.loc].map(str).filter(Boolean);
  const city = str(a.city) || str(a.loc) || str(a.dst);
  const district = str(a.dst);
  const pincode = str(a.pncd);
  const state = str(a.stcd) || stateFromCode(gstin.slice(0, 2));
  const address = parts.length ? [...parts, city !== str(a.loc) ? city : '', district && district !== city ? district : '', pincode ? `${state} ${pincode}` : state].filter(Boolean).join(', ')
    : str(r.pradr?.adr);
  return {
    legalName: str(r.lgnm), tradeName: str(r.tradeNam), status: str(r.sts), registeredOn: str(r.rgdt), cancelledOn: str(r.cxdt),
    constitution: str(r.ctb), taxpayerType: str(r.dty), address, city, district, state: stateFromCode(gstin.slice(0, 2)) || state, pincode,
  };
}

export interface LookupProvider { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body: string }

let cache: { at: number; p: LookupProvider | null } | null = null;
/** The provider: Super admin's setting, else the environment variables, else none. Re-read at most once a minute. */
export async function lookupProvider(): Promise<LookupProvider | null> {
  if (cache && Date.now() - cache.at < 60_000) return cache.p;
  const [row] = await query<{ gst_lookup: LookupProvider | null }>('SELECT gst_lookup FROM platform_config WHERE id = 1').catch(() => [] as Array<{ gst_lookup: LookupProvider | null }>);
  const env = config.gstLookup;
  const p: LookupProvider | null = row?.gst_lookup?.url ? row.gst_lookup
    : env ? { url: env.url.replace('{key}', encodeURIComponent(env.key)), method: 'GET', headers: env.key && !env.url.includes('{key}') ? { [env.keyHeader]: env.key } : {}, body: '' } : null;
  cache = { at: Date.now(), p };
  return p;
}
export const forgetProvider = () => { cache = null; };
export const lookupOn = async () => !!(await lookupProvider());

/** Asks the provider (no cache). Returns the record, null when it says there is no such number, or throws. */
export async function fetchTaxpayer(gstin: string, p: LookupProvider): Promise<{ taxpayer: Taxpayer | null; raw: unknown; status: number }> {
  const fill = (v: string) => v.replaceAll('{gstin}', gstin);
  const url = fill(p.url).replace(/\{gstin_enc\}/g, encodeURIComponent(gstin));
  const headers: Record<string, string> = { accept: 'application/json', ...Object.fromEntries(Object.entries(p.headers ?? {}).map(([k, v]) => [k, fill(v)])) };
  const init: RequestInit = { method: p.method, headers, signal: AbortSignal.timeout(12_000) };
  if (p.method === 'POST' && p.body) { init.body = fill(p.body); if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json'; }
  const res = await trackedFetch('gstin', 'gstin_lookup', url, init);
  const raw = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw new Error('The GST lookup service refused the key (check it in Super admin → Configuration)');
  if (res.status === 402 || res.status === 429) throw new Error('The GST lookup service has no credits left or is busy');
  if (!res.ok && res.status !== 404 && res.status !== 422) throw new Error(`The GST lookup service answered HTTP ${res.status}`);
  const taxpayer = res.ok ? parseTaxpayer(raw, gstin) : null;
  if (res.ok && !taxpayer && raw && !/not\s*found|invalid|no\s*record|does\s*not\s*exist/i.test(JSON.stringify(raw).slice(0, 2000))) {
    throw new Error('The GST lookup service sent a reply we couldn’t read');
  }
  return { taxpayer, raw, status: res.status };
}

/** Looks a GSTIN up (cached 30 days). Returns the record, null if the service says it doesn't exist, or throws. */
export async function lookupGstin(gstin: string): Promise<{ taxpayer: Taxpayer | null; cached: boolean }> {
  const [hit] = await query<{ data: Taxpayer | null }>(`SELECT data FROM gstin_lookups WHERE gstin = $1 AND fetched_at > now() - make_interval(days => $2)`, [gstin, KEEP_DAYS]);
  if (hit) return { taxpayer: hit.data, cached: true };
  const p = await lookupProvider();
  if (!p) throw new Error('No GST lookup service is set up');
  const { taxpayer } = await fetchTaxpayer(gstin, p);
  await query(`INSERT INTO gstin_lookups (gstin, data, fetched_at) VALUES ($1, $2, now())
      ON CONFLICT (gstin) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`, [gstin, taxpayer ? JSON.stringify(taxpayer) : null]);
  return { taxpayer, cached: false };
}
