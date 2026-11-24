export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: Record<string, string>) {
    super(message);
  }
}

import { API_BASE, IS_APP, appToken, cacheGet, cachePut } from '@/lib/platform';
import { noteNetFailure, noteNetOk } from '@/lib/net';

type Json = object;

/** Headers for every call. The phone app signs in with a bearer token instead of the browser's cookie. */
export const apiHeaders = (json: boolean): Record<string, string> => {
  const t = IS_APP ? appToken() : null;
  return { 'X-Requested-With': 'ledgerly', ...(json ? { 'Content-Type': 'application/json' } : {}), ...(IS_APP ? { 'X-Client': 'corpuslite' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

/** `timeoutMs`: give up sooner (the counter's bill: the customer is waiting, and the bill can be kept offline). */
export interface RequestOpts { timeoutMs?: number }

async function request<T>(method: string, url: string, body?: Json, opts: RequestOpts = {}): Promise<T> {
  let res: Response;
  // A stalled connection (weak mobile data, a captive Wi-Fi page) would otherwise leave the screen spinning for ever:
  // give up after 25 s (60 s for uploads and reads that build files) and treat it like being offline.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? (/extract|attachments|import|export|pdf/.test(url) ? 60_000 : 25_000));
  try {
    res = await fetch(API_BASE + '/api' + url, {
      method,
      credentials: IS_APP ? 'omit' : 'same-origin',
      headers: apiHeaders(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    clearTimeout(timer);
    noteNetFailure();
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
  post: <T>(url: string, body: Json = {}, opts?: RequestOpts) => request<T>('POST', url, body, opts),
  put: <T>(url: string, body: Json) => request<T>('PUT', url, body),
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
