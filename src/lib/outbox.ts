/**
 * Offline saves for the rest of the app (the counter's bills have their own queue, offlineQueue.ts).
 *
 * New invoices, invoice edits, payments received, customers, items, suppliers, purchase bills and expenses are kept
 * on this device (IndexedDB) when the server can't be reached, and sent later in the order they were made: a new
 * customer, then an invoice for them, then its payment. Every save carries its own Idempotency-Key (the server keeps
 * the answer), so sending again after a lost reply never saves twice. New customers, items and suppliers get their ID
 * on the device, so an invoice made offline can already point to a customer made offline.
 */
import { netWeak } from '@/lib/net';

export type OutboxKind = 'invoice' | 'invoice-edit' | 'payment' | 'customer' | 'customer-edit' | 'item' | 'item-edit' | 'vendor' | 'vendor-edit' | 'bill' | 'expense';
export interface OutboxEntry {
  key: string; // Idempotency-Key, also the entry's ID
  shopId: string; userId: string;
  method: 'POST' | 'PUT';
  url: string; // /shop/…
  body: Record<string, unknown>;
  kind: OutboxKind;
  label: string; // what it is, for the list ("Invoice for Nila Textiles · ₹1,180")
  madeAt: string;
  status: 'waiting' | 'sending' | 'failed' | 'done';
  attempts: number;
  error?: string;
  result?: { id?: string; number?: string | null };
  doneAt?: string;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** The saves that may be kept offline, and what they are. */
const RULES: Array<[string, RegExp, OutboxKind]> = [
  ['POST', /^\/shop\/invoices$/, 'invoice'],
  ['PUT', new RegExp(`^/shop/invoices/${UUID}$`), 'invoice-edit'],
  ['POST', new RegExp(`^/shop/invoices/${UUID}/payments$`), 'payment'],
  ['POST', /^\/shop\/customers$/, 'customer'],
  ['PUT', new RegExp(`^/shop/customers/${UUID}$`), 'customer-edit'],
  ['POST', /^\/shop\/items$/, 'item'],
  ['PUT', new RegExp(`^/shop/items/${UUID}$`), 'item-edit'],
  ['POST', /^\/shop\/vendors$/, 'vendor'],
  ['PUT', new RegExp(`^/shop/vendors/${UUID}$`), 'vendor-edit'],
  ['POST', /^\/shop\/bills$/, 'bill'],
  ['POST', /^\/shop\/expenses$/, 'expense'],
];
export const offlineKind = (method: string, url: string): OutboxKind | null => RULES.find(([m, re]) => m === method && re.test(url))?.[2] ?? null;
/** Creates whose ID is made on the device (the server accepts it), so later offline saves can refer to them. */
export const CLIENT_ID_KINDS: OutboxKind[] = ['customer', 'item', 'vendor'];

const money = (v: unknown) => (typeof v === 'number' ? ` · ₹${v.toLocaleString('en-IN')}` : '');
export function describe(kind: OutboxKind, body: Record<string, unknown>): string {
  if (typeof body.offlineLabel === 'string' && body.offlineLabel) return body.offlineLabel;
  const name = (body.companyName as string) || (body.name as string) || '';
  switch (kind) {
    case 'invoice': return body.issue === false ? 'Draft invoice' : 'New invoice';
    case 'invoice-edit': return 'Invoice changes';
    case 'payment': return `Payment received${money(body.amount)}${body.mode ? ` · ${body.mode}` : ''}`;
    case 'customer': return `New customer: ${name}`;
    case 'customer-edit': return `Customer changes: ${name}`;
    case 'item': return `New item: ${name}`;
    case 'item-edit': return `Item changes: ${name}`;
    case 'vendor': return `New supplier: ${name}`;
    case 'vendor-edit': return `Supplier changes: ${name}`;
    case 'bill': return `Purchase bill${body.billNumber ? ` ${body.billNumber as string}` : ''}`;
    case 'expense': return `Expense${money(body.amount)}`;
  }
}

/* ---------- storage ---------- */
const DB = 'c360-outbox'; const STORE = 'changes';
let dbp: Promise<IDBDatabase> | null = null;
const open = () => (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'key' }); };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => { dbp = null; reject(r.error); };
}));
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode); const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
}
const subs = new Set<() => void>();
const changed = () => { subs.forEach((f) => f()); try { localStorage.setItem('c360.outbox.ping', String(Date.now())); } catch { /* */ } };
export function onOutboxChange(fn: () => void) {
  subs.add(fn);
  const st = (e: StorageEvent) => { if (e.key === 'c360.outbox.ping') fn(); };
  window.addEventListener('storage', st);
  return () => { subs.delete(fn); window.removeEventListener('storage', st); };
}
export const allChanges = async (): Promise<OutboxEntry[]> => ((await run('readonly', (s) => s.getAll())) as OutboxEntry[]).sort((a, b) => a.madeAt.localeCompare(b.madeAt));
export const putChange = async (e: OutboxEntry) => { await run('readwrite', (s) => s.put(e)); changed(); };
export const dropChange = async (key: string) => { await run('readwrite', (s) => s.delete(key)); changed(); };

