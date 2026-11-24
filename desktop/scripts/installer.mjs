// Builds dist/CorpusLite-Setup-<version>.exe with NSIS. Downloads NSIS once if it isn't there yet (no Wine needed:
// makensis runs natively on Linux, macOS and Windows).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const NSIS = 'nsis-3.0.4.1';
const root = process.env.NSIS_HOME || path.join(os.homedir(), '.cache', 'electron-builder', 'nsis', NSIS);
if (!fs.existsSync(path.join(root, 'Include'))) {
  fs.mkdirSync(root, { recursive: true });
  const archive = path.join(os.tmpdir(), `${NSIS}.7z`);
  const res = await fetch(`https://github.com/electron-userland/electron-builder-binaries/releases/download/${NSIS}/${NSIS}.7z`);
  if (!res.ok) throw new Error(`NSIS download failed: ${res.status}`);
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  const { path7za } = require('7zip-bin');
  fs.chmodSync(path7za, 0o755);
  execFileSync(path7za, ['x', '-y', `-o${root}`, archive], { stdio: 'ignore' });
}
const bin = process.platform === 'win32' ? path.join(root, 'makensis.exe') : path.join(root, process.platform === 'darwin' ? 'mac' : 'linux', 'makensis');
if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
execFileSync(bin, [`-DVERSION=${pkg.version}`, 'installer.nsi'], { stdio: 'inherit', cwd: new URL('..', import.meta.url), env: { ...process.env, NSISDIR: root } });
