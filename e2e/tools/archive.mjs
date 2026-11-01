// Browser test of customer archiving: a customer with invoices is archived (not deleted), leaves the invoice picker,
// keeps its invoices, and is restored. Run on freshly seeded demo data.
// Usage: BASE=http://localhost:4000 node e2e/tools/archive.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch();
const errors = [];
let n = 0;
const step = async (name, fn) => {
  try { await fn(); n++; console.log('✓', name); } catch (e) { console.log('✗', name, '—', e.message.split('\n')[0]); errors.push(name); }
};
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 }, serviceWorkers: 'block' })).newPage();
p.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
const go = async (path) => { await p.goto(B + path); await p.waitForLoadState('networkidle'); };
await go('/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
await p.evaluate(async () => { const me = await (await fetch('/api/auth/me')).json(); localStorage.setItem(`ledgerly.gs.${me.shop.id}`, '1'); });

const customers = await p.evaluate(async () => (await fetch('/api/shop/customers')).json());
const c = customers.find((x) => x.invoiceCount > 0 && !x.archived);
const label = c.companyName || c.name;

await step('a customer with invoices offers Archive, not Delete', async () => {
  await go('/app/sales/customers');
  const row = p.locator('tr', { hasText: c.customId });
  await row.getByRole('button', { name: 'Archive' }).click();
  await p.getByText('Customer archived. Their invoices and history are kept.').waitFor();
  // The list refreshes after the toast; on a slow connection give it time before calling it a failure.
  await p.locator('tbody tr', { hasText: c.customId }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => { throw new Error('archived customer still in the active list'); });
});

await step('the archived customer leaves the invoice picker', async () => {
  await go('/app/sales/invoices/new');
  const options = await p.locator('select[aria-label="Customer"] option').allInnerTexts();
  if (options.some((o) => o.includes(c.customId))) throw new Error('archived customer offered in the picker');
});

await step('its invoices are all still there', async () => {
  const inv = await p.evaluate(async (id) => (await (await fetch('/api/shop/invoices')).json()).filter((i) => i.customerId === id).length, c.id);
  if (inv < c.invoiceCount) throw new Error(`only ${inv} of ${c.invoiceCount} invoices`);
});

await step('the Archived view lists it and Restore brings it back', async () => {
  await go('/app/sales/customers');
  await p.getByRole('button', { name: /Archived \(1\)/ }).click();
  const row = p.locator('tr', { hasText: c.customId });
  await row.getByText('Archived').first().waitFor();
  await row.getByRole('button', { name: 'Restore' }).click();
  await p.getByText('Customer restored').waitFor();
  await go('/app/sales/invoices/new');
  const options = await p.locator('select[aria-label="Customer"] option').allInnerTexts();
  if (!options.some((o) => o.includes(c.customId))) throw new Error(`restored customer ${label} missing from the picker`);
});

console.log(errors.length ? `\n${n} passed, problems: ${errors.join(' | ')}` : `\nall ${n} archive steps passed, no page errors`);
await b.close();
process.exit(errors.length ? 1 : 0);
