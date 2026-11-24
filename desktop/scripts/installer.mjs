// Builds dist/CorpusLite-Setup-<version>.exe with NSIS (uses electron-builder's downloaded makensis on Linux/macOS).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const root = process.env.NSIS_HOME || path.join(os.homedir(), '.cache', 'electron-builder', 'nsis', 'nsis-3.0.4.1');
const bin = process.platform === 'win32' ? path.join(root, 'makensis.exe') : path.join(root, process.platform === 'darwin' ? 'mac' : 'linux', 'makensis');
execFileSync(bin, [`-DVERSION=${pkg.version}`, 'installer.nsi'], { stdio: 'inherit', cwd: new URL('..', import.meta.url), env: { ...process.env, NSISDIR: root } });
