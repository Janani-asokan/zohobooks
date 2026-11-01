// Browser test of AI credits: the owner sees this month's credits and asks for more, the platform owner adds them in
// the console, and the owner's balance goes up. SHOTS=dir saves screenshots.
// Usage: BASE=http://localhost:4000 node e2e/tools/aicredits.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:5173';
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
  p.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && r.status() !== 401 && errors.push(`${r.status()} ${r.url().replace(B, '')}`));
  await p.goto(`${B}/login`); await p.fill('input[type=email]', email); await p.fill('input[type=password]', password); await p.keyboard.press('Enter');
  await p.waitForURL(/\/(app|super-admin)/);
  await p.evaluate(async () => { const me = await (await fetch('/api/auth/me')).json(); if (me.shop) localStorage.setItem(`ledgerly.gs.${me.shop.id}`, '1'); });
  return p;
}
const go = async (p, path) => { await p.goto(B + path); await p.waitForLoadState('networkidle'); };
const shot = async (p, name) => { if (SHOTS) { await p.waitForTimeout(900); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

const o = await session('owner@shop.com', 'owner123');
let leftBefore = 0;
await step('the owner sees this month’s AI credits', async () => {
  await go(o, '/app/features');
  const card = o.locator('#ai-credits');
  await card.getByText('AI credits this month').waitFor();
  leftBefore = Number((await card.locator('strong').first().innerText()).replace(/\D/g, ''));
  if (!(leftBefore > 0)) throw new Error(`no credits shown (${leftBefore})`);
  await card.scrollIntoViewIfNeeded();
  await shot(o, '1-owner-credits');
});

await step('the owner asks for more credits', async () => {
  const card = o.locator('#ai-credits');
  if (await card.getByRole('button', { name: 'Withdraw request' }).count()) await card.getByRole('button', { name: 'Withdraw request' }).click();
  await card.getByRole('button', { name: /Ask for .* more/ }).click();
  await o.getByText('Request sent. We will call you to add the credits.').waitFor();
  await card.getByRole('button', { name: 'Withdraw request' }).waitFor();
});

const sa = await session('admin@ledgerly.in', 'admin123');
await step('the console shows the request and every shop’s use, and adds the credits', async () => {
  await go(sa, '/super-admin/features');
  const row = sa.locator('tr', { hasText: 'Aravind Computer Store' }).filter({ has: sa.getByRole('button', { name: 'Decline' }) }).first();
  await row.waitFor();
  await row.scrollIntoViewIfNeeded();
  await shot(sa, '2-console-ai');
  await row.getByRole('button', { name: 'Add credits' }).click();
  await sa.locator('#grant-note').fill('UTR 5512003');
  await sa.locator('.modal').getByRole('button', { name: 'Add credits' }).click();
  await sa.getByText('Credits added for Aravind Computer Store').waitFor();
});

await step('the owner’s balance went up', async () => {
  await go(o, '/app/features');
  const card = o.locator('#ai-credits');
  await card.getByText(/extra credits added this month/).waitFor();
  const left = Number((await card.locator('strong').first().innerText()).replace(/\D/g, ''));
  if (!(left > leftBefore)) throw new Error(`credits did not go up: ${leftBefore} → ${left}`);
});

await step('the assistant shows the credits left', async () => {
  await go(o, '/app');
  const btn = o.getByRole('button', { name: /Ask AI/ }).first();
  if (!(await btn.count())) { console.log('  (AI is not set up on this server, so the assistant is hidden; skipped)'); return; }
  await btn.click();
  await o.getByText(/AI credits left this month/).waitFor();
});

console.log(errors.length ? `\n${n} passed, problems: ${errors.join(' | ')}` : `\nall ${n} AI credit steps passed, no page errors`);
await b.close();
process.exit(errors.length ? 1 : 0);
