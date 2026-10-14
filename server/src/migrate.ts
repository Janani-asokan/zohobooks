import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db';

/** Works from the repo root, from server/, and from the bundled server/dist. */
function migrationsDir() {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const candidates = [path.resolve(process.cwd(), 'server/migrations'), path.resolve(process.cwd(), 'migrations')];
  const found = candidates.find((d) => fs.existsSync(d));
  if (!found) throw new Error('Migrations folder not found; set MIGRATIONS_DIR');
  return found;
}

/** Applies pending .sql migrations in filename order, each in its own transaction. */
export async function migrate(dir = migrationsDir(), log = console.log) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      log(`[migrate] applied ${f}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
}

if (/migrate\.(ts|js)$/.test(process.argv[1] ?? '')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
