// Dev helper: send every API route malformed input (bad ids, bad dates, wrong types, empty and huge bodies) and
// report any 5xx. A 5xx means the server crashed instead of explaining the problem.
// Usage: BASE=http://localhost:4000 node e2e/tools/fuzz.mjs routes.json   (routes.json = [[METHOD, path], ...])
import fs from 'node:fs';
const B = process.env.BASE ?? 'http://localhost:4000';
const routes = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const SKIP = /logout|backup|restore|\/ai\/|extract|upload/;

async function login(email, password) {
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'ledgerly' }, body: JSON.stringify({ email, password }) });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const shop = await login('owner@shop.com', 'owner123');
const sup = await login('admin@ledgerly.in', 'admin123');

const IDS = ['not-a-uuid', '00000000-0000-4000-8000-000000000000', '1%27%20OR%201=1', '%00'];
const QUERY = '?from=garbage&to=2026-13-45&limit=-5&page=abc&period=xx&fy=zz&date=bad&asOf=bad&q=%27%22%3C&kind=nope&status=nope&account=nope&leadDays=-1&coverDays=abc&paper=zzz&roll=9in';
const HUGE = 'x'.repeat(200_000);
const BODIES = [
  {}, [], 'null', { name: 123, qty: 'abc', lines: 'x', date: 'bad', amount: -1, items: {}, email: 5, customerId: 'nope', id: {} },
  { name: HUGE, notes: HUGE }, { lines: [{ itemId: 'nope', qty: -3, rate: 'x' }], customerId: '00000000-0000-4000-8000-000000000000' },
  { date: '2026-02-30', dueDate: '0000-00-00', amount: 1e308, qty: NaN }, { __proto__: { admin: true }, constructor: { prototype: { x: 1 } } },
];

const fails = [];
let n = 0;
for (const [method, path] of routes) {
  if (SKIP.test(path)) continue;
  const cookie = path.startsWith('/api/platform') ? sup : shop;
  const paths = path.includes(':') ? IDS.map((id) => path.replace(/:[a-zA-Z]+/g, id)) : [path];
  for (const p of paths) {
    const variants = method === 'GET' || method === 'DELETE' ? [[p, undefined], [p + QUERY, undefined]] : BODIES.map((bd) => [p, typeof bd === 'string' ? bd : JSON.stringify(bd)]);
    for (const [url, body] of variants) {
      n++;
      try {
        const r = await fetch(B + url, { method, headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'ledgerly' }, body });
        if (r.status >= 500) fails.push(`${r.status} ${method} ${url.slice(0, 120)} ${body ? body.slice(0, 80) : ''} → ${(await r.text()).slice(0, 160)}`);
      } catch (e) { fails.push(`ERR ${method} ${url} ${e.message}`); }
    }
  }
}
console.log(`${n} requests, ${fails.length} server errors`);
console.log([...new Set(fails)].join('\n'));
