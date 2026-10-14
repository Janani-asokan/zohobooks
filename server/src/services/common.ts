import type { Db } from '../db';
import { one } from '../db';
import { badRequest, notFound } from '../http';

/** Atomically increments a per-shop counter (row lock via ON CONFLICT) and returns the new value. */
export async function nextSeq(db: Db, shopId: string, key: string, start = 0): Promise<number> {
  const r = await one<{ value: number }>(
    db,
    `INSERT INTO counters (shop_id, key, value) VALUES ($1, $2, $3 + 1)
     ON CONFLICT (shop_id, key) DO UPDATE SET value = counters.value + 1 RETURNING value`,
    [shopId, key, start],
  );
  return r!.value;
}

export async function peekSeq(db: Db, shopId: string, key: string, start = 0): Promise<number> {
  const r = await one<{ value: number }>(db, 'SELECT value FROM counters WHERE shop_id = $1 AND key = $2', [shopId, key]);
  return (r?.value ?? start) + 1;
}

export async function platformConfig(db: Db) {
  const c = await one(db, 'SELECT customer_id_prefix, fy_start_month, auto_reset_invoice_numbering FROM platform_config WHERE id = 1');
  return { prefix: c.customer_id_prefix as string, fyStartMonth: c.fy_start_month as number, autoReset: c.auto_reset_invoice_numbering as boolean };
}

export async function getOrg(db: Db, shopId: string) {
  const o = await one(db, 'SELECT * FROM organizations WHERE shop_id = $1', [shopId]);
  if (!o) throw notFound('Organization');
  return o;
}

export async function requireRow(db: Db, table: string, shopId: string, id: string, what: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound(what);
  const r = await one(db, `SELECT * FROM ${table} WHERE shop_id = $1 AND id = $2`, [shopId, id]);
  if (!r) throw notFound(what);
  return r;
}

export async function primaryBranchId(db: Db, shopId: string, branchId?: string | null) {
  if (branchId) {
    const b = await one(db, 'SELECT id FROM branches WHERE shop_id = $1 AND id = $2', [shopId, branchId]);
    if (!b) throw badRequest('Unknown branch');
    return b.id as string;
  }
  const b = await one(db, 'SELECT id FROM branches WHERE shop_id = $1 ORDER BY is_primary DESC, created_at LIMIT 1', [shopId]);
  return b!.id as string;
}

/** Plan-limit check helper. */
export async function planLimits(db: Db, shopId: string) {
  return (await one(db, 'SELECT p.* FROM shops s JOIN plans p ON p.id = s.plan_id WHERE s.id = $1', [shopId]))!;
}