/** Who is signed in (set by the app shell), so a kept save belongs to the right business. */
let who: { shopId: string; userId: string } | null = null;
export const setOutboxUser = (w: { shopId: string; userId: string } | null) => { who = w; };

/** Keep a save that couldn't be sent. Returns what the screen gets instead of the server's answer. */
export async function keepOffline(method: 'POST' | 'PUT', url: string, body: Record<string, unknown>, key: string, kind: OutboxKind) {
  if (!who) throw new Error('not signed in');
  const entry: OutboxEntry = { key, shopId: who.shopId, userId: who.userId, method, url, body, kind, label: describe(kind, body), madeAt: new Date().toISOString(), status: 'waiting', attempts: 0 };
  await putChange(entry);
  const urlId = new RegExp(`(${UUID})(?:/payments)?$`).exec(url)?.[1];
  window.dispatchEvent(new CustomEvent('c360:queued', { detail: entry }));
  // A stand-in for the server's answer: the screen can close and go on. offline: true tells it this wasn't saved yet.
  return { ...body, id: (body.id as string) ?? (method === 'PUT' ? urlId : `offline-${key}`), offline: true, offlineKey: key, number: null };
}

/** Whether to keep the save straight away instead of trying (no internet, or it failed a moment ago). */
export const skipTrying = () => (typeof navigator !== 'undefined' && navigator.onLine === false) || netWeak();

/**
 * Lists of customers, items and suppliers include what was added or changed on this device and not sent yet, so a
 * customer made offline can be picked on the next bill straight away. Marked pendingSync.
 */
export async function withPending<T extends { id: string }>(list: T[], kind: 'customer' | 'item' | 'vendor', extra?: (body: Record<string, unknown>) => Record<string, unknown>): Promise<T[]> {
  let changes: OutboxEntry[];
  try { changes = (await allChanges()).filter((e) => e.status !== 'done' && (!who || e.shopId === who.shopId) && (e.kind === kind || e.kind === `${kind}-edit`)); } catch { return list; }
  if (!changes.length || !Array.isArray(list)) return list;
  const out = [...list];
  for (const e of changes) {
    const id = e.kind === kind ? (e.body.id as string) : new RegExp(`(${UUID})$`).exec(e.url)?.[1];
    if (!id) continue;
    const at = out.findIndex((x) => x.id === id);
    if (at >= 0) out[at] = { ...out[at]!, ...e.body, id, pendingSync: true };
    else if (e.kind === kind) out.push({ balance: 0, outstanding: 0, stock: 0, stockByBranch: {}, archived: false, createdAt: e.madeAt, customId: 'not sent yet', ...(extra?.(e.body) ?? {}), ...e.body, id, pendingSync: true } as unknown as T);
  }
  return out;
}

/** Saves kept on this device for this business that match, newest first (for "waiting to send" notes on screens). */
export async function pendingFor(shopId: string, match: (e: OutboxEntry) => boolean) {
  try { return (await allChanges()).filter((e) => e.shopId === shopId && e.status !== 'done' && match(e)).reverse(); } catch { return []; }
}
