export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: Record<string, string>) {
    super(message);
  }
}

type Json = object;

async function request<T>(method: string, url: string, body?: Json): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + url, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'ledgerly', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, navigator.onLine ? 'Can’t reach the server. Please try again.' : 'You’re offline. Changes can’t be saved until you reconnect.', 'network');
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = new ApiError(res.status, (data as any)?.error ?? `Request failed (${res.status})`, (data as any)?.code, (data as any)?.details);
    if (res.status === 401 || ['license_expired', 'workspace_inactive', 'password_change_required'].includes(err.code)) window.dispatchEvent(new CustomEvent('api:auth', { detail: err }));
    throw err;
  }
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
  post: <T>(url: string, body: Json = {}) => request<T>('POST', url, body),
  put: <T>(url: string, body: Json) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: Json) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/** Triggers a browser download of an API resource (CSV/JSON), carrying the session cookie. */
export async function download(url: string, filename: string, init?: { method?: string; body?: Json }) {
  const res = await fetch('/api' + url, {
    method: init?.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'ledgerly', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
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
