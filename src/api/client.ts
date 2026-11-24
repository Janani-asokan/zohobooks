export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: Record<string, string>) {
    super(message);
  }
}

import { API_BASE, IS_APP, appToken, cacheGet, cachePut } from '@/lib/platform';
import { noteNetFailure, noteNetOk } from '@/lib/net';
import { CLIENT_ID_KINDS, keepOffline, offlineKind, skipTrying } from '@/lib/outbox';

type Json = object;

/** Headers for every call. The phone app signs in with a bearer token instead of the browser's cookie. */
export const apiHeaders = (json: boolean): Record<string, string> => {
  const t = IS_APP ? appToken() : null;
  return { 'X-Requested-With': 'ledgerly', ...(json ? { 'Content-Type': 'application/json' } : {}), ...(IS_APP ? { 'X-Client': 'corpuslite' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

/** `timeoutMs`: give up sooner (the counter's bill: the customer is waiting, and the bill can be kept offline). */
export interface RequestOpts {
  timeoutMs?: number;
  /** Sending a save that was kept offline: its own key and when it was made; it is never kept again. */
  replay?: { key: string; madeAt: string };
}

/** A random ID (crypto.randomUUID needs https; the shop may open the server by its plain-http address). */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) { try { return crypto.randomUUID(); } catch { /* http */ } }
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6]! & 0x0f) | 0x40; b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function request<T>(method: string, url: string, body?: Json, opts: RequestOpts = {}): Promise<T> {
  let res: Response;
  // Saves that work offline (invoices, payments, customers, items…): each gets its own key; with no internet (or it
  // failed a moment ago) the save is kept on this device and sent later, and the screen carries on.
  const kind = !opts.replay && (method === 'POST' || method === 'PUT') ? offlineKind(method, url) : null;
  const key = opts.replay?.key ?? (kind ? `w-${uuid()}` : undefined);
  if (kind && CLIENT_ID_KINDS.includes(kind) && method === 'POST' && body && !(body as { id?: string }).id) body = { ...body, id: uuid() };
  const keep = () => keepOffline(method as 'POST' | 'PUT', url, body as Record<string, unknown>, key!, kind!) as Promise<T>;
  if (kind && skipTrying()) return keep();
  // A stalled connection (weak mobile data, a captive Wi-Fi page) would otherwise leave the screen spinning for ever:
  // give up after 25 s (60 s for uploads and reads that build files) and treat it like being offline.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? (kind ? 12_000 : /extract|attachments|import|export|pdf/.test(url) ? 60_000 : 25_000));
  try {
    res = await fetch(API_BASE + '/api' + url, {
      method,
      credentials: IS_APP ? 'omit' : 'same-origin',
      headers: { ...apiHeaders(body !== undefined), ...(key ? { 'Idempotency-Key': key } : {}), ...(opts.replay ? { 'X-Made-Offline-At': opts.replay.madeAt } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    clearTimeout(timer);
    noteNetFailure();
    if (kind) return keep();
    // The phone app works offline: a screen opens with the last copy it saw (shop data, items, customers …).
    if (IS_APP && method === 'GET') { const c = await cacheGet<T>(url); if (c) return c.data; }
    throw new ApiError(0, navigator.onLine ? 'Can’t reach the server. Please try again.' : 'You’re offline. Changes can’t be saved until you reconnect.', 'network');
  }
  clearTimeout(timer);
  // The service worker answers "offline" itself (503 + code network) when it has nothing cached: not a real reply.
  // The service worker answers for the server when the network fails (x-offline: its "you're offline" reply, or the
  // last copy it kept): that is not a sign the connection is back.
  if (res.headers.get('x-offline')) noteNetFailure();
  else noteNetOk(res.headers.get('date'));
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = new ApiError(res.status, (data as any)?.error ?? `Request failed (${res.status})`, (data as any)?.code, (data as any)?.details);
    if (res.status === 401 || ['license_expired', 'workspace_inactive', 'password_change_required'].includes(err.code)) window.dispatchEvent(new CustomEvent('api:auth', { detail: err }));
    throw err;
  }
  if (IS_APP && method === 'GET' && !/\/(pdf|download|export)\b/.test(url)) void cachePut(url, data);
  return data as T;
}

const safeJson = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  /** Sends a save that was kept offline, with its own key and the time it was made. */
  replay: <T>(method: 'POST' | 'PUT', url: string, body: Json, key: string, madeAt: string) => request<T>(method, url, body, { replay: { key, madeAt }, timeoutMs: 20_000 }),
  post: <T>(url: string, body: Json = {}, opts?: RequestOpts) => request<T>('POST', url, body, opts),
  put: <T>(url: string, body: Json, opts?: RequestOpts) => request<T>('PUT', url, body, opts),
  patch: <T>(url: string, body: Json) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/** Triggers a browser download of an API resource (CSV/JSON), carrying the session cookie. */
export async function download(url: string, filename: string, init?: { method?: string; body?: Json }) {
  const res = await fetch(API_BASE + '/api' + url, {
    method: init?.method ?? 'GET',
    credentials: IS_APP ? 'omit' : 'same-origin',
    headers: apiHeaders(!!init?.body),
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const d = safeJson(await res.text());
    throw new ApiError(res.status, (d as any)?.error ?? 'Download failed', (d as any)?.code, (d as any)?.details);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Field-level messages from a 400 response, for highlighting inputs. */
export const fieldErrors = (e: unknown): Record<string, string> => (e instanceof ApiError && e.details && typeof e.details === 'object' ? e.details : {});
