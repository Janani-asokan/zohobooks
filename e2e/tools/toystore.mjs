// First day at a toy store: admin creates the shop as "Toys & games", the owner signs in, adds toys with the maker's
// barcode and with a generated one, prints labels, bills at the counter with a USB scanner (keyboard input), prints the
// thermal receipt and checks the bill. Usage: BASE=http://localhost:4000 node e2e/tools/toystore.mjs <outDir>
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.';
const stamp = Date.now().toString().slice(-6);
const email = `toys${stamp}@example.com`, temp = 'Welcome@12345', pass = 'Toyshop@2026';
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const H = { 'x-requested-with': 'ledgerly' };
const b = await chromium.launch();

// 1. Admin creates the shop
const admin = await b.newContext();
const ar = await admin.request.post(B + '/api/auth/login', { data: { email: 'admin@ledgerly.in', password: 'admin123' }, headers: H });
ok(ar.ok(), 'admin signs in');
const cr = await admin.request.post(B + '/api/platform/shops', { headers: H, data: { shopName: `Happy Toys ${stamp}`, ownerName: 'Amal', email, phone: '+91 98765 43210', city: 'Vadodara', planId: 'standard', years: 1, password: temp, businessType: 'toys' } });
ok(cr.status() === 201, `admin creates a Toys & games shop (${cr.status()})`);
await admin.close();

// 2. Owner signs in and sets a password
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
let printed = [];
await p.exposeFunction('__onPrint', (css) => printed.push(css));
await p.addInitScript(() => { window.print = () => window.__onPrint([...document.querySelectorAll('style')].map((s) => s.textContent).filter((t) => t.includes('@page')).join(' ') + ' | ' + document.body.className); });
await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', temp); await p.keyboard.press('Enter');
await p.waitForSelector('text=Set your own password'); await p.locator('input[type=password]').nth(0).fill(temp); await p.locator('input[type=password]').nth(1).fill(pass);
await p.getByRole('button', { name: 'Save and continue' }).click();
await p.waitForSelector('text=Set your own password', { state: 'detached', timeout: 20000 }); await p.waitForLoadState('networkidle');
const api = async (m, u, d) => { const r = await p.request.fetch(B + '/api' + u, { method: m, data: d, headers: H }); return { status: r.status(), body: await r.json().catch(() => null) }; };
const orgR = await api('GET', '/shop/organization'); if (orgR.status !== 200) console.log('org', orgR.status, JSON.stringify(orgR.body), p.url()); const org = orgR.body;
ok(org.businessType === 'toys', 'shop is set up as Toys & games');
ok(org.itemFields.some((f) => f.key === 'ageGroup'), 'age group field is on items');
let items = (await api('GET', '/shop/items')).body;
ok(items.length >= 5 && items.some((i) => i.name.includes('Remote control car') && i.taxRate === 18), `common toys loaded (${items.length}), electronic toy at 18%`);

// 3. Add a toy with the maker's barcode (EAN-13 on the box) through the item form
const EAN = '8901058000016';
await p.goto(B + '/app/items/new?type=Goods'); await p.waitForLoadState('networkidle');
await p.locator('#item-name').fill('Musical keyboard toy');
await p.getByLabel('SP1 · Standard').fill('999');
await p.locator('.field:has(label:text("Cost price")) input').fill('600');
await p.locator('.field:has(label:text("HSN code")) input').fill('9503');
await p.getByRole('button', { name: '18%', exact: true }).click();
await p.locator('input[placeholder^="Scan or type barcode"]').fill(EAN);
await p.screenshot({ path: `${out}/toy-item-form.png`, fullPage: true });
const form = await p.locator('main, .page, body').first().innerText();
ok(/Age group/.test(form), 'item form shows Age group');
// fill price via API afterwards to keep the form part simple
await p.getByRole('button', { name: 'Save item' }).click(); await p.waitForTimeout(800); await p.screenshot({ path: `${out}/toy-item-after-save.png`, fullPage: true });
await p.waitForTimeout(1500);
items = (await api('GET', '/shop/items')).body;
let kb = items.find((i) => i.name === 'Musical keyboard toy');
ok(!!kb && kb.barcode === EAN, `toy saved with the maker’s barcode ${kb?.barcode ?? '(not saved)'}`);
ok(!!kb && kb.sp2 === 999 && kb.sp3 === 999 && kb.taxRate === 18, 'one price typed: SP2 and SP3 use it');
if (!kb) kb = (await api('POST', '/shop/items', { type: 'Goods', name: 'Musical keyboard toy', unit: 'pcs', hsn: '9503', barcode: EAN, cost: 600, sp1: 999, sp2: 999, sp3: 999, mrp: 1199, taxSlabId: 'tax_18', extra: { electronic: 'Yes' } })).body;
else await api('PUT', `/shop/items/${kb.id}`, { ...kb, hsn: '9503', cost: 600, sp1: 999, sp2: 999, sp3: 999, mrp: 1199, taxSlabId: 'tax_18', extra: { electronic: 'Yes', ageGroup: '3–5 years' } });

