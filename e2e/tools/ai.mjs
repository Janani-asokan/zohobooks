// Dev check for the AI features (needs ANTHROPIC_API_KEY on the server): photo of a sales order → form,
// the "Ask AI" assistant, and "Fill with AI" on a new item. Usage: BASE=http://localhost:4000 node e2e/tools/ai.mjs [outDir]
import { chromium } from 'playwright';
import os from 'node:os';
const out = process.argv[2];
const B = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && errs.push(`${r.status()} ${r.url()}`));
const results = [];
const step = async (name, fn) => {
  await p.keyboard.press('Escape').catch(() => {});
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}: ${e.message.split('\n')[0]}`); if (out) await p.screenshot({ path: `${out}/ai-fail-${results.length}.png` }).catch(() => {}); }
};

// A small screenshot of a sales order, like a phone or WhatsApp image of a customer's document.
const img = `${os.tmpdir()}/ai-sales-order.png`;
{
  const q = await b.newPage({ viewport: { width: 760, height: 520 } });
  await q.setContent(`<body style="font-family:Arial;font-size:9px;margin:16px;color:#333">
  <div style="text-align:center;font-size:16px;color:#2a6">Unico Plastics Inc</div>
  <div style="text-align:center;font-size:7px">101, Industrial Avenue, Fort, Mumbai · Cell: +91 2174896787 Email: info@unicoplastics.com</div>
  <div style="text-align:right;font-size:12px;font-weight:bold;margin-top:14px">SALES ORDER</div><div style="text-align:right">SAL-ORD-2026-00003</div><hr>
  <table style="width:100%;font-size:8px"><tr><td><b>Customer Name</b></td><td>Mia Jones</td><td><b>Date</b></td><td>19-06-2026</td></tr>
  <tr><td></td><td></td><td><b>Delivery Date</b></td><td>21-06-2026</td></tr></table>
  <table border=1 style="border-collapse:collapse;width:100%;font-size:8px;margin-top:10px"><tr style="background:#eee"><th>Sr</th><th>Item Code</th><th>Description</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr>
  <tr><td>1</td><td>LW-TAN</td><td>Leather Wallet Tan</td><td>12 Nos</td><td>₹ 250.00</td><td>₹ 3,000.00</td></tr></table>
  <div style="text-align:right;margin-top:8px"><b>Grand Total</b> ₹ 3,000.00</div></body>`);
  await q.screenshot({ path: img });
  await q.close();
}

await p.goto(B + '/login');
await p.fill('input[type=email]', 'owner@shop.com');
await p.fill('input[type=password]', 'owner123');
await p.keyboard.press('Enter');
await p.waitForURL(/\/app/);

await step('sales order filled from a photo (AI reader)', async () => {
  await p.goto(B + '/app/sales/orders?new=1');
  const m = p.locator('.modal').last();
  await m.waitFor();
  await m.locator('.smart-upload input[type=file]').first().setInputFiles(img);
  await p.waitForSelector('text=Check what we read', { timeout: 90000 });
  const review = p.locator('.modal').last();
  const body = await review.innerText();
  if (!/Leather Wallet/i.test(body)) throw new Error('item row not read: ' + body.slice(0, 300).replace(/\n/g, ' | '));
  if (/couldn.t find form details/i.test(body)) throw new Error('reader found nothing');
  await p.getByRole('button', { name: 'Fill the form' }).click();
  await p.waitForTimeout(600);
  const form = p.locator('.modal').last();
  const vals = await form.locator('input').evaluateAll((els) => els.map((e) => e.value).join(' | '));
  if (!/Leather Wallet/i.test(vals)) throw new Error('line not filled: ' + vals.slice(0, 300));
  if (out) await p.screenshot({ path: `${out}/ai-sales-order.png` });
});

await step('Ask AI answers from shop data', async () => {
  await p.goto(B + '/app');
  await p.getByRole('button', { name: 'Ask AI' }).click();
  await p.locator('.ai-chip').first().click();
  await p.locator('.ai-msg.assistant:not(.ai-typing)').first().waitFor({ timeout: 90000 });
  const a = await p.locator('.ai-msg.assistant').first().innerText();
  if (!/₹/.test(a)) throw new Error('answer has no amounts: ' + a.slice(0, 200));
  await p.locator('.ai-input textarea').fill('Which customer owes the most?');
  await p.keyboard.press('Enter');
  await p.locator('.ai-msg.assistant:not(.ai-typing)').nth(1).waitFor({ timeout: 90000 });
  if (out) await p.screenshot({ path: `${out}/ai-assistant.png` });
  await p.getByRole('button', { name: 'Close' }).click();
});

await step('Fill with AI on a new item', async () => {
  await p.goto(B + '/app/items/new');
  await p.locator('#item-name').fill('Prestige Popular Aluminium Pressure Cooker 5 Litre');
  await p.getByRole('button', { name: /Fill with AI/ }).click();
  await p.locator('.toast', { hasText: 'Filled' }).first().waitFor({ timeout: 60000 });
  const hsn = await p.locator('input[placeholder="e.g. 8471"]').inputValue();
  if (!/^\d{4,8}$/.test(hsn)) throw new Error('HSN not filled: ' + hsn);
  if (out) await p.screenshot({ path: `${out}/ai-item.png` });
});

console.log(results.join('\n'));
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
