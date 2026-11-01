// Browser test of pay-per-feature: a shop without add-ons sees a clear locked screen, asks for a feature from the
// Features page, the platform owner approves it in the console, and the feature then works for the shop.
// It creates its own shop with no add-ons through the console API, so it can run again and again. SHOTS=dir saves screenshots.
// Usage: BASE=http://localhost:4000 node e2e/tools/addons.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:5173';
const OWNER = `veg${Date.now()}@shop.com`;
const PASS = 'veg12345';
const SHOTS = process.env.SHOTS;
const b = await chromium.launch();
const errors = [];
let n = 0;
const step = async (name, fn) => {
  try { await fn(); n++; console.log('✓', name); } catch (e) { console.log('✗', name, '—', e.message.split('\n')[0]); errors.push(name); }
};
async function session(email, password, width = 1360) {
  const p = await (await b.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })).newPage();
  p.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  await p.goto(`${B}/login`); await p.fill('input[type=email]', email); await p.fill('input[type=password]', password); await p.keyboard.press('Enter');
  await p.waitForURL(/\/(app|super-admin)/);
  await p.evaluate(async () => { const me = await (await fetch('/api/auth/me')).json(); if (me.shop) localStorage.setItem(`ledgerly.gs.${me.shop.id}`, '1'); });
  return p;
}
const go = async (p, path) => { await p.goto(B + path); await p.waitForLoadState('networkidle'); };
const shot = async (p, name) => { if (SHOTS) { await p.waitForTimeout(900); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

const sa = await session('admin@ledgerly.in', 'admin123');
const made = await sa.evaluate(async (email) => {
  const r = await fetch('/api/platform/shops', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'ledgerly' },
    body: JSON.stringify({ shopName: 'Kumar Vegetables', ownerName: 'Kumar', email, phone: '9876512345', city: 'Salem', planId: 'standard', years: 1, password: 'TempPass1', features: [] }) });
  return r.status;
}, OWNER);
if (made !== 201) throw new Error(`could not create the test shop: ${made}`);
{ // first sign-in asks for a new password
  const ctx = await b.newContext(); const p = await ctx.newPage();
  await p.goto(`${B}/login`);
  await p.evaluate(async ([email, pass]) => {
    const h = { 'content-type': 'application/json', 'x-requested-with': 'ledgerly' };
    await fetch('/api/auth/login', { method: 'POST', headers: h, body: JSON.stringify({ email, password: 'TempPass1' }) });
    await fetch('/api/auth/change-password', { method: 'POST', headers: h, body: JSON.stringify({ current: 'TempPass1', next: pass }) });
  }, [OWNER, PASS]);
  await ctx.close();
}
const o = await session(OWNER, PASS);

await step('without add-ons the sidebar shows only core billing', async () => {
  await go(o, '/app');
  const nav = await o.locator('nav').first().innerText();
  for (const gone of ['Purchases', 'Point of Sale', 'Microfinance', 'Quotes']) if (nav.includes(gone)) throw new Error(`${gone} still in the sidebar`);
  for (const kept of ['Dashboard', 'Sales', 'Inventory', 'Reports']) if (!nav.includes(kept)) throw new Error(`${kept} missing`);
  await o.getByRole('button', { name: /^Sales/ }).click();
  const sales = await o.locator('nav').first().innerText();
  for (const kept of ['Invoices', 'Customers', 'Credit Notes']) if (!sales.includes(kept)) throw new Error(`${kept} missing under Sales`);
  for (const gone of ['Quotes', 'Recurring', 'Point of Sale', 'My Day']) if (sales.includes(gone)) throw new Error(`${gone} still under Sales`);
  await shot(o, '1-core-only-dashboard');
});

await step('a locked page explains the feature instead of failing', async () => {
  await go(o, '/app/purchases/bills');
  await o.getByRole('heading', { name: 'Purchases & expenses isn’t turned on' }).waitFor();
  await o.getByText('Bills that add stock').waitFor();
  await shot(o, '2-locked-page');
});

await step('the owner asks for it from the Features page', async () => {
  await o.getByRole('link', { name: 'See price and turn on' }).click();
  await o.waitForURL(/\/app\/features\?f=purchases/);
  const card = o.locator('#feature-purchases');
  await card.getByText('Off').waitFor();
  await shot(o, '3-features-page');
  await card.getByRole('button', { name: 'Ask to turn on' }).click();
  await o.getByRole('button', { name: 'Send request' }).click();
  await o.getByText('Request sent. We will call you to confirm and turn it on.').waitFor().catch(async (e) => { await shot(o, 'x-after-request'); throw e; });
  await card.getByText('Withdraw request').waitFor();
});

await step('the platform owner sees the request and approves it', async () => {
  await go(sa, '/super-admin/features');
  const row = sa.locator('tr', { hasText: 'Purchases & expenses' }).filter({ hasText: OWNER }).first();
  await row.waitFor();
  await shot(sa, '4-console-requests');
  await row.getByRole('button', { name: 'Approve' }).click();
  await sa.getByRole('button', { name: '1 year' }).click();
  await sa.locator('#act-note').fill('UTR 4471928');
  await sa.locator('.modal').getByRole('button', { name: 'Turn on' }).click();
  await sa.getByText(/Purchases & expenses turned on for/).waitFor();
});

await step('the feature now works for the shop, with its menu', async () => {
  await go(o, '/app/purchases/bills');
  await o.getByRole('heading', { name: 'Bills', exact: true }).first().waitFor();
  const nav = await o.locator('nav').first().innerText();
  if (!nav.includes('Purchases')) throw new Error('Purchases not in the sidebar');
  await go(o, '/app/features?f=purchases');
  await o.locator('#feature-purchases').getByText(/^On till/).waitFor();
});

await step('prices can be changed in the console', async () => {
  await go(sa, '/super-admin/features');
  await sa.locator('#price-pos-standard').fill('249');
  await sa.getByRole('button', { name: /Save 1 change/ }).click();
  await sa.getByText('Prices saved. Shops see them straight away.').waitFor();
  await shot(sa, '5-console-prices');
  await go(o, '/app/features?f=pos');
  await o.locator('#feature-pos').getByText('₹249.00').waitFor();
  await sa.locator('#price-pos-standard').fill('199'); // put the demo price back
  await sa.getByRole('button', { name: /Save 1 change/ }).click();
});

const m = await session(OWNER, PASS, 390);
await step('the Features page works on a phone', async () => {
  await go(m, '/app/features');
  const wide = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) throw new Error('horizontal scroll at 390px');
  await shot(m, '6-features-phone');
});

console.log(errors.length ? `\n${n} passed, problems: ${errors.join(' | ')}` : `\nall ${n} add-on steps passed, no page errors`);
await b.close();
process.exit(errors.length ? 1 : 0);
