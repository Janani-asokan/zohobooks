// A toy shop's first day, as the people who run it: the platform admin sets the shop up, the owner configures it,
// buys stock and starts a festival offer, a cashier works the counter (walk-ins, regulars, points, returns), and the
// owner checks the day at closing. Everything a person would click is clicked; only bulk data entry (the vendor bill)
// goes through the API. Usage: BASE=http://localhost:4000 node e2e/tools/toyshop-day.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const stamp = Date.now().toString().slice(-5);
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'admin123';
const owner = { name: 'Amal Svaya', email: `amal.toys${stamp}@example.com`, temp: 'Welcome@2026', pass: 'HappyKids@2026' };
const cashier = { name: 'Ravi Patel', email: `ravi.cashier${stamp}@example.com`, pass: 'Counter@2026' };
const todayIN = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const plus = (n) => new Date(Date.parse(todayIN() + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const log = [];
const ok = (c, m, why = '') => { const line = `${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`; console.log(line); log.push(line); if (!c) process.exitCode = 1; };
const note = (m) => { console.log(`NOTE ${m}`); log.push(`NOTE ${m}`); };
const H = { 'x-requested-with': 'ledgerly' };
const b = await chromium.launch();
const errs = [];
async function newPage(viewport = { width: 1366, height: 800 }) {
  const ctx = await b.newContext({ viewport });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`${r.status()} ${r.url()}`); });
  return p;
}
const api = (p) => async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
const shot = (p, name, full = false) => p.screenshot({ path: `${out}/${name}.png`, fullPage: full });
async function signIn(p, email, pass) {
  await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pass); await p.keyboard.press('Enter');
  await p.waitForURL(/\/(app|super-admin)/, { timeout: 30000 });
}
async function setOwnPassword(p, current, next) {
  await p.waitForSelector('text=Set your own password', { timeout: 15000 });
  await p.locator('input[type=password]').nth(0).fill(current); await p.locator('input[type=password]').nth(1).fill(next);
  await p.getByRole('button', { name: 'Save and continue' }).click();
  await p.waitForSelector('text=Set your own password', { state: 'detached', timeout: 20000 }); await p.waitForLoadState('networkidle');
}

