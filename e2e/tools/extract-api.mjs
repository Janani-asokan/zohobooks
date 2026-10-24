// Dev check: call the extraction API directly. Usage: node e2e/tools/extract-api.mjs <kind> <file> [base]
import fs from 'node:fs';
const [kind, file, B = 'http://localhost:5173'] = process.argv.slice(2);
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'ledgerly', Origin: B };
const login = await fetch(B + '/api/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ email: 'owner@shop.com', password: 'owner123' }) });
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const mime = file.endsWith('.pdf') ? 'application/pdf' : 'image/png';
const t = Date.now();
const r = await fetch(B + '/api/shop/extract', { method: 'POST', headers: { ...H, cookie }, body: JSON.stringify({ kind, file: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` }) });
const j = await r.json();
console.log(r.status, Date.now() - t, 'ms', j.method, JSON.stringify(j.data?.lines?.[0] ?? j).slice(0, 300));
