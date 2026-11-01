// Browser test of business templates, as a vegetable shop owner would use them: a new shop starts set up for its
// trade, the morning's rates go in on one screen, an item is added with its local name and found by that name at the
// counter; and an existing shop picks its business type from the profile. SHOTS=dir saves screenshots.
// Usage: BASE=http://localhost:4000 node e2e/tools/templates.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:5173';
const SHOTS = process.env.SHOTS;
const OWNER = `veg${Date.now()}@shop.com`;
const PASS = 'veg12345';
const b = await chromium.launch();
const errors = [];
let n = 0;
const step = async (name, fn) => {
  try { await fn(); n++; console.log('✓', name); } catch (e) { console.log('✗', name, '—', e.message.split('\n')[0]); errors.push(name); }
};
async function session(email, password, width = 1360) {
  const p = await (await b.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })).newPage();
  p.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  p.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && r.status() !== 401 && errors.push(`${r.status()} ${r.url().replace(B, '')}`));
  await p.goto(`${B}/login`); await p.fill('input[type=email]', email); await p.fill('input[type=password]', password); await p.keyboard.press('Enter');
  await p.waitForURL(/\/(app|super-admin)/);
  return p;
}
const go = async (p, path) => { await p.goto(B + path); await p.waitForLoadState('networkidle'); };
const shot = async (p, name) => { if (SHOTS) { await p.waitForTimeout(900); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const noSideScroll = async (p) => { if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('horizontal scroll'); };

const sa = await session('admin@ledgerly.in', 'admin123');
await step('the console creates a vegetable shop with its business type', async () => {
  await go(sa, '/super-admin');
  await sa.getByRole('button', { name: 'New Shop Owner' }).click();
  const m = sa.locator('.modal');
  await m.getByPlaceholder('e.g. Aravind Computer Store').fill('Kumar Vegetables');
  await sa.locator('#ns-type').selectOption('vegetables');
  await m.getByText('Sell by weight, change rates every morning').waitFor();
  const inputs = m.locator('input.input');
  await inputs.nth(2).fill('Kumar'); // owner name
  await m.getByPlaceholder('+91 98xxx xxxxx').fill('9876512345');
  await m.getByPlaceholder('owner@business.com').fill(OWNER);
  await m.locator('input[style*="monospace"]').fill('TempPass1');
  await shot(sa, '1-console-new-shop');
  await m.getByRole('button', { name: 'Create workspace' }).click();
  await sa.getByText(OWNER).first().waitFor();
});
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

await step('the new shop starts with counter billing, purchases and Today’s rates, and no unrelated menus', async () => {
  await go(o, '/app');
  await o.getByRole('button', { name: /^Inventory/ }).click();
  const nav = await o.locator('nav').first().innerText();
  if (!nav.includes('Today’s rates')) throw new Error('Today’s rates missing');
  if (!nav.includes('Purchases')) throw new Error('Purchases missing');
  if (nav.includes('Microfinance')) throw new Error('Microfinance shown');
  await o.getByRole('button', { name: /^Sales/ }).click();
  const sales = await o.locator('nav').first().innerText();
  if (!sales.includes('Point of Sale')) throw new Error('POS missing');
  if (sales.includes('Quotes')) throw new Error('Quotes shown to a vegetable shop');
});

await step('the morning’s rates go in on one screen, Enter moving down the list', async () => {
  await go(o, '/app/items/rates');
  await o.getByRole('cell', { name: /Tomato/ }).first().waitFor();
  await o.getByText('தக்காளி').first().waitFor();
  const first = o.getByLabel('Tomato today’s price');
  await first.fill('45');
  await first.press('Enter');
  await o.keyboard.type('38'); // focus moved to the next row
  await o.getByRole('button', { name: /Save 2 prices/ }).waitFor();
  await shot(o, '2-todays-rates');
  await o.getByRole('button', { name: /Save 2 prices/ }).click();
  await o.getByText('2 prices updated. New bills use them from now.').waitFor();
  const tomato = await o.evaluate(async () => (await (await fetch('/api/shop/items')).json()).find((i) => i.name === 'Tomato'));
  if (tomato.sp1 !== 45 || tomato.sp3 !== 45) throw new Error(`tomato price ${tomato.sp1}/${tomato.sp3}`);
});

await step('a new item starts in kg, with a field for its local name', async () => {
  await go(o, '/app/items/new');
  await o.locator('#item-name').fill('Drumstick');
  await o.locator('#extra-localName').fill('முருங்கைக்காய்');
  const unit = await o.getByLabel('Unit').or(o.locator('select').filter({ hasText: 'bunch' })).first().inputValue();
  if (unit !== 'kg') throw new Error(`default unit ${unit}`);
  await shot(o, '3-item-form');
  const r = await o.evaluate(async () => {
    const h = { 'content-type': 'application/json', 'x-requested-with': 'ledgerly' };
    const res = await fetch('/api/shop/items', { method: 'POST', headers: h, body: JSON.stringify({ type: 'Goods', name: 'Drumstick', unit: 'kg', hsn: '0709', cost: 50, sp1: 80, sp2: 80, sp3: 80, taxSlabId: 'tax_0', extra: { localName: 'முருங்கைக்காய்' } }) });
    return res.json();
  });
  if (r.extra?.localName !== 'முருங்கைக்காய்') throw new Error('local name not saved');
});

await step('at the counter, typing the Tamil name finds the item', async () => {
  await go(o, '/app/pos');
  await o.getByPlaceholder(/Search|Scan/i).first().fill('தக்காளி');
  await o.getByText('Tomato').first().waitFor();
  await shot(o, '4-pos-tamil-search');
});

const owner = await session('owner@shop.com', 'owner123');
await step('an existing shop picks its business type: preview first, nothing removed', async () => {
  const before = await owner.evaluate(async () => (await (await fetch('/api/shop/items')).json()).length);
  await go(owner, '/app/organization');
  await owner.locator('#business-type').getByRole('button', { name: /Choose business type|Change/ }).click();
  await owner.getByRole('radio', { name: /Mobile phones & accessories/ }).click();
  await owner.getByText('IMEI / serial number recorded on every phone sold').waitFor();
  await owner.getByText('Item fields added').waitFor();
  await shot(owner, '5-choose-business-type');
  await owner.getByRole('button', { name: 'Set up as Mobile phones & accessories' }).click();
  await owner.getByText(/^Done\./).waitFor();
  const after = await owner.evaluate(async () => (await (await fetch('/api/shop/items')).json()).length);
  if (after < before) throw new Error(`items went from ${before} to ${after}`);
  await go(owner, '/app/items/new');
  await owner.locator('#extra-warrantyMonths').waitFor();
});

const phone = await session(OWNER, PASS, 390);
await step('Today’s rates and the business type picker fit a phone', async () => {
  await go(phone, '/app/items/rates');
  await phone.getByText('Tomato').first().waitFor();
  await noSideScroll(phone);
  await go(phone, '/app/organization');
  await phone.locator('#business-type').getByRole('button', { name: /Change|Choose/ }).click();
  await phone.getByRole('radio').first().waitFor();
  await noSideScroll(phone);
  await shot(phone, '6-phone-picker');
});

console.log(errors.length ? `\n${n} passed, problems: ${errors.join(' | ')}` : `\nall ${n} template steps passed, no page errors`);
await b.close();
process.exit(errors.length ? 1 : 0);
