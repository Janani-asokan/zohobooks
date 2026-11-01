import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config';
import { pool } from '../db';

const run = promisify(execFile);

/** Full logical backup of every shop with pg_dump (custom format), keeping the newest N files. Restore: docs/DATABASE.md. */
export async function runBackup(): Promise<{ file: string; bytes: number }> {
  // Without the backup_read policy, row-level security would hide shop rows and pg_dump would write a backup that looks
  // fine but is nearly empty. Refuse instead.
  const unreadable = (await pool.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = 'backup_read')`)).rows.map((r) => r.relname);
  if (unreadable.length) throw new Error(`Backup refused: it would leave out rows of ${unreadable.join(', ')} (no backup_read policy). Apply the latest migrations first.`);
  fs.mkdirSync(config.backups.dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(config.backups.dir, `ledgerly-${stamp}.dump`);
  // Tables use forced row-level security; app.backup_read switches on the read-only backup policy for this session only.
  await run('pg_dump', ['--format=custom', '--no-owner', '--enable-row-security', `--file=${file}`, config.databaseUrl], {
    timeout: 10 * 60_000,
    env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS ?? ''} -c app.backup_read=on`.trim() },
  });
  const files = listBackups();
  for (const f of files.slice(config.backups.keep)) fs.rmSync(path.join(config.backups.dir, f.name), { force: true });
  return { file: path.basename(file), bytes: fs.statSync(file).size };
}

export function listBackups() {
  if (!fs.existsSync(config.backups.dir)) return [];
  return fs
    .readdirSync(config.backups.dir)
    .filter((f) => f.endsWith('.dump'))
    .map((name) => {
      const st = fs.statSync(path.join(config.backups.dir, name));
      return { name, bytes: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
