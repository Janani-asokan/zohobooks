import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { config } from '../src/config';
import { pool } from '../src/db';
import { runBackup } from '../src/services/backup';
import { migrate } from '../src/migrate';
import { freshDb, login } from './helpers';

/*
 * Guards for the database rules in docs/DATABASE.md. They run on the real migrated schema, so a new migration that
 * breaks a rule fails here before it ships. When a rule genuinely does not apply, add the exception to the lists
 * below with a reason, never by loosening the check.
 */

/** The only foreign keys allowed to cascade a delete: owned children of rows the app may delete. */
const CASCADE_ALLOWED = new Set([
  'public_links.invoice_id', // links of a draft invoice (only drafts can be deleted)
  'reminder_log.invoice_id', // reminder history of a draft invoice
  'customer_activity.customer_id', // notes of a customer with no invoices or orders
]);
/** *_id columns that point at different tables depending on a type column, so no foreign key is possible. */
const POLYMORPHIC = new Set([
  'attachments.entity_id', 'audit_log.actor_id', 'bank_transactions.ref_id', 'stock_movements.ref_id',
  'stock_movements.user_id', // a shop user or a super admin
  'sessions.principal_id', 'password_resets.principal_id', // a shop user or a super admin
  'print_jobs.source_id', // a purchase order, a bill or an earlier print job (source_type says which)
]);
/** Tables with shop_id that are read before the shop is known (sign-in, public links), so they cannot use RLS. */
const NO_RLS = new Set(['users', 'user_shops', 'public_links', 'role_permissions', 'subscription_payments',
  'shop_features', // platform billing, read on every request before the shop context is set
  'ai_usage', 'ai_topups', // platform billing of AI credits, written outside the shop transaction
]);

const MIGRATIONS = path.resolve(__dirname, '../migrations');
/** Migrations up to this one were written before the rules; the scan below covers every later file. */
const RULES_SINCE = 15;

const rows = async (sql: string) => (await pool.query(sql)).rows;

beforeAll(async () => { await freshDb(); });

