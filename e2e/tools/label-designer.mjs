// Template designer and big jobs: make a template in the designer (add a QR and a field, drag, resize, nudge with the
// keyboard), publish it as v1, edit and publish v2 (v1 unchanged), set it as a category default; a 10,000-label job
// previews in under 2 seconds (QA-P07, only visible rows render) and a 10,001-label job is blocked (BP-05).
// Usage: BASE=http://localhost:4000 node e2e/tools/label-designer.mjs <outDir>
import { chromium } from 'playwright';
// The label screen folds stock / printer / template under “More settings”.
const openMore = async (pg) => { const m = pg.getByRole('button', { name: 'More settings' }); if (await m.isVisible().catch(() => false)) await m.click(); };
import fs from 'node:fs';
const B = process.env.BASE ?? 'http://localhost:4000';
const out = process.argv[2] ?? '.'; fs.mkdirSync(out, { recursive: true });
const ok = (c, m, why = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${!c && why ? ` (${why})` : ''}`); if (!c) process.exitCode = 1; };
const errs = [];
const b = await chromium.launch();
let call; let tplId = null;
try {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/\/app/);
  call = (m, u, d) => p.evaluate(async ([m, u, d]) => { const r = await fetch('/api' + u, { method: m, headers: { 'x-requested-with': 'ledgerly', 'content-type': 'application/json' }, body: d ? JSON.stringify(d) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, u, d]);
  const tag = Date.now().toString().slice(-6);

  await p.goto(B + '/app/items/labels?tab=templates'); await p.getByRole('button', { name: 'New template' }).click();
  await p.getByRole('button', { name: '50 × 25', exact: true }).click(); await p.getByRole('button', { name: 'Start designing' }).click();
  await p.getByLabel('Template name').fill(`Designer ${tag}`);
  const before = await p.locator('.lb-canvas .lv-el').count();
  await p.getByRole('button', { name: 'QR code' }).click();
  ok(await p.locator('.lb-canvas .lv-el').count() === before + 1 && await p.locator('.lb-canvas .lv-el.lv-qr').count() === 1, 'add a QR code');
  // drag it 10 mm right (zoom px per mm from the canvas width)
  const zoom = (await p.locator('.lb-canvas').boundingBox()).width / 50;
  const qr = p.locator('.lb-canvas .lv-el.sel'); const bx = await qr.boundingBox();
  await p.mouse.move(bx.x + 5, bx.y + 5); await p.mouse.down(); await p.mouse.move(bx.x + 5 + 10 * zoom, bx.y + 5, { steps: 6 }); await p.mouse.up();
  const x = Number(await p.locator('#p-x').inputValue());
  ok(Math.abs(x - 11) < 0.6, `drag moves it in mm with snap: left ${x} mm`);
  await p.locator('.lb-canvas').click({ position: { x: 2, y: 2 } }).catch(() => {});
  await p.locator('.lb-canvas .lv-el.lv-qr').click();
  await p.locator('.lb-designer').focus(); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Shift+ArrowRight');
  ok(Math.abs(Number(await p.locator('#p-x').inputValue()) - (x + 0.1)) < 0.05, 'arrow keys nudge (Shift = 0.1 mm)');
  const hb = await p.locator('.lb-handle').boundingBox();
  const w0 = Number(await p.locator('#p-w').inputValue());
  await p.mouse.move(hb.x + 6, hb.y + 6); await p.mouse.down(); await p.mouse.move(hb.x + 6 - 3 * zoom, hb.y + 6 - 3 * zoom, { steps: 5 }); await p.mouse.up();
  ok(Number(await p.locator('#p-w').inputValue()) < w0, 'the corner handle resizes');
  await p.getByRole('button', { name: 'Field' }).click();
  await p.locator('#p-field').selectOption('expiry'); await p.locator('#p-text').fill('EXP ');
  ok(/EXP 30\/06\/2027/.test(await p.locator('.lb-canvas').innerText()), 'a field with a prefix shows sample data (expiry)');
  await p.screenshot({ path: `${out}/designer.png` });
  await p.getByRole('button', { name: 'Publish' }).click(); await p.waitForTimeout(1200);
  const t1 = (await call('GET', '/shop/label/setup')).body.templates.find((t) => t.name === `Designer ${tag}`);
  tplId = t1?.id;
  ok(t1 && t1.version === 1 && t1.published.elements.some((e) => e.type === 'qr') && t1.published.elements.some((e) => e.field === 'expiry'), 'published as v1 with the QR and expiry field');
  // v2
  await p.locator('.lb-tcard', { hasText: `Designer ${tag}` }).getByRole('button', { name: 'Edit' }).click(); await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Box' }).click(); await p.getByRole('button', { name: 'Publish' }).click(); await p.waitForTimeout(1200);
  const t2 = (await call('GET', '/shop/label/setup')).body.templates.find((t) => t.id === tplId);
  const vs = (await call('GET', `/shop/label/templates/${tplId}/versions`)).body;
  ok(t2.version === 2 && vs.length === 2, `edit and publish again: v2 (versions ${vs.map((v) => v.version).join(', ')})`);
  // category default
  const cat = (await call('GET', '/shop/items')).body.find((i) => i.category)?.category;
  await call('PUT', `/shop/label/templates/${tplId}/default`, { isDefault: false, categories: [cat] });
  const t3 = (await call('GET', '/shop/label/setup')).body.templates.find((t) => t.id === tplId);
  ok(t3.categories.includes(cat), `default for the “${cat}” category (BL-14)`);

  /* 10,000 labels */
  const item = (await call('GET', '/shop/items')).body.find((i) => i.barcode && i.type === 'Goods' && !i.trackSerials);
  await p.goto(`${B}/app/items/labels?ids=${item.id}`); await p.waitForSelector('.lb-lines li');
  await openMore(p); await p.locator('#ls-preset').selectOption({ label: '2-up standard · 50 × 25' });
  const t0 = Date.now();
  await p.locator('.lb-lines li input[type=number]').fill('10000');
  await p.waitForFunction(() => /10,000\s+labels/.test(document.querySelector('.ls-summary')?.textContent ?? ''), null, { timeout: 10000 });
  const ms = Date.now() - t0;
  const rendered = await p.locator('.ls-sheets .lv').count();
  ok(ms < 2000 && rendered <= 30, `10,000-label job previews in ${ms} ms, drawing only ${rendered} labels on screen (QA-P07)`);
  ok(/5000 rows/.test(await p.locator('.ls-summary').innerText()) && /140\.0 m/.test(await p.locator('.ls-summary').innerText()), `footer: ${(await p.locator('.ls-summary').innerText()).replace(/\s+/g, ' ').slice(0, 80)}`);
  ok(/part 1 of 50/.test(await p.getByRole('button', { name: /^Print labels/ }).innerText()), 'big jobs print in parts of 100 rows (BP-09)');
  await p.locator('.lb-lines li input[type=number]').fill('10001');
  await p.waitForTimeout(300);
  ok(await p.locator('.lb-lines li input[type=number]').inputValue() === '10000', 'one line stops at 10,000 labels (bigger jobs must be split, BP-05)');
} catch (e) { ok(false, 'script crashed', e.stack); }
finally {
  if (call && tplId) await call('DELETE', `/shop/label/templates/${tplId}`).catch(() => {});
  ok(errs.length === 0, 'no page errors', errs.slice(0, 4).join(' | '));
  await b.close();
}
