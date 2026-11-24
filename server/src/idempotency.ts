/**
 * Idempotency-Key for shop changes (POST / PUT / PATCH / DELETE). The app sends a fresh key with every save, and
 * the same key when it sends a save again (made offline, or the reply was lost). The first request does the work and
 * its answer is kept; a repeat gets that answer back (header Idempotent-Replay: true) and nothing is done twice.
 *
 * Answers that may change later are not kept, so a retry runs again: server errors, sign-in / permission problems,
 * licence or rate limits. A repeat that arrives while the first is still running gets 409 "in_progress" (try again).
 */
import type { NextFunction, Request, Response } from 'express';
import { one, query, withTenant } from './db';

const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const RETRYABLE = (s: number) => s >= 500 || s === 401 || s === 402 || s === 403 || s === 408 || s === 409 || s === 429;

export function idempotency(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const key = req.get('Idempotency-Key');
  if (!key || req.ctx?.kind !== 'user') return next();
  if (!KEY_RE.test(key)) { res.status(400).json({ error: 'Invalid Idempotency-Key', code: 'bad_idempotency_key' }); return; }
  const shopId = req.ctx.shopId;
  const path = req.originalUrl.split('?')[0]!;
  void (async () => {
    const got = await withTenant(shopId, async (db) => {
      const ins = await db.query('INSERT INTO idempotency_keys (shop_id, key, method, path) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [shopId, key, req.method, path]);
      if (ins.rowCount) return null;
      return one(db, 'SELECT method, path, status, body, created_at FROM idempotency_keys WHERE shop_id = $1 AND key = $2', [shopId, key]);
    });
    if (got) {
      if (got.method !== req.method || got.path !== path) { res.status(422).json({ error: 'This change ID was already used for something else', code: 'idempotency_mismatch' }); return; }
      if (got.status === 0) {
        // Still running (or the server stopped half-way: after 2 minutes the claim is dropped so it can be redone).
        if (Date.now() - new Date(got.created_at).getTime() > 120_000) {
          await withTenant(shopId, (db) => db.query('DELETE FROM idempotency_keys WHERE shop_id = $1 AND key = $2 AND status = 0', [shopId, key]));
        }
        res.status(409).json({ error: 'This change is still being saved. Try again in a moment.', code: 'in_progress' });
        return;
      }
      res.setHeader('Idempotent-Replay', 'true');
      res.status(got.status).json(got.body);
      return;
    }
    const json = res.json.bind(res);
    let body: unknown = null;
    res.json = (b: unknown) => { body = b; return json(b); };
    res.on('finish', () => {
      const s = res.statusCode;
      const done = RETRYABLE(s)
        ? withTenant(shopId, (db) => db.query('DELETE FROM idempotency_keys WHERE shop_id = $1 AND key = $2', [shopId, key]))
        : withTenant(shopId, (db) => db.query('UPDATE idempotency_keys SET status = $3, body = $4 WHERE shop_id = $1 AND key = $2', [shopId, key, s, JSON.stringify(body ?? null)]));
      done.catch((e) => console.error('[idempotency]', e));
    });
    next();
  })().catch(next);
}

/** Hourly: answers older than 30 days are no longer needed. */
export const pruneIdempotencyKeys = () => query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '30 days'");
