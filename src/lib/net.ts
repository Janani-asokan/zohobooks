/**
 * How the connection really is. The browser's "online" flag stays true on weak mobile data, a captive Wi-Fi page or
 * a broken router, so a counter would wait 10–25 s per bill while the customer stands there. After a request fails
 * for network reasons the connection counts as "weak" for a minute: billing saves straight to this device, and a
 * small check (/api/health, 5 s) runs every 15 s to notice the moment it is back.
 *
 * Also keeps the gap between this device's clock and the server's, so the counter can be told the clock is wrong
 * (bills are dated by the device clock when made offline).
 */
import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/platform';

const WEAK_FOR = 60_000;
let downUntil = 0;
let skewMs = 0;
let probing: number | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** The connection looks broken right now (recent network failure), even if the browser says online. */
export const netWeak = () => Date.now() < downUntil;
/** This device's clock minus the server's, in ms (0 until a server reply has been seen). */
export const clockSkew = () => skewMs;

export function noteNetFailure() {
  const was = netWeak();
  downUntil = Date.now() + WEAK_FOR;
  if (!was) emit();
  startProbe();
}
export function noteNetOk(serverDate?: string | null) {
  if (serverDate) { const t = Date.parse(serverDate); if (Number.isFinite(t)) skewMs = Date.now() - t; }
  if (downUntil) { downUntil = 0; emit(); }
}

function startProbe() {
  if (probing !== null || typeof window === 'undefined') return;
  probing = window.setInterval(async () => {
    if (!netWeak() && downUntil === 0) { window.clearInterval(probing!); probing = null; return; }
    if (navigator.onLine === false) return;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(`${API_BASE}/api/health`, { cache: 'no-store', signal: ctrl.signal });
      if (r.ok) noteNetOk(r.headers.get('date'));
    } catch { downUntil = Math.max(downUntil, Date.now() + 20_000); } finally { clearTimeout(t); }
  }, 15_000);
}

export type NetState = 'online' | 'weak' | 'offline';
export function netState(): NetState { return typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : netWeak() ? 'weak' : 'online'; }

/** Re-renders on every change: browser online/offline events and weak / recovered. */
export function useNet(): NetState {
  const [s, setS] = useState<NetState>(netState);
  useEffect(() => {
    const f = () => setS(netState());
    subs.add(f); window.addEventListener('online', f); window.addEventListener('offline', f);
    // The weak window runs out by itself: look again when it would.
    const t = window.setInterval(f, 5000);
    return () => { subs.delete(f); window.removeEventListener('online', f); window.removeEventListener('offline', f); window.clearInterval(t); };
  }, []);
  return s;
}
