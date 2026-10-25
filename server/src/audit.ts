import type { NextFunction, Request, Response } from 'express';
import { withTenant, type Db } from './db';

declare module 'express-serve-static-core' {
  interface Request { audited?: boolean }
}

/**
 * Append an audit entry. Must run in the same transaction as the change.
 * Shop events require app.shop_id to be set to shopId (RLS); platform events use shopId = null.
 */
export async function audit(
  db: Db,
  req: Request | null,
  shopId: string | null,
  action: string,
  entity: string,
  entityId: string | number = '',
  details: Record<string, unknown> = {},
) {
  const ctx = req?.ctx;
  if (req) req.audited = true;
  await db.query(
    'INSERT INTO audit_log (shop_id, actor_type, actor_id, actor_name, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [shopId, ctx?.kind ?? 'system', ctx?.id ?? null, ctx?.name ?? 'System', action, entity, String(entityId), JSON.stringify(details), req?.ip ?? ''],
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERB: Record<string, string> = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };

/**
 * Safety net for "every change is logged": a successful shop write whose route did not write its own
 * audit entry gets a generic one (who, what, which record, which fields), after the response is sent.
 */
export function auditWrites(req: Request, res: Response, next: NextFunction) {
  if (!VERB[req.method] || /^\/(extract|reports\/pdf)\b/.test(req.path)) return next();
  res.on('finish', () => {
    const ctx = req.ctx;
    if (req.audited || res.statusCode >= 400 || ctx?.kind !== 'user') return;
    const parts = req.path.split('/').filter(Boolean);
    const id = parts.find((p) => UUID.test(p)) ?? '';
    const named = parts.filter((p) => !UUID.test(p));
    const entity = (named[0] ?? 'shop').replace(/s$/, '').replace(/-/g, '_');
    const action = named.length > 1 ? named.slice(1).join('_').replace(/-/g, '_') : VERB[req.method]!;
    const fields = req.body && typeof req.body === 'object' ? Object.keys(req.body).filter((k) => !/password|secret|token|data$/i.test(k)).slice(0, 20) : [];
    withTenant(ctx.shopId, (db) => audit(db, req, ctx.shopId, action, entity, id, fields.length ? { fields } : {})).catch((e) => console.error('[audit]', e.message));
  });
  next();
}
