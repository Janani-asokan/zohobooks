import { beforeAll, describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { freshDb, login, today } from './helpers';
import { parseTallyXml } from '../src/services/tally';

let owner: Awaited<ReturnType<typeof login>>;
const xmlOf = (text: string) => new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(text);
const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
});

describe('Tally export', () => {
  it('exports masters that read back with every customer, vendor and stock item', async () => {
    const r = await owner.get('/api/shop/tally/masters.xml');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/xml/);
    const back = parseTallyXml(r.text);
    const customers = (await owner.get('/api/shop/customers')).body;
    const vendors = (await owner.get('/api/shop/vendors')).body;
    const goods = (await owner.get('/api/shop/items')).body.filter((i: any) => i.type === 'Goods' && !i.isGroup);
    expect(back.customers.length).toBe(customers.length);
    expect(back.vendors.length).toBe(vendors.length);
    expect(back.items.length).toBe(goods.length);
    const it = goods[0];
    expect(back.items.find((x) => x.name === it.name)).toMatchObject({ hsn: it.hsn, taxRate: it.taxRate, price: it.sp1 });
  });

  it('exports sales, receipts, purchases and payments as balanced vouchers', async () => {
    const r = await owner.get(`/api/shop/tally/vouchers.xml?from=2000-01-01&to=${today()}`);
    expect(r.status).toBe(200);
    const counts = JSON.parse(r.headers['x-voucher-counts']);
    expect(counts.sales).toBeGreaterThan(0);
    const msgs = list(xmlOf(r.text).ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE);
    expect(msgs.length).toBe(counts.sales + counts.receipts + counts.purchases + counts.payments);
    for (const m of msgs) {
      const v = m.VOUCHER;
      const sum = [...list(v['LEDGERENTRIES.LIST']), ...list(v['ALLINVENTORYENTRIES.LIST'])].reduce((s: number, e: any) => s + Number(e.AMOUNT), 0);
      expect(Math.abs(sum), `${v.VOUCHERTYPENAME} ${v.VOUCHERNUMBER} must balance`).toBeLessThan(0.011);
      expect(v.DATE).toMatch(/^\d{8}$/);
    }
  });
});

describe('Tally import', () => {
  const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>Old Books</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>
    <TALLYMESSAGE><LEDGER NAME="Sri Balaji Traders" RESERVEDNAME=""><PARENT>Sundry Debtors</PARENT><LEDGERMOBILE>9876543210</LEDGERMOBILE>
      <LEDGSTREGDETAILS.LIST><APPLICABLEFROM>20230401</APPLICABLEFROM><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><GSTIN>33ABCDE1234F1Z5</GSTIN></LEDGSTREGDETAILS.LIST>
      <LEDMAILINGDETAILS.LIST><ADDRESS.LIST TYPE="String"><ADDRESS>12, Bazaar Street</ADDRESS><ADDRESS>Salem</ADDRESS></ADDRESS.LIST><STATE>Tamil Nadu</STATE></LEDMAILINGDETAILS.LIST></LEDGER></TALLYMESSAGE>
    <TALLYMESSAGE><LEDGER NAME="Ravi Kumar"><PARENT>Sundry Debtors</PARENT><LEDSTATENAME>Karnataka</LEDSTATENAME></LEDGER></TALLYMESSAGE>
    <TALLYMESSAGE><LEDGER NAME="Hindustan Distributors"><PARENT>Sundry Creditors</PARENT><PARTYGSTIN>29AAACH1234K1Z2</PARTYGSTIN></LEDGER></TALLYMESSAGE>
    <TALLYMESSAGE><LEDGER NAME="Electricity"><PARENT>Indirect Expenses</PARENT></LEDGER></TALLYMESSAGE>
    <TALLYMESSAGE><STOCKITEM NAME="Philips LED Bulb 9W"><BASEUNITS>Nos</BASEUNITS><OPENINGBALANCE> 40 Nos</OPENINGBALANCE>
      <GSTDETAILS.LIST><HSNCODE>8539</HSNCODE><STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME><RATEDETAILS.LIST><GSTRATEDUTYHEAD>Central Tax</GSTRATEDUTYHEAD><GSTRATE>6</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD><GSTRATE>12</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST>
      <STANDARDCOSTLIST.LIST><DATE>20230401</DATE><RATE>65.00/Nos</RATE></STANDARDCOSTLIST.LIST><STANDARDPRICELIST.LIST><DATE>20230401</DATE><RATE>99.00/Nos</RATE></STANDARDPRICELIST.LIST></STOCKITEM></TALLYMESSAGE>
  </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

  it('previews and imports customers, vendors and stock items from TallyPrime masters, skipping repeats', async () => {
    const pv = await owner.post('/api/shop/tally/preview').send({ xml });
    expect(pv.status).toBe(200);
    expect(pv.body).toMatchObject({ company: 'Old Books', counts: { customers: 2, vendors: 1, items: 1, otherLedgers: 1 } });
    expect(pv.body.sample.customers[0]).toMatchObject({ name: 'Sri Balaji Traders', gstin: '33ABCDE1234F1Z5', state: 'Tamil Nadu', address: '12, Bazaar Street, Salem', phone: '9876543210' });
    expect(pv.body.sample.items[0]).toMatchObject({ hsn: '8539', taxRate: 12, cost: 65, price: 99, openingQty: 40, unit: 'Nos' });

    const r = await owner.post('/api/shop/tally/import').send({ xml });
    expect(r.status).toBe(200);
    expect(r.body.customers.created).toBe(2);
    expect(r.body.vendors.created).toBe(1);
    expect(r.body.items.created).toBe(1);
    const bulb = (await owner.get('/api/shop/items')).body.find((i: any) => i.name === 'Philips LED Bulb 9W');
    expect(bulb).toMatchObject({ hsn: '8539', taxRate: 12, cost: 65, sp1: 99, stock: 40 });
    const again = await owner.post('/api/shop/tally/import').send({ xml });
    expect(again.body.customers).toMatchObject({ created: 0, skipped: 2 });
    expect(again.body.items).toMatchObject({ created: 0, skipped: 1 });
  });

  it('rejects files that are not Tally XML', async () => {
    expect((await owner.post('/api/shop/tally/preview').send({ xml: '<html><body>hello world</body></html>' })).status).toBe(400);
  });
});

describe('import from any software', () => {
  it('maps common headers without AI and imports the mapped rows', async () => {
    const m = await owner.post('/api/shop/data-import/map').send({ headers: ['Item Name', 'HSN Code', 'Sale Price', 'Purchase Price', 'GST %', 'Opening Qty', 'Unit'] });
    expect(m.status).toBe(200);
    expect(m.body.kind).toBe('items');
    expect(m.body.mapping).toMatchObject({ name: 'Item Name', hsn: 'HSN Code', sp1: 'Sale Price', cost: 'Purchase Price', tax_rate: 'GST %', stock: 'Opening Qty', unit: 'Unit' });
    const r = await owner.post('/api/shop/data-import').send({ kind: 'items', rows: [{ name: 'Vyapar Import Pen', hsn: '9608', sp1: '₹20.00', cost: '12', tax_rate: '18%', stock: '100', unit: 'pcs' }, { name: '' }] });
    expect(r.body).toMatchObject({ created: 1, skipped: 0 });
    expect(r.body.errors).toHaveLength(1);
    expect((await owner.get('/api/shop/items')).body.find((i: any) => i.name === 'Vyapar Import Pen')).toMatchObject({ sp1: 20, cost: 12, taxRate: 18, stock: 100 });
  });
});
