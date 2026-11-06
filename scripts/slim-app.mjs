// CorpusLite: after `vite build --mode app`, drop what the phone app never uses, to keep the install small:
// the website's photos and screenshots (except the one welcome photo), the service worker and web manifest, and the
// older .woff fonts (phones read .woff2). Usage: node scripts/slim-app.mjs dist-app
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(process.argv[2] ?? 'dist-app');
const gone = [];
const rm = (p) => { if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); gone.push(path.relative(dir, p)); } };
rm(path.join(dir, 'screens'));
for (const f of fs.readdirSync(path.join(dir, 'img'))) if (f !== 'hero.webp') rm(path.join(dir, 'img', f));
for (const f of ['sw.js', 'manifest.webmanifest', 'icon-512-maskable.png']) rm(path.join(dir, f));
for (const f of fs.readdirSync(path.join(dir, 'assets'))) if (f.endsWith('.woff')) rm(path.join(dir, 'assets', f));
const size = (p) => fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((s, f) => s + size(path.join(p, f)), 0) : fs.statSync(p).size;
console.log(`slim-app: removed ${gone.length} files; app web files now ${(size(dir) / 1048576).toFixed(2)} MB`);
