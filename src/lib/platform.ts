/**
 * Web app or CorpusLite phone app. The phone app is the same code built with VITE_APP=1 (npm run build:app): it
 * calls the server at VITE_API_BASE with a bearer token, keeps a copy of every screen's data on the phone so it
 * opens with no internet, numbers bills in the phone's own series, and leaves the web-only pages out of the package.
 */
export const IS_APP = import.meta.env.VITE_APP === '1';
export const API_BASE: string = IS_APP ? (import.meta.env.VITE_API_BASE || 'https://ledgerly-books.onrender.com') : '';

const TOKEN = 'c360.app.token';
export const appToken = (): string | null => { try { return localStorage.getItem(TOKEN); } catch { return null; } };
export const setAppToken = (t: string | null) => { try { if (t) localStorage.setItem(TOKEN, t); else localStorage.removeItem(TOKEN); } catch { /* private mode */ } };

/* ---------- The last copy of every GET, kept on the phone (IndexedDB), served when offline ---------- */
const DB = 'c360-app-cache'; const STORE = 'get';
let dbp: Promise<IDBDatabase> | null = null;
const open = () => (dbp ??= new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
export async function cachePut(url: string, data: unknown) {
  try { const db = await open(); await new Promise<void>((res) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put({ data, at: Date.now() }, url); t.oncomplete = () => res(); t.onerror = () => res(); }); } catch { /* storage full or blocked */ }
}
export async function cacheGet<T>(url: string): Promise<{ data: T; at: number } | null> {
  try { const db = await open(); return await new Promise((res) => { const r = db.transaction(STORE).objectStore(STORE).get(url); r.onsuccess = () => res((r.result as { data: T; at: number }) ?? null); r.onerror = () => res(null); }); } catch { return null; }
}
export async function cacheClear() { try { const db = await open(); db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch { /* */ } }
/** Patch a cached list in place (stock after an offline sale), so screens show what the phone knows. */
export async function cacheUpdate<T>(url: string, fn: (v: T) => T) { const c = await cacheGet<T>(url); if (c) await cachePut(url, fn(c.data)); }
