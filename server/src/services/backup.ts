import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config';

const run = promisify(execFile);

/** Full logical backup with pg_dump (custom format), keeping the newest N files. */
export async function runBackup(): Promise<{ file: string; bytes: number }> {
  fs.mkdirSync(config.backups.dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(config.backups.dir, `ledgerly-${stamp}.dump`);
  await run('pg_dump', ['--format=custom', '--no-owner', `--file=${file}`, config.databaseUrl], { timeout: 10 * 60_000 });
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