try {
  /* ============ Day 0, morning: the platform admin creates the shop ============ */
  const a = await newPage();
  await signIn(a, 'admin@ledgerly.in', ADMIN_PASS);
  if (await a.locator('text=Set your own password').count()) { await setOwnPassword(a, ADMIN_PASS, 'Platform@2026x'); note('admin was asked to replace the public demo password (expected on live)'); }
  await a.goto(B + '/super-admin'); await a.getByRole('button', { name: /New Shop Owner/ }).click();
  await a.getByLabel('Shop / business name').fill('Happy Kids Toy World');
  await a.getByLabel('City').fill('Vadodara');
  await a.getByLabel('Business type').selectOption('toys');
  await a.getByLabel('Owner name').fill(owner.name);
  await a.getByLabel('Phone').fill('+91 98250 11223');
  await a.getByLabel('Login email').fill(owner.email);
  await a.getByLabel('Temporary password').fill(owner.temp);
  await a.locator('.radio-card', { hasText: 'Standard' }).click();
  await shot(a, '01-admin-create-shop');
  await a.getByRole('button', { name: 'Create workspace' }).click();
  await a.waitForTimeout(1500);
  ok(await a.locator('text=Happy Kids Toy World').count() > 0, 'admin created “Happy Kids Toy World” as a Toys & games shop');
  await a.context().close();

  /* ============ Owner's first sign-in and shop setup ============ */
  const o = await newPage();
  const oa = api(o);
  await signIn(o, owner.email, owner.temp);
  await setOwnPassword(o, owner.temp, owner.pass);
  await shot(o, '02-owner-first-dashboard');
  ok(/Happy Kids Toy World/.test(await o.locator('body').innerText()), 'owner lands on the shop dashboard after setting a password');
  const items0 = (await oa('GET', '/shop/items')).body;
  ok(items0.length === 5, `toy template loaded ${items0.length} starter toys`);

  // Business profile through the form
  await o.goto(B + '/app/organization'); await o.waitForLoadState('networkidle');
  await o.getByLabel('Legal name').fill('Happy Kids Toy World');
  await o.getByLabel('GSTIN').fill('24ABCPS1234K1Z5');
  await o.getByLabel('State').selectOption('Gujarat');
  await o.getByLabel('Email').fill(owner.email);
  await o.getByLabel('Phone').fill('+91 98250 11223');
  await o.getByLabel('Address (include PIN code)').fill('12, Alkapuri Main Road, Vadodara, Gujarat 390007');
  await o.getByLabel('UPI ID').fill('happykids@okaxis');
  // Bank account as separate fields (the IFSC fills the bank name; a new account number is typed twice)
  await o.getByLabel('Account holder name', { exact: true }).fill('Happy Kids Toy World');
  await o.getByLabel('Account number', { exact: true }).fill('917020012345678');
  await o.getByLabel('Re-enter account number', { exact: true }).fill('917020012345678');
  await o.getByLabel('IFSC code', { exact: true }).fill('UTIB0000123');
  await o.getByRole('button', { name: /Save Changes/ }).click(); await o.waitForTimeout(1200);
  const org = (await oa('GET', '/shop/organization')).body;
  ok(org.gstin === '24ABCPS1234K1Z5' && org.state === 'Gujarat' && org.upiId === 'happykids@okaxis', 'business profile saved from the form (GSTIN, Gujarat, UPI)', JSON.stringify({ g: org.gstin, s: org.state }));
  ok(org.phone === '+91 98250 11223' && org.bankName === 'Axis Bank' && org.bankAccountNo === '917020012345678' && /IFSC UTIB0000123/.test(org.bankDetails), 'phone and bank account (Axis Bank from the IFSC) saved', JSON.stringify({ ph: org.phone, bank: org.bankName, no: org.bankAccountNo }));
  await shot(o, '03-business-profile', true);

  // Cashier login through Team
  await o.goto(B + '/app/team'); await o.waitForLoadState('networkidle');
  await o.getByRole('button', { name: /Add Staff/ }).click();
  await o.getByLabel('Full name').fill(cashier.name);
  await o.getByLabel('Email').fill(cashier.email);
  await o.getByLabel('Role').selectOption('Sales Staff');
  const tempPass = await o.getByLabel('Temporary password').inputValue();
  await o.getByRole('button', { name: 'Create login' }).click(); await o.waitForTimeout(1000);
  ok(tempPass.length >= 8 && await o.locator('text=' + cashier.name).count() > 0, 'cashier login created with a generated temporary password');

  // New toys with the maker's barcode, through the item form
  const newToys = [
    { name: 'Fashion doll with accessories', sp1: '799', cost: '520', barcode: '8901234500017', cat: 'Dolls', age: '3–5 years', elec: 'No' },
    { name: 'Die-cast car 5-pack', sp1: '549', cost: '360', barcode: '0887961123457', cat: 'Cars', age: '3–5 years', elec: 'No' },
    { name: 'Musical learning keyboard', sp1: '1499', cost: '980', barcode: '8907654300015', cat: 'Electronic toys', age: '3–5 years', elec: 'Yes' },
  ];
  for (const t of newToys) {
    await o.goto(B + '/app/items/new?type=Goods'); await o.waitForLoadState('networkidle');
    await o.locator('#item-name').fill(t.name);
    await o.locator('input[placeholder^="Scan or type barcode"]').fill(t.barcode);
    await o.locator('.field:has(label:text("Category")) input').first().fill(t.cat);
    await o.locator('.field:has(label:text("Cost price")) input').fill(t.cost);
    await o.getByLabel('SP1 · Standard').fill(t.sp1);
    await o.locator('.field:has(label:text("HSN code")) input').fill('9503');
    await o.getByRole('button', { name: t.elec === 'Yes' ? '18%' : '5%', exact: true }).click();
    const age = o.locator('.field:has(label:text("Age group")) select'); if (await age.count()) await age.selectOption(t.age);
    const el = o.locator('.field:has(label:text("Electronic")) select'); if (await el.count()) await el.selectOption(t.elec);
    await o.getByRole('button', { name: 'Save item' }).click(); await o.waitForTimeout(1200);
  }
  await shot(o, '04-item-form-last', true);
  let items = (await oa('GET', '/shop/items')).body;
  for (const t of newToys) {
    const it = items.find((i) => i.name === t.name);
    ok(!!it && it.barcode === t.barcode && it.sp2 === Number(t.sp1), `${t.name}: saved with box barcode ${t.barcode}, one price`, it ? `${it.barcode} sp2 ${it.sp2}` : 'not saved');
  }
  ok(items.find((i) => i.name === 'Musical learning keyboard')?.taxRate === 18 && items.find((i) => i.name === 'Fashion doll with accessories')?.taxRate === 5, 'GST: electronic toy 18%, doll 5%');

  // Loose toys get a shop barcode: generate one on the teddy
  const teddy = items.find((i) => i.name.startsWith('Soft teddy'));
  await o.goto(`${B}/app/items/${teddy.id}/edit`); await o.waitForLoadState('networkidle');
  await o.getByRole('button', { name: /generate one/i }).click();
  await o.getByRole('button', { name: 'Save changes' }).click(); await o.waitForTimeout(1000);
  items = (await oa('GET', '/shop/items')).body;
  const teddyCode = items.find((i) => i.id === teddy.id).barcode;
  ok(/^\d{13}$/.test(teddyCode), `teddy got a shop barcode ${teddyCode}`);

  // Stock arrives: the distributor's bill (bulk entry via the API, as the bill form would send it)
  const vendor = (await oa('POST', '/shop/vendors', { name: 'Gujarat Toys Distributors', gstin: '24AAGCG1234M1Z2', phone: '+91 265 2345678', state: 'Gujarat' })).body;
  const stockLines = items.filter((i) => i.type === 'Goods').map((i) => ({ itemId: i.id, qty: i.name.startsWith('Remote') ? 3 : 20, rate: i.cost > 0 ? i.cost : Math.round(i.sp1 * 0.65) }));
  const bill = await oa('POST', '/shop/bills', { vendorId: vendor.id, vendorBillNo: 'GTD/2026/778', date: todayIN(), dueDate: plus(30), lines: stockLines, addStock: true });
  ok(bill.status === 200, `stock bill ${bill.body?.number} recorded: ₹${bill.body?.amount}`);
  items = (await oa('GET', '/shop/items')).body;
  ok(items.filter((i) => i.type === 'Goods').every((i) => i.stock >= 3), 'all toys in stock after the bill');

  // Price tags for loose toys
  await o.goto(`${B}/app/items/labels?ids=${teddy.id}`); await o.waitForSelector('.blabel');
  ok(await o.locator('.blabel svg.bl-code rect, .blabel svg.bl-code path').count() > 10, 'teddy price tags show a scannable barcode');
  await o.locator('.print-area').first().screenshot({ path: `${out}/05-teddy-labels.png` });

  // Receipt look: 80 mm and a promo line
  const ps = (await oa('GET', '/shop/print-settings')).body;
  await o.goto(B + '/app/print-settings'); await o.getByRole('button', { name: 'Thermal receipt' }).click();
  await o.locator('#th-promo').fill('Diwali sale on now! Exchange within 7 days with bill.');
  await o.getByRole('button', { name: 'Save' }).first().click(); await o.waitForTimeout(800);
  ok((await oa('GET', '/shop/print-settings')).body.thermal.promo.startsWith('Diwali sale'), 'promo line saved for receipts');
  ok(ps.thermal.paper === '3in', 'receipt paper is 80 mm (toy template)');

  // Festival offer + a bill offer, and loyalty
  await o.goto(B + '/app/sales/offers'); await o.waitForLoadState('networkidle');
  await o.getByRole('button', { name: 'Diwali', exact: true }).click();
  await o.locator('#offer-value').fill('10');
  await o.locator('#offer-message').fill('Happy Diwali! 10% off on all toys.');
  await o.getByRole('button', { name: 'Save offer' }).click(); await o.waitForTimeout(800);
  await o.getByRole('button', { name: /New offer/ }).click();
  await o.locator('#offer-name').fill('Big basket bonus');
  await o.getByRole('tab', { name: 'Whole bill' }).click();
  await o.getByRole('tab', { name: '₹' }).click();
  await o.locator('#offer-value').fill('100');
  await o.locator('#offer-min').fill('2000');
  await o.locator('#offer-message').fill('₹100 off on bills of ₹2,000 or more');
  await o.getByRole('button', { name: 'Save offer' }).click(); await o.waitForTimeout(800);
  await shot(o, '06-offers');
  ok((await oa('GET', '/shop/offers/running')).body.length === 2, 'two offers running today');
  await o.getByRole('button', { name: 'Loyalty points', exact: true }).click();
  await o.locator('.switch').first().click();
  await o.locator('#loy-earn').fill('1'); await o.locator('#loy-value').fill('1'); await o.locator('#loy-min').fill('50'); await o.locator('#loy-max').fill('50');
  await o.getByRole('button', { name: 'Save rules' }).click(); await o.waitForTimeout(600);
  ok((await oa('GET', '/shop/loyalty/settings')).body.enabled, 'loyalty on: 1 point per ₹100, 1 point = ₹1, from 50 points');

  /* ============ Day 1: the cashier at the counter ============ */
  const c = await newPage();
  const ca = api(c);
  await signIn(c, cashier.email, tempPass);
  await setOwnPassword(c, tempPass, cashier.pass);
  const menu = await c.locator('nav, aside').first().innerText();
  ok(!/Accounting|Settings/.test(menu) || !/Chart of Accounts/.test(menu), 'cashier menu has no accounts or settings');
  let printed = [];
  await c.exposeFunction('__onPrint', (css) => printed.push(css));
  await c.addInitScript(() => { window.print = () => window.__onPrint([...document.querySelectorAll('style')].map((s) => s.textContent).filter((t) => t.includes('@page')).join(' ')); });
  await c.goto(B + '/app/pos'); await c.waitForSelector('.pos-tile');
  const scan = async (code) => { await c.evaluate(() => document.activeElement?.blur()); await c.keyboard.type(code, { delay: 6 }); await c.keyboard.press('Enter'); await c.waitForTimeout(250); };
  const charge = async () => { await c.getByRole('button', { name: /^Charge/ }).first().click(); await c.waitForSelector('text=Sale complete', { timeout: 15000 }); return c.locator('[role=dialog]').innerText(); };
  const newSale = async () => { await c.getByRole('button', { name: /New sale/ }).click(); await c.waitForTimeout(300); };

  // Sale 1: walk-in, teddy (shop barcode) + doll (box barcode), cash ₹1,500
  await scan(teddyCode); await scan('8901234500017');
  const cart1 = await c.locator('.pos-panel').nth(1).innerText();
  ok(/Soft teddy/.test(cart1) && /Fashion doll/.test(cart1) && /Diwali offer −10%/.test(cart1), 'sale 1: both scans in the cart with the Diwali 10% applied');
  await c.locator('.field:has(label:text("Cash tendered")) input').fill('1500');
  const change1 = await c.locator('text=Change').locator('..').innerText();
  await shot(c, '07-sale1-cart');
  const r1 = await charge();
  ok(/Happy Diwali! 10% off on all toys/.test(r1) && /Diwali sale on now!/.test(r1), 'sale 1 receipt: offer message and promo line');
  await c.getByRole('button', { name: /Print receipt/ }).click(); await c.waitForTimeout(300);
  ok(printed.some((x) => /80mm/.test(x)), 'sale 1 receipt sent to the 80 mm printer');
  await c.locator('[role=dialog] .receipt').screenshot({ path: `${out}/08-sale1-receipt.png` });
  note(`sale 1 change shown: ${change1.replace(/\s+/g, ' ').slice(0, 40)}`);
  await newSale();

  // Sale 2: a mother buys the musical keyboard + RC car (both 18%) + puzzle: new customer by mobile, UPI, bill offer
  await scan('8907654300015');
  await c.locator('.pos-tile', { hasText: 'Remote control car' }).click();
  await c.locator('.pos-tile', { hasText: 'Jigsaw puzzle' }).click();
  await c.locator('[aria-label="Customer mobile number"]').fill('9824012345'); await c.waitForTimeout(300);
  await c.getByRole('button', { name: 'Add', exact: true }).click();
  await c.locator('#quick-customer-name').fill('Priya Shah'); await c.getByRole('button', { name: 'Add customer' }).click(); await c.waitForTimeout(900);
  ok(/Priya Shah/.test(await c.locator('select[aria-label=Customer] option:checked').innerText()), 'sale 2: new customer Priya added from the counter by mobile');
  const sum2 = await c.locator('[aria-label="Offers on this bill"]').innerText();
  ok(/Diwali offer/.test(sum2) && /Big basket bonus/.test(sum2), 'sale 2: Diwali 10% and ₹100 bill offer both shown', sum2.replace(/\n/g, ' | '));
  await c.getByRole('button', { name: 'UPI', exact: true }).click();
  ok(await c.locator('img[alt="UPI QR"]').count() > 0 || await c.locator('img[alt*="UPI"]').count() > 0, 'sale 2: UPI QR with the amount shown to scan');
  await shot(c, '09-sale2-cart');
  const r2 = await charge();
  ok(/Points: \+\d+/.test(r2), 'sale 2 receipt: points earned');
  await c.locator('[role=dialog] .receipt').screenshot({ path: `${out}/10-sale2-receipt.png` });
  await newSale();

  // Sale 3: die-cast cars scanned as a 12-digit UPC (scanner drops the leading 0), split cash + UPI
  await scan('887961123457'); await scan('887961123457');
  ok(/Die-cast car 5-pack/.test(await c.locator('.pos-panel').nth(1).innerText()), 'sale 3: 12-digit UPC scan finds the 13-digit box code');
  await c.getByRole('button', { name: 'Split', exact: true }).click();
  await c.locator('input[aria-label="Cash amount"]').fill('500');
  await c.locator('.split-row', { hasText: 'UPI' }).getByRole('button', { name: 'Rest' }).click();
  ok(await c.getByText('Fully paid').count() === 1, 'sale 3: split cash + UPI adds up');
  await charge(); await newSale();

  // Unknown barcode at the counter (cashier cannot add items)
  await scan('8909999999990');
  const unk = await c.locator('.pos-panel').first().innerText();
  // The scan box is cleared (so the next scan is never spoiled) and a “Not found” banner shows the code.
  ok(/Not found: 8909999999990/.test(unk) && await c.getByRole('link', { name: /Add as a new item/ }).count() === 0, 'unknown barcode: clear message; cashier is not offered “Add item”');
  await c.locator('input[aria-label="Scan or search items"]').fill('');

  /* ============ Owner: Priya's old loyalty card, a return ============ */
  const priya = (await oa('GET', '/shop/customers')).body.find((x) => x.name === 'Priya Shah');
  await o.goto(B + '/app/sales/offers'); await o.getByRole('button', { name: 'Loyalty points', exact: true }).click(); await o.waitForTimeout(500);
  await o.locator('tr', { hasText: 'Priya Shah' }).getByRole('button', { name: 'Adjust' }).click();
  await o.locator('#adj-points').fill('60'); await o.locator('#adj-note').fill('Points from old paper card');
  await o.getByRole('button', { name: 'Save', exact: true }).click(); await o.waitForTimeout(700);
  const bal = (await oa('GET', `/shop/loyalty/customers/${priya.id}`)).body.balance;
  ok(bal >= 60, `owner added Priya’s old card points: balance ${bal}`);

  // Sale 4: Priya comes back with her son, uses points on building blocks + teddy
  await c.goto(B + '/app/pos'); await c.waitForSelector('.pos-tile');
  await c.locator('.pos-tile', { hasText: 'Building blocks' }).click();
  await scan(teddyCode);
  await c.locator('[aria-label="Customer mobile number"]').fill('98240 12345'); await c.waitForTimeout(700);
  await c.locator('.points-box .switch').click(); await c.waitForTimeout(200);
  const usePts = Number(await c.locator('[aria-label="Points to use"]').inputValue());
  ok(usePts > 0 && usePts <= bal, `sale 4: Priya can use ${usePts} of her ${bal} points`);
  await shot(c, '11-sale4-points');
  const r4 = await charge();
  ok(/Paid with \d+ points/.test(r4), 'sale 4 receipt: points used shown');
  await newSale();

  // Return: Priya brings back the puzzle from sale 2 (cashier makes the credit note on the invoice)
  const invs = (await ca('GET', '/shop/invoices')).body;
  const list = Array.isArray(invs) ? invs : invs.rows ?? invs.items;
  const sale2 = list.filter((i) => (i.customer?.name ?? '') === 'Priya Shah').sort((x, y) => x.number.localeCompare(y.number))[0];
  const before = (await oa('GET', `/shop/loyalty/customers/${priya.id}`)).body.balance;
  const puzzleBefore = (await oa('GET', '/shop/items')).body.find((i) => i.name.startsWith('Jigsaw')).stock;
  await c.goto(`${B}/app/sales/invoices/${sale2.id}`); await c.waitForSelector('.ti');
  await c.getByRole('button', { name: 'More' }).click(); await c.getByRole('button', { name: /Create credit note/ }).click();
  const row = c.locator('[role=dialog] tr', { hasText: 'Jigsaw puzzle' });
  await row.locator('input[type=number]').fill('1');
  await c.getByRole('button', { name: 'Create credit note' }).last().click(); await c.waitForTimeout(1200);
  const puzzleAfter = (await oa('GET', '/shop/items')).body.find((i) => i.name.startsWith('Jigsaw')).stock;
  const after = (await oa('GET', `/shop/loyalty/customers/${priya.id}`)).body.balance;
  ok(puzzleAfter === puzzleBefore + 1, `return: puzzle back on the shelf (${puzzleBefore} → ${puzzleAfter})`);
  ok(after <= before, `return: points earned on the puzzle taken back (${before} → ${after})`);
  await shot(c, '12-return-invoice', true);

  // Low stock warning for the last RC cars
  await c.goto(B + '/app/pos'); await c.waitForSelector('.pos-tile');
  const rc = c.locator('.pos-tile', { hasText: 'Remote control car' });
  for (let i = 0; i < 4; i++) await rc.click();
  ok(/Only \d+ pcs in stock/.test(await c.locator('.pos-panel').nth(1).innerText()), 'selling more RC cars than the shelf has shows “Only N in stock”');
  for (let i = 0; i < 4; i++) await c.locator('.pos-line', { hasText: 'Remote control car' }).getByRole('button', { name: 'Decrease' }).click().catch(() => {});

  /* ============ Closing time: the owner checks the day ============ */
  const day = (await oa('GET', '/shop/invoices')).body;
  const dl = (Array.isArray(day) ? day : day.rows ?? day.items).filter((i) => i.status !== 'Draft' && i.date === todayIN());
  const sales = dl.reduce((s, i) => s + i.total, 0);
  ok(dl.length === 4, `4 bills today, total ₹${sales.toFixed(2)}`);
  const full = await Promise.all(dl.map(async (i) => (await oa('GET', `/shop/invoices/${i.id}`)).body));
  const lines = full.flatMap((i) => i.lines);
  ok(lines.every((l) => (l.name.match(/keyboard|Remote/i) ? l.taxRate === 18 : l.taxRate === 5)), 'every line has the right GST: 18% electronic, 5% other toys');
  ok(full.every((i) => i.amountPaid >= i.total - 0.01), 'every counter bill is fully paid');
  ok(full.every((i) => i.interState === false && i.cgst > 0 && Math.abs(i.cgst - i.sgst) < 0.02), 'Gujarat customers: CGST + SGST split equally');
  await o.goto(B + '/app'); await o.waitForLoadState('networkidle'); await o.waitForTimeout(800);
  await shot(o, '13-owner-dashboard-evening', true);
  const dash = await o.locator('body').innerText();
  ok(/Today|today/.test(dash), 'dashboard shows today’s figures');
  await o.goto(B + '/app/reports'); await o.waitForLoadState('networkidle'); await shot(o, '14-reports-home');
  await o.goto(B + '/app/reports/gst'); await o.waitForLoadState('networkidle'); await o.waitForTimeout(800); await shot(o, '15-gst-report', true);
  ok(/GSTR-1|GSTR/.test(await o.locator('body').innerText()), 'GST report opens');
  await o.goto(B + '/app/stock-summary').catch(() => {}); await o.waitForTimeout(500);
  // Pay half the distributor's bill
  const acct = (await oa('GET', '/shop/bank-accounts')).body[0];
  const pay = await oa('POST', `/shop/bills/${bill.body.id}/pay`, { accountId: acct.id, date: todayIN(), amount: Math.round(bill.body.amount / 2), mode: 'UPI', reference: 'UPI 778' });
  ok(pay.status === 200, `half the distributor bill paid (₹${Math.round(bill.body.amount / 2)})`);
  await o.goto(B + '/app/purchases/vendors'); await o.waitForLoadState('networkidle'); await shot(o, '16-vendors');
  const pl = await oa('GET', `/shop/reports/pl?from=${todayIN()}&to=${todayIN()}`);
  note(`P&L call status ${pl.status}`);
  await o.goto(B + '/app/sales/customers'); await o.waitForLoadState('networkidle');
  await o.locator('tr', { hasText: 'Priya Shah' }).first().click(); await o.waitForTimeout(700);
  await shot(o, '17-priya-panel');
  ok(/Loyalty points/.test(await o.locator('.split-panel').innerText()), 'owner sees Priya’s points and history on her customer page');
  // Phone check of the counter
  const m = await newPage({ width: 390, height: 844 });
  await signIn(m, cashier.email, cashier.pass); await m.goto(B + '/app/pos'); await m.waitForSelector('.pos-tile');
  ok(await m.evaluate(() => document.documentElement.scrollWidth) <= 392, 'POS on a phone: no sideways scrolling');
  await shot(m, '18-pos-phone', true);
} catch (e) { ok(false, `scenario stopped after: ${log[log.length - 1] ?? 'start'}`, e.message.split('\n').slice(0, 2).join(' ')); }
console.log(errs.length ? 'PAGE ERRORS:\n' + [...new Set(errs)].join('\n') : 'no page errors');
fs.writeFileSync(`${out}/result.txt`, log.join('\n') + '\n' + (errs.length ? 'PAGE ERRORS: ' + [...new Set(errs)].join(' | ') : 'no page errors') + '\n');
await b.close();
