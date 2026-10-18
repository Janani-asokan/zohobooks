// Dev helper: create a draft invoice with many lines (for pagination checks). Prints its id.
const B = process.env.BASE ?? 'http://localhost:5173';
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'ledgerly', Origin: B };
const login = await fetch(B + '/api/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ email: 'owner@shop.com', password: 'owner123' }) });
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const get = (p) => fetch(B + '/api' + p, { headers: { cookie } }).then((r) => r.json());
const items = await get('/shop/items');
const customers = await get('/shop/customers');
const n = Number(process.argv[2] ?? 45);
const lines = Array.from({ length: n }, (_, i) => ({ itemId: items[i % items.length].id, qty: 1 + (i % 3), tier: 'SP1', discount: i % 4 === 0 ? 5 : 0 }));
const today = new Date().toISOString().slice(0, 10);
const r = await fetch(B + '/api/shop/invoices', { method: 'POST', headers: { ...H, cookie }, body: JSON.stringify({ customerId: customers.find((c) => c.state && c.state !== 'Tamil Nadu')?.id ?? customers[0].id, date: today, dueDate: today, lines, withGst: true, notes: 'Pagination check', shipTo: { name: 'Warehouse 2', address: '14 Industrial Estate\nGuindy, Chennai 600032', state: 'Tamil Nadu', gstin: '' }, issue: false }) });
const j = await r.json();
console.log(r.status, j.id ?? JSON.stringify(j));
