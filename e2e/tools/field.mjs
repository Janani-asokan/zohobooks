// Dev check for field staff tracking: a salesperson's day on a phone (with simulated GPS), then the owner's team map.
// Usage: BASE=http://localhost:4000 node e2e/tools/field.mjs [outDir]
import { chromium } from 'playwright';
const out = process.argv[2];
const B = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch();
const errs = [];
const results = [];
const watch = (p) => {
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && errs.push(`${r.status()} ${r.url()}`));
};
const step = async (p, name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}: ${e.message.split('\n')[0]}`); if (out) await p.screenshot({ path: `${out}/field-fail-${results.length}.png` }).catch(() => {}); }
};
const login = async (p, email, pw) => {
  await p.goto(B + '/login');
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', pw);
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/app/);
};

// Salesperson on a phone in Chennai.
const phone = await b.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 13.0418, longitude: 80.2341, accuracy: 12 }, permissions: ['geolocation'] });
const s = await phone.newPage();
watch(s);
await login(s, 'sales@shop.com', 'sales123');
await s.goto(B + '/app/field');

await step(s, 'salesperson starts the day', async () => {
  await s.getByRole('button', { name: 'Start day' }).click();
  await s.getByText('On duty', { exact: true }).waitFor();
});
await step(s, 'checks in at a customer, takes an order, checks out', async () => {
  await s.getByRole('button', { name: /Check in at a customer/ }).click();
  await s.locator('.modal select[aria-label=Customer]').selectOption({ index: 1 });
  await s.getByRole('button', { name: 'Payment collection' }).click();
  await s.getByRole('button', { name: 'Check in here' }).click();
  await s.locator('.field-open').waitFor();
  await phone.setGeolocation({ latitude: 13.0418, longitude: 80.2341 });
  await s.getByRole('button', { name: 'Check out' }).click();
  await s.getByRole('button', { name: 'Order taken', exact: true }).click();
  await s.getByLabel('Order value (₹)').fill('18500');
  await s.getByLabel('Payment collected (₹)').fill('5000');
  await s.getByLabel('Notes').fill('Wants Diwali gift packs next week');
  await s.getByRole('button', { name: 'Save visit' }).click();
  await s.locator('.field-list li').first().waitFor();
});
await step(s, 'moves across town and visits a new shop', async () => {
  await phone.setGeolocation({ latitude: 13.085, longitude: 80.2101, accuracy: 15 });
  await s.getByRole('button', { name: /Check in at a customer/ }).click();
  await s.getByPlaceholder(/Sri Murugan Stores/).fill('Lakshmi Electricals, Anna Nagar');
  await s.getByRole('button', { name: 'Check in here' }).click();
  await s.locator('.field-open').waitFor();
  await s.getByRole('button', { name: 'Check out' }).click();
  await s.getByRole('button', { name: 'Follow up', exact: true }).click();
  await s.getByRole('button', { name: 'Save visit' }).click();
  await s.locator('.field-list li').nth(1).waitFor();
  if (out) await s.screenshot({ path: `${out}/field-myday.png`, fullPage: true });
});

// Owner on a laptop.
const desk = await b.newContext({ viewport: { width: 1440, height: 1100 } });
const o = await desk.newPage();
watch(o);
await login(o, 'owner@shop.com', 'owner123');
await step(o, 'owner sees the salesperson on the team map', async () => {
  await o.goto(B + '/app/field/team');
  await o.locator('.ft-person').first().waitFor();
  const t = await o.locator('.ft-person').first().innerText();
  if (!/2 visits/.test(t) || !/18,500/.test(t) || / 0 km/.test(t)) throw new Error('team card: ' + t.replace(/\n/g, ' | '));
  if ((await o.locator('.fv-pin').count()) < 2) throw new Error('visit pins missing on the map');
  if (out) await o.screenshot({ path: `${out}/field-team.png`, fullPage: true });
});
await step(o, 'AI summary of the day', async () => {
  const btn = o.getByRole('button', { name: /Summarise the day/ });
  if (!(await btn.count())) return; // AI off on this server
  await btn.click();
  await o.locator('.ai-headline').waitFor({ timeout: 90000 });
  if (out) await o.screenshot({ path: `${out}/field-ai.png`, fullPage: true });
});
await step(s, 'salesperson ends the day; tracking stops', async () => {
  await s.getByRole('button', { name: 'End day' }).click();
  await s.getByText('Day ended', { exact: true }).waitFor();
  const r = await s.evaluate(async () => (await fetch('/api/shop/field/ping', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'ledgerly' }, body: JSON.stringify({ lat: 13, lng: 80 }) })).json());
  if (r.onDuty !== false) throw new Error('still tracking after the day ended');
});

console.log(results.join('\n'));
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
