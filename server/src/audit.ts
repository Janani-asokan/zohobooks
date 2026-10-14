import type { Request } from 'express';
import type { Db } from './db';

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
  await db.query(
    'INSERT INTO audit_log (shop_id, actor_type, actor_id, actor_name, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [shopId, ctx?.kind ?? 'system', ctx?.id ?? null, ctx?.name ?? 'System', action, entity, String(entityId), JSON.stringify(details), req?.ip ?? ''],
  );
}
