// Onboarding a toy shop's stock, the five things the client asked for: inventory entry, inventory management,
// billing, barcode generation, and scanning + printing. Done through the screens a shop owner and cashier use.
// Usage: BASE=http://localhost:4000 node e2e/tools/inventory-onboarding.mjs <outDir>   (server with DEMO_SUPER_ADMIN=1)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
const stamp = Date.now().toString().slice(-5);
const todayIN = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const log = [];
const ok = (c, m, why = '') => { const l = `${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`; console.log(l); log.push(l); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const b = await chromium.launch();
const errs = [];
const page = async (vp = { width: 1366, height: 800 }) => {
  const p = await (await b.newContext({ viewport: vp })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`${r.status()} ${r.url()}`); });
  return p;
};
const apiOf = (p) => async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
const signIn = async (p, email, pass) => { await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pass); await p.keyboard.press('Enter'); await p.waitForURL(/\/(app|super-admin)/); };
const printCapture = async (p) => { const got = []; await p.exposeFunction('__onPrint', (c) => got.push(c)); await p.addInitScript(() => { window.print = () => window.__onPrint([...document.querySelectorAll('style')].map((s) => s.textContent).filter((t) => t.includes('@page')).join(' ')); }); return got; };

try {
  // Shop created by the platform admin (the create screen itself is covered by toyshop-day.mjs)
  const a = await page(); await signIn(a, 'admin@ledgerly.in', 'admin123');
  const email = `owner.toys${stamp}@example.com`;
  const cr = await apiOf(a)('POST', '/platform/shops', { shopName: 'Little Stars Toys', ownerName: 'Meera', email, phone: '+91 98790 12345', city: 'Ahmedabad', planId: 'standard', years: 1, password: 'Welcome@2026', businessType: 'toys' });
  ok(cr.status === 201, 'admin created “Little Stars Toys” (Toys & games)');
  await a.context().close();
  const o = await page(); const oa = apiOf(o);
  const printed = await printCapture(o);
  await signIn(o, email, 'Welcome@2026');
  await o.locator('input[type=password]').nth(0).fill('Welcome@2026'); await o.locator('input[type=password]').nth(1).fill('LittleStars@2026');
  await o.getByRole('button', { name: 'Save and continue' }).click(); await o.waitForSelector('text=Set your own password', { state: 'detached' });
  const org = (await oa('GET', '/shop/organization')).body;
  await oa('PUT', '/shop/organization', { ...org, gstin: '24AAKFL1234M1Z8', state: 'Gujarat', address: 'C.G. Road, Ahmedabad 380009', upiId: 'littlestars@okicici' });

  /* 1. Inventory entry: the supplier's list imported from the Items page */
  const csv = [
    'Name,Barcode,Category,Brand,Cost,MRP,SP1,Stock',
    'Pull-back racing car,8901234500048,Cars,Speedy,140,249,229,12',
    'Baby rattle set,8901234500055,Baby toys,Tiny Hands,90,199,,15',
    'Water colour paint box,8901234500062,Art & craft,ColorKid,60,120,110,20',
    'Wooden puzzle tray,8901234500079,Puzzles,WoodPlay,150,299,279,8',
    'Doctor play set,8901234500086,Pretend play,Tiny Hands,260,499,459,6',
    'Remote helicopter,8901234500093,Electronic toys,SkyFun,900,1799,1599,4',
    'Loose bouncy ball,,Outdoor,,12,,30,10',
    'Loose spinning top,,Classic toys,,18,,40,8',
    'Loose plastic whistle,,Party,,5,,15,6',
    'Loose finger puppet,,Soft toys,,25,,60,12',
  ].join('\r\n') + '\r\n';
  const csvPath = path.join(out, 'supplier-list.csv'); fs.writeFileSync(csvPath, csv);
  await o.goto(B + '/app/items'); await o.waitForLoadState('networkidle');
  await o.getByRole('button', { name: /^Import$/ }).click();
  await o.locator('input[type=file][accept*=csv]').setInputFiles(csvPath);
  await o.getByRole('button', { name: 'Import', exact: true }).last().click(); await o.waitForTimeout(1500);
  const resText = await o.locator('[role=dialog]').innerText();
  await o.screenshot({ path: `${out}/01-import-result.png` });
  ok(/10/.test(resText) && !/error/i.test(resText.replace(/0 errors?/i, '')), 'supplier list imported from the Items page: 10 toys', resText.replace(/\n/g, ' | ').slice(0, 160));
  await o.getByRole('button', { name: 'Done' }).click();
  // (the starter template toys are there too)
  let items = (await oa('GET', '/shop/items')).body;
  const heli = items.find((i) => i.name === 'Remote helicopter');
  ok(items.filter((i) => i.name.match(/Pull-back|rattle|Water colour|Wooden puzzle|Doctor|helicopter|Loose/)).every((i) => i.taxRate === 5), 'no GST column in the file: every toy got 5%, the usual rate for toys');
  ok(items.find((i) => i.name === 'Baby rattle set')?.sp1 === 199 && items.find((i) => i.name === 'Baby rattle set')?.mrp === 199, 'MRP-only row priced at MRP');
  ok(items.find((i) => i.name === 'Pull-back racing car')?.category === 'Cars' && items.find((i) => i.name === 'Pull-back racing car')?.brand === 'Speedy', 'category and brand kept');
  // The electronic helicopter needs 18%: the owner fixes it on the item
  await o.goto(`${B}/app/items/${heli.id}/edit`); await o.waitForLoadState('networkidle');
  await o.getByRole('button', { name: '18%', exact: true }).click(); await o.getByRole('button', { name: 'Save changes' }).click(); await o.waitForTimeout(900);
  ok((await oa('GET', '/shop/items')).body.find((i) => i.id === heli.id).taxRate === 18, 'owner set the electronic helicopter to 18% from the item form');

  /* 4. Barcode generation: every loose toy in one go, then price tags */
  await o.goto(B + '/app/items'); await o.waitForLoadState('networkidle');
  const notice = o.locator('.notice-bar');
  const noticeText = await notice.innerText();
  ok(/no barcode yet/.test(noticeText), `Items page says how many toys have no barcode: “${noticeText.split('.')[0]}”`);
  await o.screenshot({ path: `${out}/02-items-notice.png` });
  await notice.getByRole('button', { name: /Generate barcodes/ }).click();
  await o.waitForURL(/items\/labels/); await o.waitForSelector('.ls-sheets .lv');
  items = (await oa('GET', '/shop/items')).body;
  const loose = items.filter((i) => i.name.startsWith('Loose') || ['Soft teddy bear 30 cm', 'Building blocks (100 pcs)', 'Jigsaw puzzle 500 pieces', 'Ludo and snakes board game', 'Remote control car'].includes(i.name));
  ok(items.filter((i) => i.type === 'Goods').every((i) => /^\d{12,13}$/.test(i.barcode)), 'every goods item now has a barcode');
  const labelsNow = Number((await o.locator('.ls-summary').innerText()).match(/([\d,]+)\s+labels?/)[1].replace(/,/g, ''));
  const expectLabels = items.filter((i) => i.name.startsWith('Loose')).reduce((s, i) => s + Math.max(1, i.stock), 0) + items.filter((i) => !i.name.startsWith('Loose') && loose.includes(i)).reduce((s, i) => s + Math.max(1, i.stock), 0);
  ok(labelsNow === expectLabels, `labels page opens with one label per piece in stock: ${labelsNow} labels`, `expected ${expectLabels}`);
  ok(await o.locator('.ls-sheets .lv svg rect, .ls-sheets .lv svg path').count() > (await o.locator('.ls-sheets .lv').count()) * 5, 'each label has a drawn barcode');
  printed.length = 0; await o.getByRole('button', { name: /^Print labels/ }).click(); await o.waitForTimeout(300);
  ok(printed.length === 1 && /size: 102mm 25mm/.test(printed[0]), `labels sent to the 50×25 mm 2-up label printer: ${printed[0]}`);
  await o.locator('.ls-sheets').first().screenshot({ path: `${out}/03-labels-roll.png` });
  // Same labels on A4 sheets (shops without a label printer)
  const ps = (await oa('GET', '/shop/print-settings')).body;
  await oa('PUT', '/shop/print-settings', { ...ps, barcode: { ...ps.barcode, printer: 'a4', labelSize: 'a4-65' } });
  await o.reload(); await o.waitForSelector('.label-a4');
  const sheets = Number((await o.locator('.ls-summary').innerText()).match(/(\d+) sheets?/)?.[1]);
  ok(sheets === Math.ceil(labelsNow / 65), `A4 sheets: ${sheets} sheet(s) of 65 labels`);
  printed.length = 0; await o.getByRole('button', { name: /^Print labels/ }).click(); await o.waitForTimeout(300);
  ok(/size: A4/.test(printed[0] ?? ''), 'A4 label sheets print on A4');
  await o.locator('.label-a4').first().screenshot({ path: `${out}/04-labels-a4.png` });
  await oa('PUT', '/shop/print-settings', ps);

  /* 2. Inventory management: stock arrives on a bill, scanned box by box */
  const vendor = (await oa('POST', '/shop/vendors', { name: 'Ahmedabad Toy House', gstin: '24AAACA1234B1Z5', phone: '+91 79 2640 1122', state: 'Gujarat' })).body;
  await o.goto(B + '/app/purchases/bills'); await o.waitForLoadState('networkidle');
  await o.getByRole('button', { name: /New Bill/ }).first().click();
  await o.getByLabel(/^Vendor\*?$/).selectOption(vendor.id);
  await o.getByLabel('Vendor’s bill number').fill('ATH/1123');
  const scanBox = o.locator('[aria-label="Scan to add to the bill"]');
  const scan = async (code) => { await scanBox.fill(code); await scanBox.press('Enter'); await o.waitForTimeout(150); };
  for (const c of ['8901234500048', '8901234500048', '8901234500048', '8901234500093', '890123450004']) await scan(c);
  const rows = o.locator('.pl-table tbody tr');
  ok(await rows.count() === 2, `scanning added 2 lines (racing car ×3, helicopter ×1): ${await rows.count()} lines`);
  ok(/No item has barcode 890123450004/.test(await o.locator('[role=dialog]').innerText()) && await o.getByRole('link', { name: 'Add it as a new item' }).count() === 1, 'an unknown code on the bill is named, with “Add it as a new item”');
  // the cars come in a carton of 24: type the quantity
  await rows.nth(0).locator('[aria-label="Quantity"]').fill('24');
  await o.screenshot({ path: `${out}/05-bill-scan.png` });
  const carBefore = items.find((i) => i.name === 'Pull-back racing car').stock;
  await o.getByRole('button', { name: 'Save bill' }).click(); await o.waitForTimeout(1500);
  items = (await oa('GET', '/shop/items')).body;
  ok(items.find((i) => i.name === 'Pull-back racing car').stock === carBefore + 24, `stock in: racing cars ${carBefore} → ${items.find((i) => i.name === 'Pull-back racing car').stock}`);
  // labels for exactly what came in
  await o.locator('tr.clickable').first().click(); await o.waitForTimeout(500);
  await o.getByRole('button', { name: /Print labels for these items/ }).click();
  await o.waitForURL(/items\/labels/); await o.waitForSelector('.ls-sheets .lv');
  await o.waitForTimeout(800); const delivered = (await o.locator('.ls-summary').innerText()).match(/([\d,]+)\s+labels?/)?.[1];
  ok(delivered === '25', `labels for the delivery: 24 cars + 1 helicopter = ${delivered}`);
  // a damaged toy written off, and the stock summary
  const dmg = await oa('POST', `/shop/items/${heli.id}/adjust`, { branchId: (await oa('GET', '/auth/me')).body.user.branchId, qty: -1, note: 'Damaged in transit' });
  ok(dmg.status === 200, 'damaged helicopter written off with a reason');
  await o.goto(B + '/app/inventory/stock-summary').catch(() => {}); await o.waitForLoadState('networkidle');
  await o.screenshot({ path: `${out}/06-stock-summary.png`, fullPage: true });
  ok(/Pull-back racing car/.test(await o.locator('body').innerText()), 'stock summary lists the toys with quantities');

  /* 3 + 5. Billing with scanning and printing */
  const ca = apiOf(o);
  await o.goto(B + '/app/pos'); await o.waitForSelector('.pos-tile');
  const tag = items.find((i) => i.name === 'Loose bouncy ball').barcode;
  for (const code of [tag, tag, '8901234500062', '0' + '8901234500079'.slice(1)]) { await o.evaluate(() => document.activeElement?.blur()); await o.keyboard.type(code, { delay: 5 }); await o.keyboard.press('Enter'); await o.waitForTimeout(200); }
  const cart = await o.locator('.pos-panel').nth(1).innerText();
  ok(/Loose bouncy ball/.test(cart) && /Water colour paint box/.test(cart), 'POS: generated tag and maker’s barcode both scan into the cart');
  await o.getByRole('button', { name: /^Charge/ }).first().click(); await o.waitForSelector('text=Sale complete');
  printed.length = 0; await o.getByRole('button', { name: /Print receipt/ }).click(); await o.waitForTimeout(300);
  ok(/80mm/.test(printed[0] ?? ''), 'POS receipt prints on the 80 mm roll');
  await o.locator('[role=dialog] .receipt').screenshot({ path: `${out}/07-receipt.png` });
  await o.getByRole('button', { name: /New sale/ }).click();
  // a school orders on credit: invoice form, items scanned in
  const cust = (await oa('POST', '/shop/customers', { type: 'Business', name: 'Principal', companyName: 'Bright Kids School', gstin: '24AABTB1234C1Z6', phone: '9879012345', state: 'Gujarat' })).body;
  await o.goto(`${B}/app/sales/invoices/new`); await o.waitForLoadState('networkidle');
  await o.locator('select[aria-label=Customer]').selectOption(cust.id);
  const invScan = o.locator('input[placeholder="Scan barcode / SKU to add"]');
  for (const code of ['8901234500062', '8901234500062', '8901234500079']) { await invScan.fill(code); await invScan.press('Enter'); await o.waitForTimeout(200); }
  await o.screenshot({ path: `${out}/08-invoice-scan.png`, fullPage: true });
  await o.getByRole('button', { name: 'Issue invoice' }).click(); await o.waitForURL(/invoices\/[0-9a-f-]{36}$/);
  const invId = o.url().split('/').pop();
  const inv = (await ca('GET', `/shop/invoices/${invId}`)).body;
  ok(inv.lines.find((l) => l.name.startsWith('Water colour'))?.qty === 2 && inv.lines.some((l) => l.name.startsWith('Wooden puzzle')), `invoice ${inv.number}: scanned twice = qty 2, plus the puzzle`);
  ok(inv.customer.gstin === '24AABTB1234C1Z6' && inv.cgst > 0, 'B2B invoice with the school’s GSTIN, CGST + SGST');
  const pdf = await o.request.get(`${B}/api/shop/invoices/${invId}/pdf?paper=a4`, { headers: H });
  ok(pdf.status() === 200 && (pdf.headers()['content-type'] ?? '').includes('pdf'), `A4 PDF downloads (${pdf.headers()['content-disposition']})`);
  await o.goto(`${B}/invoices/${invId}/print?paper=a4`); await o.waitForSelector('.ti'); await o.locator('.ti').screenshot({ path: `${out}/09-invoice-a4.png` });
  // low stock after the day
  const helis = (await oa('GET', '/shop/items')).body.find((i) => i.id === heli.id);
  ok(helis.stock === 4 && helis.stock <= helis.reorderLevel, `helicopters at ${helis.stock}: at or below the reorder level (${helis.reorderLevel})`);
  await o.goto(B + '/app/inventory/reorder'); await o.waitForLoadState('networkidle'); await o.waitForTimeout(600);
  ok(/Remote helicopter|helicopter/i.test(await o.locator('body').innerText()), 'Smart Reorder suggests reordering the helicopter');
  await o.screenshot({ path: `${out}/10-reorder.png`, fullPage: true });
} catch (e) { ok(false, `stopped after: ${log[log.length - 1] ?? 'start'}`, e.message.split('\n').slice(0, 2).join(' ')); }
console.log(errs.length ? 'PAGE ERRORS:\n' + [...new Set(errs)].join('\n') : 'no page errors');
fs.writeFileSync(`${out}/result.txt`, log.join('\n') + '\n');
await b.close();
