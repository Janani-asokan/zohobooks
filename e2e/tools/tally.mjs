// Dev check for Tally & Import: export masters/vouchers, import a TallyPrime masters file, import a Vyapar-style CSV.
// Usage: BASE=http://localhost:4000 node e2e/tools/tally.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
const out = process.argv[2];
const B = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && errs.push(`${r.status()} ${r.url()}`));
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}: ${e.message.split('\n')[0]}`); if (out) await p.screenshot({ path: `${out}/tally-fail-${results.length}.png` }).catch(() => {}); }
};

const tallyXml = `${os.tmpdir()}/tally-masters-in.xml`;
// Tally writes UTF-16 by default.
fs.writeFileSync(tallyXml, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE><LEDGER NAME="Ganesh Hardware ${Date.now() % 10000}"><PARENT>Sundry Debtors</PARENT><LEDGERMOBILE>9443012345</LEDGERMOBILE><LEDGSTREGDETAILS.LIST><GSTIN>33AAGFG1234H1Z9</GSTIN></LEDGSTREGDETAILS.LIST></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Supreme Pipes Ltd"><PARENT>Sundry Creditors</PARENT></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><STOCKITEM NAME="PVC Pipe 1 inch ${Date.now() % 10000}"><BASEUNITS>mtr</BASEUNITS><GSTDETAILS.LIST><HSNCODE>3917</HSNCODE><STATEWISEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD><GSTRATE>18</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST><STANDARDPRICELIST.LIST><RATE>45.00/mtr</RATE></STANDARDPRICELIST.LIST></STOCKITEM></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`, 'utf16le')]));
const csv = `${os.tmpdir()}/vyapar-items.csv`;
fs.writeFileSync(csv, `Item Name,Item Code,Sale Price,Purchase Price,Tax Rate,Current Stock Quantity,HSN/SAC\nFevicol SH 1kg ${Date.now() % 10000},FEV1K,"₹ 410.00",350,GST@18%,24,3506\nAsian Paints Primer 4L ${Date.now() % 10000},APP4,1150,980,GST@18%,6,3209\n`);

await p.goto(B + '/login');
await p.fill('input[type=email]', 'owner@shop.com');
await p.fill('input[type=password]', 'owner123');
await p.keyboard.press('Enter');
await p.waitForURL(/\/app/);
await p.goto(B + '/app/accounting/tally');

await step('download Tally masters and vouchers', async () => {
  for (const name of ['Download masters.xml', 'Download vouchers.xml']) {
    const [d] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name }).click()]);
    const f = `${os.tmpdir()}/${d.suggestedFilename()}`;
    await d.saveAs(f);
    const x = fs.readFileSync(f, 'utf8');
    if (!x.includes('<ENVELOPE>') || !x.includes(name.includes('masters') ? '<LEDGER' : '<VOUCHER')) throw new Error(`${name}: not a Tally file`);
  }
});

await step('import a TallyPrime masters file (UTF-16)', async () => {
  await p.locator('input[accept^=".xml"]').setInputFiles(tallyXml);
  await p.getByText(/1\s*customers/).waitFor();
  await p.getByRole('button', { name: 'Import', exact: true }).click();
  await p.locator('.import-result', { hasText: 'Customers: 1 added' }).waitFor();
  await p.locator('.import-result', { hasText: 'Items: 1 added' }).waitFor();
});

await step('import a Vyapar item list with matched columns', async () => {
  await p.locator('input[accept^=".csv"]').setInputFiles(csv);
  await p.getByRole('button', { name: /Import 2 items/ }).waitFor({ timeout: 60000 });
  const map = Object.fromEntries(await p.locator('.dt-field').evaluateAll((els) => els.map((e) => [e.querySelector('span').textContent, e.querySelector('select').value])));
  for (const [f, col] of [['Item name *', 'Item Name'], ['Selling price *', 'Sale Price'], ['Cost price', 'Purchase Price'], ['GST %', 'Tax Rate'], ['Opening stock', 'Current Stock Quantity'], ['HSN/SAC', 'HSN/SAC']]) if (map[f] !== col) throw new Error(`${f} → ${map[f]}`);
  if (out) await p.screenshot({ path: `${out}/tally-map.png`, fullPage: true });
  await p.getByRole('button', { name: /Import 2 items/ }).click();
  await p.locator('.import-result', { hasText: 'Items: 2 added' }).waitFor();
  const fev = await p.evaluate(async () => (await (await fetch('/api/shop/items')).json()).find((i) => i.name.startsWith('Fevicol SH 1kg')));
  if (!fev || fev.sp1 !== 410 || fev.taxRate !== 18 || fev.stock !== 24 || fev.hsn !== '3506') throw new Error('imported values wrong: ' + JSON.stringify(fev && { sp1: fev.sp1, tax: fev.taxRate, stock: fev.stock, hsn: fev.hsn }));
  if (out) await p.screenshot({ path: `${out}/tally-done.png`, fullPage: true });
});

console.log(results.join('\n'));
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
