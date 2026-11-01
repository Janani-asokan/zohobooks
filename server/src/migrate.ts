import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { pool } from './db';

/** Works from the repo root, from server/, and from the bundled server/dist. */
function migrationsDir() {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const candidates = [path.resolve(process.cwd(), 'server/migrations'), path.resolve(process.cwd(), 'migrations')];
  const found = candidates.find((d) => fs.existsSync(d));
  if (!found) throw new Error('Migrations folder not found; set MIGRATIONS_DIR');
  return found;
}

const MIGRATION_LOCK = 4_173_901; // any constant; every server instance takes the same advisory lock
const checksum = (sql: string) => crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

interface MigrateOptions {
  /** Called once, before the first pending migration runs. Throwing stops the migration. */
  beforeApply?: (pending: string[]) => Promise<void>;
}

/**
 * Applies pending .sql migrations in filename order, each in its own transaction, so a failing file changes nothing.
 * Safety rules (see docs/DATABASE.md): files are only ever added, never edited, renamed or deleted once applied.
 * - An advisory lock makes a second server that starts at the same time wait instead of migrating twice.
 * - Each applied file's checksum is stored; an edited file is reported (and refused outside production, so it is
 *   caught in development and tests before it ships).
 */
export async function migrate(dir = migrationsDir(), log = console.log, opts: MigrateOptions = {}) {
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await lock.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    await lock.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
    const applied = new Map((await lock.query('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name as string, r.checksum as string | null]));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const sqlOf = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

    const edited: string[] = [];
    for (const f of files) {
      if (!applied.has(f)) continue;
      const sum = checksum(sqlOf(f));
      const stored = applied.get(f);
      if (stored == null) await lock.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [f, sum]); // applied before checksums existed
      else if (stored !== sum) edited.push(f);
    }
    const missing = [...applied.keys()].filter((n) => !files.includes(n));
    if (missing.length) log(`[migrate] WARNING: applied migrations missing from the folder: ${missing.join(', ')}. Migration files must never be deleted or renamed.`);
    if (edited.length) {
      const msg = `applied migrations were edited after they ran: ${edited.join(', ')}. Put the change in a new migration file instead.`;
      if (config.isProd) log(`[migrate] WARNING: ${msg}`);
      else throw new Error(`Migration safety: ${msg}`);
    }

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length && opts.beforeApply) await opts.beforeApply(pending);
    for (const f of pending) {
      const sql = sqlOf(f);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f, checksum(sql)]);
        await client.query('COMMIT');
        log(`[migrate] applied ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f} failed and was rolled back; nothing changed: ${(e as Error).message}`);
      } finally {
        client.release();
      }
    }
    return { applied: pending };
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    lock.release();
  }
}

if (/migrate\.(ts|js)$/.test(process.argv[1] ?? '')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
