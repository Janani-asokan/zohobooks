import pg from 'pg';
import { config } from './config';
import { BUSINESS_TZ } from './tz';

// numeric → number, date → 'YYYY-MM-DD' string (avoid timezone shifts)
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)) as unknown as string);
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)) as unknown as string);
pg.types.setTypeParser(1082, (v) => v);

// Sessions use the business timezone too, so SQL current_date agrees with the app's idea of today.
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.PG_POOL_MAX ?? 10), options: `-c timezone=${BUSINESS_TZ}` });

export type Db = pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  return (await pool.query<T>(sql, params)).rows;
}

/** Run fn inside a transaction (platform scope — no tenant set). */
export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Run fn inside a transaction scoped to one shop. Row-level security policies read
 * app.shop_id, so every query in fn can only see and write that shop's rows.
 */
export async function withTenant<T>(shopId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return tx(async (db) => {
    await db.query("SELECT set_config('app.shop_id', $1, true)", [shopId]);
    return fn(db);
  });
}

export async function one<T extends pg.QueryResultRow = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}
export async function many<T extends pg.QueryResultRow = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}
