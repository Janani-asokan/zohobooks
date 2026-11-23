/**
 * GSTIN lookup: the legal name, trade name, status and address of a GST number, from the lookup service set in
 * GSTIN_LOOKUP_URL (config.gstLookup). Providers pass through the GST portal's taxpayer record, so we read that
 * shape wherever it sits in their reply. Results (including "no such GSTIN") are kept for 30 days.
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

/** The parts of the portal record a bill needs, with the address written the way it is printed. */
export function parseTaxpayer(reply: unknown, gstin: string): Taxpayer | null {
  const r = findRecord(reply);
  if (!r) return null;
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

export const lookupOn = () => !!config.gstLookup;

/** Looks a GSTIN up (cached). Returns the record, null if the service says it doesn't exist, or throws if it failed. */
export async function lookupGstin(gstin: string): Promise<{ taxpayer: Taxpayer | null; cached: boolean }> {
  const [hit] = await query<{ data: Taxpayer | null }>(`SELECT data FROM gstin_lookups WHERE gstin = $1 AND fetched_at > now() - make_interval(days => $2)`, [gstin, KEEP_DAYS]);
  if (hit) return { taxpayer: hit.data, cached: true };
  const c = config.gstLookup!;
  const url = c.url.replace('{gstin}', encodeURIComponent(gstin)).replace('{key}', encodeURIComponent(c.key));
  const headers: Record<string, string> = { accept: 'application/json' };
  if (c.key && !c.url.includes('{key}')) headers[c.keyHeader] = c.key;
  const res = await trackedFetch('gstin', 'gstin_lookup', url, { headers, signal: AbortSignal.timeout(12_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok && res.status !== 404) throw new Error(`The GST lookup service answered HTTP ${res.status}`);
  const taxpayer = res.status === 404 ? null : parseTaxpayer(body, gstin);
  if (res.ok && !taxpayer && body && !/not\s*found|invalid|no\s*record/i.test(JSON.stringify(body).slice(0, 2000))) {
    throw new Error('The GST lookup service sent a reply we couldn’t read');
  }
  await query(`INSERT INTO gstin_lookups (gstin, data, fetched_at) VALUES ($1, $2, now())
      ON CONFLICT (gstin) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`, [gstin, taxpayer ? JSON.stringify(taxpayer) : null]);
  return { taxpayer, cached: false };
}
