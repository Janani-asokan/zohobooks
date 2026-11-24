// The speech model for voice billing in the Windows app (Vosk, Indian English, ~36 MB): downloaded once, repacked as
// the .tar.gz that the in-page recogniser loads, and shipped inside the installer, so voice works with no internet.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NAME = 'vosk-model-small-en-in-0.4';
const out = new URL('../build/voice/en-in.tar.gz', import.meta.url);
if (fs.existsSync(out)) { console.log('voice model: already there'); process.exit(0); }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vosk-'));
const zip = path.join(work, `${NAME}.zip`);
// A ready copy on this project's voice-model branch first (fast, and works where alphacephei.com is blocked).
const ready = await fetch('https://raw.githubusercontent.com/Janani-asokan/zohobooks/voice-model/en-in.tar.gz').catch(() => null);
if (ready?.ok) {
  fs.mkdirSync(new URL('../build/voice/', import.meta.url), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await ready.arrayBuffer()));
  console.log('voice model: from the voice-model branch,', fs.statSync(out).size, 'bytes');
  process.exit(0);
}
const res = await fetch(`https://alphacephei.com/vosk/models/${NAME}.zip`);
if (!res.ok) throw new Error(`voice model download failed: ${res.status}`);
fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
const { path7za } = require('7zip-bin');
fs.chmodSync(path7za, 0o755);
const run = (args) => execFileSync(path7za, args, { cwd: work, stdio: 'ignore' });
run(['x', '-y', zip]);
// vosk-browser wants a tar.gz whose top folder holds the model (am/, conf/, graph/, ivector/).
fs.renameSync(path.join(work, NAME), path.join(work, 'model'));
run(['a', '-ttar', 'model.tar', 'model']);
run(['a', '-tgzip', 'model.tar.gz', 'model.tar']);
fs.mkdirSync(new URL('../build/voice/', import.meta.url), { recursive: true });
fs.copyFileSync(path.join(work, 'model.tar.gz'), out);
console.log('voice model:', fs.statSync(out).size, 'bytes');
