// Browser test of the money-lending module: register and approve a borrower, give a loan through the confirm step,
// collect (with confirm and receipt), close the loan, and check a collector's view. Run on freshly seeded demo data.
// Usage: BASE=http://localhost:4000 node e2e/tools/lending.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch();
const errors = [];
let n = 0;
const step = async (name, fn) => {
  try { await fn(); n++; console.log('✓', name); } catch (e) {
    console.log('✗', name, '—', e.message.split('\n')[0]); errors.push(name);
    if (process.env.SHOTS) await (globalThis.cur ?? p).screenshot({ path: `${process.env.SHOTS}/fail-${n}-${errors.length}.png` }).catch(() => {});
  }
};
async function session(email, password, width = 1360) {
  const p = await (await b.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })).newPage();
  p.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  await go(p, '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', password); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  await p.evaluate(async () => { const me = await (await fetch('/api/auth/me')).json(); localStorage.setItem(`ledgerly.gs.${me.shop.id}`, '1'); });
  return p;
}
const mobile = `9${String(Date.now()).slice(-9)}`;
const go = async (pg, path) => { await pg.goto(B + path); await pg.waitForLoadState('networkidle'); };
const p = await session('owner@shop.com', 'owner123');
let loanUrl = '';

await step('lending appears in the sidebar and opens the overview', async () => {
  await p.getByRole('link', { name: 'Lending overview' }).click().catch(async () => { await p.getByRole('button', { name: /^Lending/ }).click(); await p.getByRole('link', { name: 'Lending overview' }).click(); });
  await p.getByRole('heading', { name: 'Money lending' }).waitFor();
  await p.getByText('Collected today').waitFor();
});

await step('register a borrower with Aadhaar; a duplicate mobile is caught', async () => {
  await go(p, '/app/lending/borrowers');
  await p.getByRole('button', { name: 'New borrower' }).click();
  await p.fill('#nb-name', 'Ramesh Kannan'); await p.fill('#nb-father', 'Kannan'); await p.fill('#nb-mobile', mobile);
  await p.fill('#nb-addr', '7, Temple Street, Salem'); await p.selectOption('#nb-area', 'SLM'); await p.fill('#nb-guar', 'Kumar (brother)');
  await p.fill('#nb-aadhaar', '5678 1234 9012'); await p.check('#nb-consent');
  await p.getByRole('button', { name: 'Register' }).click();
  await p.waitForURL(/\/app\/lending\/borrowers\/[0-9a-f-]{36}$/);
  await p.getByText('XXXX XXXX 9012').waitFor();
  await go(p, '/app/lending/borrowers?new=1');
  await p.fill('#nb-name', 'Someone Else'); await p.fill('#nb-mobile', mobile); await p.fill('#nb-addr', '9, Mill Road, Erode'); await p.selectOption('#nb-area', 'ERD');
  await p.getByRole('button', { name: 'Register' }).click();
  await p.getByText('Already registered: Ramesh Kannan').waitFor();
  await p.keyboard.press('Escape');
});

await step('approve the borrower', async () => {
  await go(p, '/app/lending/borrowers');
  await p.locator('.search-input input, input[placeholder^="Search name"]').first().fill('Ramesh');
  await p.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await p.getByText('Marked verified').waitFor();
});

await step('give a daily loan: live quote, rounded cash, confirm', async () => {
  await go(p, '/app/lending/loans/new');
  await p.fill('#ln-search', 'Ramesh'); await p.getByRole('button', { name: /Ramesh Kannan/ }).click();
  await p.fill('#ln-amt', '50000');
  await p.getByText('₹46,433.33').first().waitFor(); // 50,000 − 2.14% × 100/30 months
  await p.fill('#ln-cash', '46430'); await p.fill('#ln-ack', 'Slip 2201'); await p.fill('#ln-late', '50');
  await p.getByText('rounded from ₹46,433.33').waitFor();
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('heading', { name: /Hand over ₹46,430.00 to Ramesh Kannan/ }).waitFor();
  await p.getByRole('button', { name: 'Confirm loan' }).click();
  await p.waitForURL(/\/app\/lending\/loans\/[0-9a-f-]{36}$/);
  loanUrl = p.url();
  await p.getByText('₹500.00 × 100').first().waitFor();
});

await step('collect by UPI with confirm and receipt; balance drops', async () => {
  await p.getByRole('button', { name: 'Collect', exact: true }).click();
  await p.fill('#lend-amount', '1500');
  await p.getByRole('tab', { name: 'UPI' }).click();
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByText('Enter the UPI transaction ID').first().waitFor(); // UPI needs a reference
  await p.fill('#lend-ref', 'UPI4471928');
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByText('Balance after').waitFor();
  await p.getByRole('button', { name: 'Confirm and save' }).click();
  await p.getByText('PAYMENT RECEIPT').waitFor();
  await p.getByRole('button', { name: 'Done' }).click();
  await p.getByText('₹48,500.00').first().waitFor();
});

await step('close the loan with typed confirmation', async () => {
  const number = (await p.locator('h1').first().innerText()).match(/LN-\d+/)[0];
  await p.getByRole('button', { name: 'Close loan' }).click();
  await p.fill('#cl-reason', 'Settled in full early');
  await p.fill('#cl-confirm', number);
  await p.locator('.modal').getByRole('button', { name: 'Close loan' }).click();
  await p.getByText('PAYMENT RECEIPT').waitFor();
  await p.getByRole('button', { name: 'Done' }).click();
  await p.locator('h1').getByText('Closed').waitFor();
});

await step('loan income shows in Profit & Loss and the books balance', async () => {
  const tb = await p.evaluate(async () => (await (await fetch('/api/shop/accounting/trial-balance')).json()));
  const d = tb.rows.reduce((s, r) => s + r.debit, 0), c = tb.rows.reduce((s, r) => s + r.credit, 0);
  if (Math.abs(d - c) > 0.01) throw new Error(`trial balance off by ${d - c}`);
  await go(p, '/app/reports/profit-loss');
  await p.getByText('Interest income (lending)').waitFor();
});

await step('reports and export open', async () => {
  await go(p, '/app/lending/reports');
  await p.getByText('Daily collection ·').waitFor();
  await p.getByRole('button', { name: 'Defaulters' }).click();
  await p.getByText('Defaulters and overdue loans').waitFor();
});

const c = await session('collector@shop.com', 'collector123', 390);
await step('collector lands on lending, sees only their loans and collects from the list', async () => {
  await c.waitForURL(/\/app\/lending$/);
  await c.getByText('Your collection round').waitFor();
  const collect = c.getByRole('button', { name: 'Collect' }).first();
  if (!(await collect.count())) { await c.getByRole('button', { name: /Arrears/ }).click(); }
  await c.getByRole('button', { name: 'Collect' }).first().click();
  await c.getByRole('button', { name: 'Continue' }).click();
  await c.getByRole('button', { name: 'Confirm and save' }).click();
  await c.getByText('PAYMENT RECEIPT').waitFor();
});
await step('collector cannot open the borrower register', async () => {
  await go(c, '/app/lending/borrowers');
  await c.getByText('This page isn’t part of your role').waitFor();
});

console.log(errors.length ? `\n${n} passed, problems: ${errors.join(' | ')}` : `\nall ${n} lending steps passed, no page errors`);
await b.close();
process.exit(errors.length ? 1 : 0);
