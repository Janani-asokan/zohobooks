// Offers & loyalty in the browser: create a Diwali offer from the preset, switch on points, bill at the counter
// (offer applies by itself, customer found by mobile, points earned and used), take an offer off a bill, and an invoice
// that prints the offer, points and promo line. Usage: BASE=http://localhost:4000 node e2e/tools/offers.mjs <outDir>
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.';
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const H = { 'x-requested-with': 'ledgerly' };
const todayIN = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const api = async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
try {
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/app/);

  // 1. Offer from the Diwali preset
  await p.goto(B + '/app/sales/offers'); await p.waitForLoadState('networkidle');
  ok(await p.getByText('No offers yet').count() === 1, 'empty Offers page explains what offers do');
  await p.getByRole('button', { name: 'Diwali', exact: true }).click();
  ok((await p.locator('#offer-name').inputValue()) === 'Diwali offer', 'Diwali preset fills the name and message');
  await p.locator('#offer-value').fill('10');
  await p.screenshot({ path: `${out}/offer-form.png` });
  await p.getByRole('button', { name: 'Save offer' }).click(); await p.waitForTimeout(800);
  ok(await p.locator('td', { hasText: 'Diwali offer' }).count() === 1 && await p.getByText('Running').count() >= 1, 'offer listed as Running');
  await p.screenshot({ path: `${out}/offers-list.png` });

  // 2. Loyalty on
  await p.getByRole('button', { name: 'Loyalty points', exact: true }).click();
  await p.locator('.switch').first().click();
  await p.locator('#loy-earn').fill('2'); await p.locator('#loy-min').fill('20');
  await p.getByRole('button', { name: 'Save rules' }).click(); await p.waitForTimeout(600);
  ok((await api('GET', '/shop/loyalty/settings')).body.enabled === true, 'loyalty switched on from the page');
  const ps = (await api('GET', '/shop/print-settings')).body;
  await api('PUT', '/shop/print-settings', { ...ps, thermal: { ...ps.thermal, promo: 'Diwali sale: 10% off everything!' }, invoice: { ...ps.invoice, promo: 'Diwali sale till 5 Nov' } });

  // 3. Counter sale: offer applies, customer by mobile, points earned
  const cust = (await api('GET', '/shop/customers')).body.find((c) => c.phone.replace(/\D/g, '').length >= 10 && c.type === 'Individual') ?? (await api('GET', '/shop/customers')).body[0];
  const mobile = cust.phone.replace(/\D/g, '').slice(-10);
  await p.goto(B + '/app/pos'); await p.waitForSelector('.pos-tile');
  const tile = p.locator('.pos-tile').filter({ hasText: 'in stock' }).first();
  const tileName = (await tile.locator('.n').innerText()).trim();
  await tile.click(); await p.waitForTimeout(300);
  const cart = await p.locator('.pos-panel').nth(1).innerText();
  ok(/Diwali offer −10%/.test(cart), `offer tag on the cart line (${tileName})`);
  ok(await p.locator('[aria-label="Offers on this bill"]').count() === 1, 'offer summary with the saving shown above the total');
  await p.locator('[aria-label="Customer mobile number"]').fill(mobile); await p.waitForTimeout(400);
  ok((await p.locator('select[aria-label=Customer]').inputValue()) === cust.id, 'typing the mobile number picks the customer');
  ok(await p.locator('.points-box').count() === 1, 'points box shown for the customer');
  await p.screenshot({ path: `${out}/pos-offer.png` });
  await p.getByRole('button', { name: /^Charge/ }).first().click();
  await p.waitForSelector('text=Sale complete', { timeout: 15000 });
  const receipt = await p.locator('[role=dialog]').innerText();
  ok(/Diwali offer/.test(receipt) && /Happy Diwali/.test(receipt), 'receipt shows the offer and its message');
  ok(/Points: \+\d+/.test(receipt), 'receipt shows points earned and balance');
  ok(/Diwali sale: 10% off everything!/.test(receipt), 'receipt prints the promo line');
  await p.locator('[role=dialog] .receipt').screenshot({ path: `${out}/receipt-offer.png` });
  await p.getByRole('button', { name: /New sale/ }).click(); await p.waitForTimeout(300);

  // 4. Use points, and take the offer off
  await api('POST', `/shop/loyalty/customers/${cust.id}/adjust`, { points: 100, note: 'Test' });
  await tile.click(); await p.locator('[aria-label="Customer mobile number"]').fill(mobile); await p.waitForTimeout(600);
  await p.locator('[aria-label="Offers on this bill"] button[title="Take this offer off the bill"]').click();
  ok(/Put back/.test(await p.locator('[aria-label="Offers on this bill"]').innerText()), 'offer can be taken off one bill and put back');
  await p.locator('.points-box .switch').click(); await p.waitForTimeout(200);
  const used = Number(await p.locator('[aria-label="Points to use"]').inputValue());
  ok(used > 0, `points filled in to use: ${used}`);
  await p.getByRole('button', { name: /^Charge/ }).first().click();
  await p.waitForSelector('text=Sale complete', { timeout: 15000 });
  const r2 = await p.locator('[role=dialog]').innerText();
  ok(/Paid with \d+ points/.test(r2) && !/Diwali offer/.test(r2), 'second bill used points and has no offer');
  await p.getByRole('button', { name: /New sale/ }).click();

  // 5. New customer by mobile at the counter
  await tile.click();
  await p.locator('[aria-label="Customer mobile number"]').fill('9000012345'); await p.waitForTimeout(200);
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await p.locator('#quick-customer-name').fill('Kavya'); await p.getByRole('button', { name: 'Add customer' }).click(); await p.waitForTimeout(800);
  const sel = await p.locator('select[aria-label=Customer] option:checked').innerText();
  ok(/Kavya/.test(sel), 'new customer added from the counter and selected');

  // 6. Invoice with the offer, printed
  const inv = (await api('POST', '/shop/invoices', { customerId: cust.id, date: todayIN(), dueDate: todayIN(), lines: [{ itemId: (await api('GET', '/shop/items')).body.find((i) => i.name === tileName).id, qty: 2, tier: 'SP1', discount: 0 }], withGst: true, issue: true, overrideCreditLimit: true })).body;
  ok(inv.offersApplied?.[0]?.name === 'Diwali offer', 'invoice made in the app gets the offer');
  await p.goto(`${B}/invoices/${inv.id}/print?paper=a4`); await p.waitForSelector('.ti');
  const t = await p.locator('.ti').innerText();
  ok(/Diwali offer/.test(t) && /Happy Diwali/.test(t) && /Diwali sale till 5 Nov/.test(t) && /Loyalty points/.test(t), 'A4 invoice prints the offer, its message, the promo line and points');
  await p.locator('.ti').screenshot({ path: `${out}/invoice-offer.png` });

  // 7. Invoice form preview
  await p.goto(`${B}/app/sales/invoices/new?customer=${cust.id}&item=${inv.lines[0].itemId}`); await p.waitForLoadState('networkidle'); await p.waitForTimeout(800);
  ok(await p.locator('[aria-label="Offers on this bill"]').count() === 1, 'invoice form shows the offer before saving');
  await p.screenshot({ path: `${out}/invoice-form-offer.png`, fullPage: true });

  // 8. Customer panel shows points
  await p.goto(`${B}/app/sales/customers`); await p.waitForLoadState('networkidle');
  await p.locator('tr', { hasText: cust.companyName || cust.name }).first().click(); await p.waitForTimeout(600);
  ok(/Loyalty points/.test(await p.locator('.split-panel').innerText()), 'customer panel shows the points balance');
} catch (e) { console.log('ERROR', e.message.split('\n')[0]); process.exitCode = 1; }
console.log(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors');
await b.close();
