// Dev helper: sign in as the demo owner and download an invoice PDF. Usage: node e2e/tools/pdf.mjs <invoiceId> <paper> <out.pdf>
import fs from 'node:fs';
const [id, paper = 'a4', out = 'invoice.pdf'] = process.argv.slice(2);
const B = process.env.BASE ?? 'http://localhost:5173';
const login = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ledgerly', Origin: B }, body: JSON.stringify({ email: process.env.EMAIL ?? 'owner@shop.com', password: process.env.PASS ?? 'owner123' }) });
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const t = Date.now();
const r = await fetch(`${B}/api/shop/invoices/${id}/pdf?paper=${paper}`, { headers: { cookie } });
if (!r.ok) { console.error(r.status, await r.text()); process.exit(1); }
fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
console.log(`${out} ${r.headers.get('content-disposition')} ${Date.now() - t}ms`);
