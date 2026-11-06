/**
 * CorpusLite: this phone's own GST invoice series (spec: a series per phone). The phone registers once while online
 * and gets a code (A1, A2 …). Every bill it makes is numbered CODE/FY/0001, 0002 … by the phone itself, so the
 * final invoice number prints at the counter even with no internet. The server checks each number is used once.
 * A number is only used up when the bill is saved (online) or kept on the phone (offline), so failed tries leave no gap.
 */
import { api } from '@/api/client';
import { fyLabel } from '../../shared/fy';
import { IS_APP } from './platform';

interface Device { code: string; fy: string; fyStartMonth: number; next: number }
const DEV_ID = 'c360.app.deviceId';
const key = (shopId: string) => `c360.app.series.${shopId}`;
const read = (shopId: string): Device | null => { try { return JSON.parse(localStorage.getItem(key(shopId)) ?? 'null') as Device | null; } catch { return null; } };
const write = (shopId: string, d: Device) => { try { localStorage.setItem(key(shopId), JSON.stringify(d)); } catch { /* */ } };
export function deviceClientId(): string {
  try {
    let id = localStorage.getItem(DEV_ID);
    if (!id) { id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 32); localStorage.setItem(DEV_ID, id); }
    return id;
  } catch { return 'unknown-device'; }
}
const todayIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const deviceName = () => { const ua = navigator.userAgent; return /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android phone' : 'Device'; };

/** Registers this phone (or refreshes it): run while online. Keeps the higher of the phone's and the server's next number. */
export async function registerDevice(shopId: string): Promise<Device | null> {
  if (!IS_APP || !navigator.onLine) return read(shopId);
  try {
    const r = await api.post<Device & { name: string }>('/shop/app/device', { clientId: deviceClientId(), name: deviceName() });
    const cur = read(shopId);
    const next = cur && cur.fy === r.fy && cur.code === r.code ? Math.max(cur.next, r.next) : r.next;
    const d = { code: r.code, fy: r.fy, fyStartMonth: r.fyStartMonth, next };
    write(shopId, d);
    return d;
  } catch { return read(shopId); }
}
/** The number the next bill gets (not used up yet). Null until the phone has registered once. */
export function peekNumber(shopId: string): { clientId: string; seq: number; number: string } | null {
  if (!IS_APP) return null;
  const d = read(shopId);
  if (!d) return null;
  const fy = fyLabel(todayIndia(), d.fyStartMonth);
  if (fy !== d.fy) { d.fy = fy; d.next = 1; write(shopId, d); } // a new financial year starts the series again
  return { clientId: deviceClientId(), seq: d.next, number: `${d.code}/${fy}/${String(d.next).padStart(4, '0')}` };
}
/** The bill with this number was saved or kept: move on. */
export function takeNumber(shopId: string, seq: number) {
  const d = read(shopId);
  if (d) { d.next = Math.max(d.next, seq + 1); write(shopId, d); }
}
export const deviceSeries = (shopId: string) => read(shopId);