// 4. Generate a barcode for the teddy (no barcode on loose toys) and add stock
const teddy = items.find((i) => i.name.startsWith('Soft teddy'));
await p.goto(`${B}/app/items/${teddy.id}/edit`); await p.waitForLoadState('networkidle');
await p.getByRole('button', { name: /generate one/i }).click();
const gen = await p.locator('input[placeholder^="Scan or type barcode"]').inputValue();
ok(/^\d{13}$/.test(gen), `generated barcode ${gen}`);
await p.getByRole('button', { name: 'Save changes' }).click(); await p.waitForTimeout(1500);
items = (await api('GET', '/shop/items')).body;
const teddy2 = items.find((i) => i.id === teddy.id);
ok(teddy2.barcode === gen, 'generated barcode saved on the teddy');
const me = (await api('GET', '/auth/me')).body;
for (const it of [teddy2, kb]) await api('POST', `/shop/items/${it.id}/adjust`, { branchId: me.user.branchId, qty: 20, note: 'Opening stock' });

// 5. Print barcode labels on a 50 x 25 mm label printer
await p.goto(`${B}/app/items/labels?ids=${teddy2.id},${kb.id}`); await p.waitForSelector('.blabel');
const bars = await p.locator('.blabel svg.bl-code rect, .blabel svg.bl-code path').count();
ok(bars > 20, `labels draw real barcodes (${await p.locator('.blabel').count()} labels)`);
await p.locator('.print-area').screenshot({ path: `${out}/toy-labels.png` });
printed = []; await p.getByRole('button', { name: 'Print labels' }).click(); await p.waitForTimeout(400);
ok(printed.length === 1 && /size: 102mm 25mm/.test(printed[0]), `label page size sent to the printer: ${printed[0]}`);

// 6. Counter billing with a scanner: keys typed with nothing focused, like a USB scanner after tapping the screen
await p.goto(B + '/app/pos'); await p.waitForSelector('.pos-tile');
const firstTile = (await p.locator('.pos-tile .n').first().innerText()).trim();
await p.locator('.pos-tile').first().click(); // cashier taps a tile: focus leaves the scan box
await p.locator('body').click({ position: { x: 5, y: 700 } });
await p.evaluate(() => document.activeElement?.blur());
await p.keyboard.type(gen, { delay: 8 }); await p.keyboard.press('Enter');
await p.keyboard.type(EAN, { delay: 8 }); await p.keyboard.press('Enter');
await p.keyboard.type(EAN, { delay: 8 }); await p.keyboard.press('Enter');
await p.waitForTimeout(300);
const cart = await p.locator('.pos-panel').nth(1).innerText();
ok(/Soft teddy/.test(cart) && /Musical keyboard/.test(cart), 'scans with nothing focused land in the cart');
// UPC-style scan (leading zero dropped) of the same box
await p.keyboard.type('0' + EAN, { delay: 8 }); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
await p.keyboard.type('9999999999999', { delay: 8 }); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
ok(await p.getByRole('link', { name: /Add as a new item/ }).count() === 1, 'an unknown barcode offers “Add as a new item”');
await p.locator('input[aria-label="Scan or search items"]').fill('');
await p.screenshot({ path: `${out}/toy-pos.png` });
await p.getByRole('button', { name: /^Charge/ }).first().click();
await p.waitForSelector('text=Sale complete', { timeout: 15000 });
const doneText = await p.locator('[role=dialog]').innerText();
ok(/INV-|POS-/.test(doneText), 'sale completes with an invoice number');
await p.locator('[role=dialog]').screenshot({ path: `${out}/toy-receipt.png` });
printed = []; await p.getByRole('button', { name: /Print receipt/ }).click(); await p.waitForTimeout(400);
ok(printed.length === 1 && /size: 80mm \d+mm/.test(printed[0]), `receipt page size sent to the printer: ${printed[0]}`);

// 7. The bill is right: quantities, GST by toy type, stock went down
const inv = (await api('GET', '/shop/invoices')).body; const list = Array.isArray(inv) ? inv : inv.rows ?? inv.items;
const sale = (await api('GET', `/shop/invoices/${list[0].id}`)).body;
const kq = sale.lines.find((l) => l.name.includes('Musical'))?.qty, tq = sale.lines.find((l) => l.name.includes('teddy'))?.qty;
const tapped = firstTile.includes('Musical') ? 1 : 0;
ok(kq === 3 + tapped, `keyboard: scanned twice + once with a leading 0${tapped ? ' + one tap' : ''}: ${kq}`);
ok(tq >= 1, `teddy on the bill: ${tq}`);
ok(sale.lines.find((l) => l.name.includes('Musical')).taxRate === 18 && sale.lines.find((l) => l.name.includes('teddy')).taxRate === 5, 'GST 18% on the electronic toy, 5% on the teddy');
items = (await api('GET', '/shop/items')).body;
ok(items.find((i) => i.id === kb.id).stock === 20 - kq, `stock reduced: keyboard ${items.find((i) => i.id === kb.id).stock}`);
ok(sale.amountPaid === sale.total, `paid in full ₹${sale.total}`);
console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
console.log(JSON.stringify({ email, pass }));
await b.close();
