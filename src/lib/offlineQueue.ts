/**
 * Offline counter billing: bills made at the counter while the internet is down are kept on this device (IndexedDB,
 * which survives closing the browser or restarting the computer) and sent when the connection returns.
 *
 * Every bill carries its own ID (clientRef). The server keeps it on the invoice, so if a send is retried (the reply
 * was lost, the page was refreshed, two tabs sent it) the bill is still saved exactly once. The GST invoice number
 * is given by the server when the bill arrives; until then the receipt shows the bill's offline reference.
 */
import { api, ApiError } from '@/api/client';

export interface OfflineBill {
  clientRef: string;
  shopId: string;
  userId: string;
  madeAt: string; // ISO time the bill was made at the counter
  body: Record<string, unknown>; // what /shop/pos/sale takes
  expectedTotal: number; // total shown and collected at the counter
  summary: { customer: string; items: number; mode: string };
  status: 'waiting' | 'sending' | 'failed' | 'saved';
  attempts: number;
  lastError?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  savedTotal?: number;
  savedAt?: string;
}

const DB = 'c360-offline';
const STORE = 'pos-bills';
let dbp: Promise<IDBDatabase> | null = null;
const open = () => (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'clientRef' }); };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => { dbp = null; reject(r.error); };
}));
const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
};

const listeners = new Set<() => void>();
const changed = () => { listeners.forEach((f) => f()); try { localStorage.setItem('c360.offline.ping', String(Date.now())); } catch { /* private mode */ } };
/** Re-render when the queue changes (in this tab or another one). */
export function onQueueChange(fn: () => void) {
  listeners.add(fn);
  const storage = (e: StorageEvent) => { if (e.key === 'c360.offline.ping') fn(); };
  window.addEventListener('storage', storage);
  return () => { listeners.delete(fn); window.removeEventListener('storage', storage); };
}

/** A new bill ID: time first (so they sort), then random. Never reused. */
export function newClientRef() {
  const rnd = crypto.getRandomValues(new Uint8Array(9));
  return `pos-${Date.now().toString(36)}-${Array.from(rnd, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
}
/** The short reference printed on an offline receipt until the invoice number arrives. */
export const offlineRef = (clientRef: string) => `OFF-${clientRef.slice(-6).toUpperCase()}`;

export const allBills = async (): Promise<OfflineBill[]> => ((await tx('readonly', (s) => s.getAll())) as OfflineBill[]).sort((a, b) => a.madeAt.localeCompare(b.madeAt));
export const saveBill = async (b: OfflineBill) => { await tx('readwrite', (s) => s.put(b)); changed(); };
export const removeBill = async (clientRef: string) => { await tx('readwrite', (s) => s.delete(clientRef)); changed(); };

/** Network trouble (worth retrying later) as opposed to the server refusing the bill. */
export const isNetworkError = (e: unknown) => e instanceof ApiError ? e.code === 'network' || e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504 : e instanceof TypeError;

let running: Promise<{ saved: OfflineBill[]; failed: OfflineBill[] }> | null = null;

/**
 * Sends this shop's waiting bills, oldest first. Saved bills keep their invoice number for a day so the counter can
 * see what happened; refused ones wait for someone to look at them. Only one send runs at a time per tab.
 */
export function syncBills(shopId: string, opts: { retryFailed?: string } = {}) {
  return (running ??= (async () => {
    const saved: OfflineBill[] = [];
    const failed: OfflineBill[] = [];
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return { saved, failed };
      const now = Date.now();
      for (const b of await allBills()) {
        // Saved bills are kept a day for the record on screen, then cleared.
        if (b.status === 'saved') { if (b.savedAt && now - Date.parse(b.savedAt) > 86_400_000) await removeBill(b.clientRef); continue; }
        if (b.shopId !== shopId) continue; // another business on this device: sent when that one is open
        if (b.status === 'failed' && opts.retryFailed !== b.clientRef) continue;
        await saveBill({ ...b, status: 'sending' });
        try {
          const r = await api.post<{ invoice: { id: string; number: string | null; total: number } }>('/shop/pos/sale', { ...b.body, clientRef: b.clientRef, madeAt: b.madeAt });
          const done: OfflineBill = { ...b, status: 'saved', attempts: b.attempts + 1, invoiceId: r.invoice.id, invoiceNumber: r.invoice.number ?? undefined, savedTotal: r.invoice.total, savedAt: new Date().toISOString(), lastError: undefined };
          await saveBill(done);
          saved.push(done);
        } catch (e) {
          if (isNetworkError(e) || (e instanceof ApiError && (e.status === 401 || e.status === 429))) {
            // Still offline, the server is waking up, or the login expired: keep it waiting, try again later.
            await saveBill({ ...b, status: 'waiting', attempts: b.attempts + 1, lastError: e instanceof ApiError && e.status === 401 ? 'Sign in again to send this bill' : undefined });
            break;
          }
          const bad: OfflineBill = { ...b, status: 'failed', attempts: b.attempts + 1, lastError: (e as Error).message };
          await saveBill(bad);
          failed.push(bad);
        }
      }
      return { saved, failed };
    } finally {
      running = null;
    }
  })());
}