describe('database rules', () => {
  it('every table has a primary key', async () => {
    expect(await rows(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p')`)).toEqual([]);
  });

  it('no foreign key deletes history: CASCADE only on the listed owned children', async () => {
    const r = await rows(`SELECT c.conrelid::regclass || '.' || a.attname AS fk FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] WHERE c.contype = 'f' AND c.confdeltype = 'c'`);
    expect(r.map((x) => x.fk).filter((fk) => !CASCADE_ALLOWED.has(fk))).toEqual([]);
  });

  it('every uuid *_id column has a foreign key, unless it is polymorphic', async () => {
    const r = await rows(`SELECT c.table_name || '.' || c.column_name AS col FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name LIKE '%\\_id' AND c.data_type = 'uuid'
        AND NOT EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY(k.conkey)
          WHERE k.contype = 'f' AND k.conrelid = quote_ident(c.table_name)::regclass AND a.attname = c.column_name)`);
    expect(r.map((x) => x.col).filter((c) => !POLYMORPHIC.has(c))).toEqual([]);
  });

  it('every foreign key column is indexed', async () => {
    const r = await rows(`SELECT c.conrelid::regclass || '.' || a.attname AS fk FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND a.attname <> 'shop_id' AND NOT EXISTS (
        SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND (i.indkey[0] = c.conkey[1]
          OR (i.indkey[1] = c.conkey[1] AND (SELECT attname FROM pg_attribute WHERE attrelid = i.indrelid AND attnum = i.indkey[0]) = 'shop_id')))`);
    expect(r.map((x) => x.fk)).toEqual([]);
  });

  it('every table with shop_id has forced row-level security, apart from the listed sign-in tables', async () => {
    const r = await rows(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'shop_id'
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    expect(r.map((x) => x.relname).filter((t) => !NO_RLS.has(t))).toEqual([]);
  });

  it('every row-level-security table has the read-only backup policy, so backups include every shop', async () => {
    const r = await rows(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'backup_read' AND p.cmd = 'SELECT')`);
    expect(r.map((x) => x.relname)).toEqual([]);
  });

  it('migration files are numbered in order with no gaps or duplicates', () => {
    const nums = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((f) => Number(f.slice(0, 3)));
    expect(nums).toEqual(nums.map((_n, i) => i + 1));
  });

  it(`migrations from ${RULES_SINCE} on never drop, truncate, rename, delete rows or add cascading deletes`, () => {
    const banned = [/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i, /\bTRUNCATE\b/i, /\bRENAME\s+(COLUMN|TO)\b/i, /\bDELETE\s+FROM\b/i, /\bON\s+DELETE\s+CASCADE\b/i];
    const problems: string[] = [];
    for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && Number(x.slice(0, 3)) >= RULES_SINCE)) {
      fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/--.*$/, ''); // comments may mention the words
        if (/data-safety:\s*reviewed/.test(line)) return; // a reviewed exception, explained on the same line
        if (banned.some((b) => b.test(code))) problems.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(problems).toEqual([]);
  });
});

describe('history cannot be deleted by accident', () => {
  /** Tries a raw DELETE inside the shop's row-level-security context, always rolled back; returns the error code. */
  const refused = async (shopId: string, sql: string, params: unknown[]) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.shop_id', $1, true)", [shopId]);
      const r = await c.query(sql, params);
      return r.rowCount ? 'deleted' : 'nothing matched';
    } catch (e) {
      return (e as { code?: string }).code;
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  };

  it('an item with stock history, a bank account with transactions and a whole shop all refuse a raw DELETE', async () => {
    const shop = (await rows("SELECT id FROM shops WHERE email = 'owner@shop.com'"))[0]?.id ?? (await rows('SELECT id FROM shops LIMIT 1'))[0].id;
    const inShop = async (sql: string) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.shop_id', $1, true)", [shop]);
        return (await c.query(sql)).rows[0];
      } finally { await c.query('ROLLBACK'); c.release(); }
    };
    const item = (await inShop('SELECT item_id FROM stock_movements LIMIT 1')).item_id;
    const acc = (await inShop('SELECT account_id FROM bank_transactions LIMIT 1')).account_id;
    expect(await refused(shop, 'DELETE FROM items WHERE id = $1', [item])).toBe('23503');
    expect(await refused(shop, 'DELETE FROM bank_accounts WHERE id = $1', [acc])).toBe('23503');
    expect(await refused(shop, 'DELETE FROM shops WHERE id = $1', [shop])).toBe('23503');
  });
});

describe('customers are archived, not lost', () => {
  it('a customer with invoices cannot be deleted, can be archived and restored, and keeps its invoices', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const list = (await owner.get('/api/shop/customers')).body as { id: string; invoiceCount: number; archived: boolean }[];
    const c = list.find((x) => x.invoiceCount > 0)!;
    const del = await owner.del(`/api/shop/customers/${c.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error).toMatch(/Archive it instead/);

    const arch = await owner.post(`/api/shop/customers/${c.id}/archive`).send({ archived: true });
    expect(arch.status).toBe(200);
    expect(arch.body.archived).toBe(true);
    expect(arch.body.invoiceCount).toBe(c.invoiceCount);
    const invoices = (await owner.get('/api/shop/invoices')).body as { customerId: string }[];
    expect(invoices.some((i) => i.customerId === c.id)).toBe(true);

    const back = await owner.post(`/api/shop/customers/${c.id}/archive`).send({ archived: false });
    expect(back.body.archived).toBe(false);
    const viewer = await login('viewer@shop.com', 'viewer123').catch(() => null);
    if (viewer) expect((await viewer.post(`/api/shop/customers/${c.id}/archive`).send({ archived: true })).status).toBe(403);
  });
});

describe('migration runner', () => {
  it('refuses an applied migration that was edited afterwards, outside production', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    for (const f of fs.readdirSync(MIGRATIONS)) fs.copyFileSync(path.join(MIGRATIONS, f), path.join(dir, f));
    await expect(migrate(dir, () => {})).resolves.toEqual({ applied: [] });
    fs.appendFileSync(path.join(dir, '001_init.sql'), '\n-- edited after it ran\n');
    await expect(migrate(dir, () => {})).rejects.toThrow(/edited after they ran: 001_init.sql/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('runs the before-apply hook only when something is pending, and a failing migration changes nothing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    for (const f of fs.readdirSync(MIGRATIONS)) fs.copyFileSync(path.join(MIGRATIONS, f), path.join(dir, f));
    let called: string[] = [];
    await migrate(dir, () => {}, { beforeApply: async (p) => { called = p; } });
    expect(called).toEqual([]);
    fs.writeFileSync(path.join(dir, '999_broken.sql'), 'CREATE TABLE zz_half_done (id int PRIMARY KEY);\nSELECT no_such_function();\n');
    await expect(migrate(dir, () => {}, { beforeApply: async (p) => { called = p; } })).rejects.toThrow(/999_broken.sql failed and was rolled back/);
    expect(called).toEqual(['999_broken.sql']);
    expect(await rows("SELECT to_regclass('zz_half_done') AS t")).toEqual([{ t: null }]);
    expect(await rows("SELECT name FROM schema_migrations WHERE name = '999_broken.sql'")).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

const hasPgTools = (() => { try { execFileSync('pg_restore', ['--version']); return true; } catch { return false; } })();

describe.skipIf(!hasPgTools)('backups', () => {
  it('a backup restores into an empty database with every row of every shop', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bak-'));
    const prevDir = config.backups.dir;
    config.backups.dir = dir;
    const target = `restore_test_${process.pid}`;
    try {
      const { file } = await runBackup();
      await pool.query(`DROP DATABASE IF EXISTS ${target}`);
      await pool.query(`CREATE DATABASE ${target}`);
      const url = new URL(config.databaseUrl);
      url.pathname = `/${target}`;
      execFileSync('pg_restore', ['--no-owner', '--exit-on-error', '-d', url.toString(), path.join(dir, file)]);
      // Count with the backup policy on, in both databases, table by table.
      const counts = async (client: pg.Client) => {
        await client.query("SELECT set_config('app.backup_read', 'on', false)");
        const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.tablename as string);
        const out: Record<string, number> = {};
        for (const t of tables) out[t] = Number((await client.query(`SELECT count(*) FROM "${t}"`)).rows[0].count);
        return out;
      };
      const live = new pg.Client({ connectionString: config.databaseUrl });
      const restored = new pg.Client({ connectionString: url.toString() });
      await live.connect(); await restored.connect();
      try {
        const a = await counts(live);
        const b = await counts(restored);
        expect(Object.values(a).reduce((x, y) => x + y, 0)).toBeGreaterThan(500); // the demo data, not empty tables
        expect(b).toEqual(a);
      } finally { await live.end(); await restored.end(); }
    } finally {
      config.backups.dir = prevDir;
      await pool.query(`DROP DATABASE IF EXISTS ${target}`).catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
