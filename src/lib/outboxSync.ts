/**
 * Sends the saves kept offline (outbox.ts), oldest first, one at a time, so a customer made offline exists before
 * the invoice for them. Stops at the first network problem (tries again later); a save the server refuses (a
 * mistake in it, a stock or credit limit) is marked for someone to look at, and the rest carry on.
 */
import { api, ApiError } from '@/api/client';
import { allChanges, dropChange, putChange, type OutboxEntry } from '@/lib/outbox';
import { isNetworkError } from '@/lib/offlineQueue';

let running: Promise<{ sent: OutboxEntry[]; failed: OutboxEntry[] }> | null = null;

export function syncOutbox(shopId: string, opts: { retry?: string } = {}) {
  return (running ??= (async () => {
    const sent: OutboxEntry[] = []; const failed: OutboxEntry[] = [];
    try {
      if (navigator.onLine === false) return { sent, failed };
      const now = Date.now();
      for (const e of await allChanges()) {
        if (e.status === 'done') { if (e.doneAt && now - Date.parse(e.doneAt) > 86_400_000) await dropChange(e.key); continue; }
        if (e.shopId !== shopId) continue; // another business on this device: sent when it is open
        if (e.status === 'failed' && opts.retry !== e.key) continue;
        await putChange({ ...e, status: 'sending' });
        try {
          const r = await api.replay<{ id?: string; number?: string | null }>(e.method, e.url, e.body, e.key, e.madeAt);
          const done: OutboxEntry = { ...e, status: 'done', attempts: e.attempts + 1, error: undefined, doneAt: new Date().toISOString(), result: { id: r?.id, number: r?.number ?? null } };
          await putChange(done); sent.push(done);
        } catch (err) {
          const retryLater = isNetworkError(err) || (err instanceof ApiError && ([401, 408, 429, 502, 503, 504].includes(err.status) || err.code === 'in_progress'));
          if (retryLater) {
            await putChange({ ...e, status: 'waiting', attempts: e.attempts + 1, error: err instanceof ApiError && err.status === 401 ? 'Sign in again to send this' : undefined });
            break;
          }
          const bad: OutboxEntry = { ...e, status: 'failed', attempts: e.attempts + 1, error: (err as Error).message };
          await putChange(bad); failed.push(bad);
        }
      }
      return { sent, failed };
    } finally { running = null; }
  })());
}
