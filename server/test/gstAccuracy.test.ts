/**
 * GST figures checked against hand-worked answers. One month (May 2025, empty in the demo data) gets 23 invoices
 * across every kind a shop meets: registered buyers in Tamil Nadu and Karnataka, counter and named consumers,
 * small and large inter-state consumer sales, 0 / 5 / 12 / 18 / 28 % goods and an 18 % service, line and bill
 * discounts, a bill of supply, a cancelled invoice, and four credit notes. Every expected number below was worked
 * out by hand (rate × value), not by the code under test.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';
import { query } from '../src/db';
import { setOff } from '../src/services/gstReturns';

let owner: Awaited<ReturnType<typeof login>>;
const PERIOD = '2025-05';
const d = (day: number) => `2025-05-${String(day).padStart(2, '0')}`;
const items: Record<string, string> = {};
const cust: Record<string, string> = {};
const inv: Record<number, any> = {};

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  const shop = (await query("SELECT shop_id FROM users WHERE email = 'owner@shop.com'"))[0].shop_id;
  await query('UPDATE offers SET active = false WHERE shop_id = $1', [shop]); // running offers would change the bills
  const slabs = (await owner.get('/api/shop/tax-slabs')).body as Array<{ id: string; rate: number }>;
  const slab = (r: number) => slabs.find((s) => s.rate === r)!.id;
  const mk = async (k: string, type: string, name: string, hsn: string, unit: string, price: number, rate: number) => {
    const r = await owner.post('/api/shop/items').send({ type, name, hsn, unit, cost: price / 2, sp1: price, sp2: price, sp3: price, taxSlabId: slab(rate) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    items[k] = r.body.id;
  };
  await mk('A', 'Goods', 'GST Test Laptop', '8471', 'pcs', 10000, 18);
  await mk('B', 'Goods', 'GST Test Paper', '4802', 'ream', 500, 12);
  await mk('C', 'Goods', 'GST Test Rice', '1006', 'kg', 50, 5);
  await mk('D', 'Goods', 'GST Test TV', '8528', 'pcs', 25000, 28);
  await mk('E', 'Goods', 'GST Test Vegetables', '0701', 'kg', 40, 0);
  await mk('F', 'Services', 'GST Test AMC Service', '998314', 'nos', 15000, 18);
  const c = async (k: string, body: object) => {
    const r = await owner.post('/api/shop/customers').send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    cust[k] = r.body.id;
  };
  await c('R1', { type: 'Business', name: 'Ravi', companyName: 'GST Test Traders TN', gstin: '33ABCDE1234F1Z5', state: 'Tamil Nadu' });
  await c('R2', { type: 'Business', name: 'Kiran', companyName: 'GST Test Traders KA', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
  await c('U1', { type: 'Individual', name: 'GST Test Consumer TN', state: 'Tamil Nadu' });
  await c('U2', { type: 'Individual', name: 'GST Test Consumer KL', state: 'Kerala' });
  await c('W', { type: 'Individual', name: 'GST Test Counter Sales', state: 'Tamil Nadu' });

  type L = [string, number, number?];
  const bill = async (no: number, who: string, lines: L[], extra: object = {}) => {
    const r = await owner.post('/api/shop/invoices').send({
      customerId: cust[who], date: d(Math.min(no, 28)), dueDate: d(28), withGst: true, issue: true,
      lines: lines.map(([k, qty, discount = 0]) => ({ itemId: items[k], qty, discount })),
      stockOverride: { reason: 'GST accuracy test: stock not tracked here' }, ...extra,
    });
    expect(r.status, `invoice ${no}: ${JSON.stringify(r.body)}`).toBe(200);
    inv[no] = r.body;
  };
  await bill(1, 'R1', [['A', 2]]);
  await bill(2, 'R1', [['B', 10, 10]]);
  await bill(3, 'R1', [['C', 100], ['E', 20]]);
  await bill(4, 'R1', [['F', 1]]);
  await bill(5, 'R2', [['A', 3]]);
  await bill(6, 'R2', [['D', 2]]);
  await bill(7, 'R2', [['B', 20], ['C', 40]]);
  await bill(8, 'R2', [['E', 50]]);
  await bill(9, 'U1', [['A', 1]]);
  await bill(10, 'U1', [['B', 4]]);
  await bill(11, 'W', [['C', 10]]);
  await bill(12, 'W', [['D', 1]]);
  await bill(13, 'W', [['E', 10]]);
  await bill(14, 'U2', [['A', 5]]);
  await bill(15, 'U2', [['D', 4]]);
  await bill(16, 'U2', [['A', 10]]);
  await bill(17, 'U1', [['A', 1], ['B', 5]], { billDiscount: { kind: 'percent', value: 10 } });
  await bill(18, 'U1', [['F', 2, 5]]);
  await bill(19, 'R1', [['D', 1]]);
  await bill(20, 'W', [['F', 1]]);
  await bill(21, 'R1', [['A', 1]]);
  await bill(22, 'W', [['C', 10]], { withGst: false });
  await bill(23, 'U2', [['E', 5]]);
  expect((await owner.post(`/api/shop/invoices/${inv[21].id}/cancel`).send({ reason: 'Billed by mistake' })).status).toBe(200);

  const credit = async (no: number, item: string, qty: number) => {
    const line = inv[no].lines.find((l: any) => l.itemId === items[item]);
    const r = await owner.post('/api/shop/credit-notes').send({ invoiceId: inv[no].id, date: d(28), reason: 'Sales return', lines: [{ lineId: line.id, qty }], restock: false });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  };
  await credit(1, 'A', 1); // registered, intra → CDNR
  await credit(12, 'D', 1); // walk-in, intra → reduces B2CS
  await credit(15, 'D', 1); // consumer, inter-state, invoice over ₹1 lakh → CDNUR (B2CL)
  await credit(3, 'E', 5); // nil-rated line → reduces the nil table
}, 120_000);

describe('the invoices themselves', () => {
  it('each bill’s tax is rate × taxable value, split CGST/SGST in Tamil Nadu and IGST across states', () => {
    expect(inv[1]).toMatchObject({ subTotal: 20000, cgst: 1800, sgst: 1800, igst: 0, total: 23600 });
    expect(inv[2]).toMatchObject({ subTotal: 4500, cgst: 270, sgst: 270, total: 5040 }); // 10 × 500 less 10 %
    expect(inv[3]).toMatchObject({ subTotal: 5800, cgst: 125, sgst: 125, total: 6050 }); // 5,000 @5 % + 800 @0 %
    expect(inv[6]).toMatchObject({ subTotal: 50000, igst: 14000, cgst: 0, total: 64000 });
    expect(inv[7]).toMatchObject({ subTotal: 12000, igst: 1300, total: 13300 });
    expect(inv[17]).toMatchObject({ cgst: 945, sgst: 945, total: 13140 }); // (10,000 + 2,500) less 10 % = 11,250; tax 1,620 + 270
    expect(inv[17].lines.reduce((s: number, l: any) => s + l.amount, 0)).toBeCloseTo(11250, 2);
    expect(inv[18]).toMatchObject({ subTotal: 28500, cgst: 2565, sgst: 2565, total: 33630 }); // 2 × 15,000 less 5 %
    expect(inv[22]).toMatchObject({ subTotal: 500, taxTotal: 0, cgst: 0, sgst: 0, igst: 0, total: 500, withGst: false }); // no GST charged
  });
});

describe('GSTR-1', () => {
  let g: any; let j: any;
  beforeAll(async () => {
    g = (await owner.get(`/api/shop/gst/gstr1?period=${PERIOD}`)).body;
    j = (await owner.get(`/api/shop/gst/gstr1?period=${PERIOD}&download=1`)).body;
  });

  it('B2B (4A): 8 taxable invoices to registered buyers; the nil-only bill and the cancelled one stay out', () => {
    // TN: 20,000 + 4,500 + 5,000 + 15,000 + 25,000 = 69,500 (tax 14,090); KA: 30,000 + 50,000 + 12,000 = 92,000 (tax 20,700)
    expect(g.b2b).toEqual({ invoices: 8, taxable: 161500, tax: 34790 });
    const ka = j.b2b.find((b: any) => b.ctin === '29ABCDE1234F1Z5');
    expect(ka.inv).toHaveLength(3);
    expect(ka.inv.every((i: any) => i.pos === '29')).toBe(true);
    const inv7 = ka.inv.find((i: any) => i.inum === inv[7].number);
    expect(inv7.itms.map((x: any) => x.itm_det)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rt: 12, txval: 10000, iamt: 1200 }), expect.objectContaining({ rt: 5, txval: 2000, iamt: 100 })]));
  });

  it('B2CL (5): the two inter-state consumer bills over ₹1 lakh', () => {
    expect(g.b2cl).toEqual({ invoices: 2, taxable: 200000 });
    expect(j.b2cl[0].pos).toBe('32');
  });

  it('B2CS (7): other consumer sales by state and rate, less the walk-in return', () => {
    // 10,000 + 2,000 + 500 + 25,000 + 11,250 + 28,500 + 15,000 (TN) + 50,000 (KL) − 25,000 (return) = 1,17,250
    expect(g.b2cs).toEqual({ taxable: 117250, tax: 20785 });
    const tn28 = j.b2cs.find((x: any) => x.pos === '33' && x.rt === 28);
    expect(tn28).toMatchObject({ txval: 0, camt: 0, samt: 0 }); // 25,000 sold, 25,000 returned
    expect(j.b2cs.find((x: any) => x.pos === '32' && x.rt === 18)).toMatchObject({ sply_ty: 'INTER', txval: 50000, iamt: 9000 });
  });

  it('credit notes: registered → CDNR (9B); against a large inter-state consumer bill → CDNUR', () => {
    expect(g.cdnr.notes).toBe(1);
    expect(j.cdnr[0].nt[0].itms[0].itm_det).toMatchObject({ txval: 10000, rt: 18, camt: 900, samt: 900 });
    expect(g.cdnur).toEqual({ notes: 1, taxable: 25000 });
    expect(j.cdnur[0]).toMatchObject({ typ: 'B2CL', pos: '32' });
    expect(j.cdnur[0].itms[0].itm_det).toMatchObject({ txval: 25000, rt: 28, iamt: 7000 });
  });

  it('nil-rated and non-GST (8), net of the returned vegetables', () => {
    const nil = Object.fromEntries(g.nil.map((n: any) => [n.sply_ty, { nil: n.nil_amt, expt: n.expt_amt }]));
    expect(nil).toEqual({
      INTRAB2B: { nil: 600, expt: 0 }, // 800 sold − 200 returned
      INTRB2B: { nil: 2000, expt: 0 },
      INTRAB2C: { nil: 400, expt: 500 }, // the bill of supply is non-GST
      INTRB2C: { nil: 200, expt: 0 },
    });
  });

  it('documents issued (13): 23 invoices with 1 cancelled, 4 credit notes', () => {
    expect(g.docs.invoices).toMatchObject({ totnum: 23, cancel: 1, net_issue: 22 });
    expect(g.docs.creditNotes).toMatchObject({ totnum: 4, cancel: 0 });
  });

  it('HSN summary (12), net of credit notes, matches the HSN report', async () => {
    const hsn = (await owner.get(`/api/shop/gst/hsn?from=${PERIOD}-01&to=${PERIOD}-31`)).body;
    const row = (code: string, rate: number) => hsn.find((h: any) => h.hsn === code && h.rate === rate);
    expect(row('8471', 18)).toMatchObject({ qty: 21, taxable: 209000, igst: 32400, cgst: 2610, sgst: 2610 });
    expect(row('8528', 28)).toMatchObject({ qty: 6, taxable: 150000, igst: 35000, cgst: 3500, sgst: 3500 });
    expect(row('4802', 12)).toMatchObject({ qty: 39, taxable: 18750, igst: 1200, cgst: 525, sgst: 525 });
    expect(row('1006', 5)).toMatchObject({ qty: 150, taxable: 7500, igst: 100, cgst: 137.5, sgst: 137.5 });
    expect(row('1006', 0)).toMatchObject({ qty: 10, taxable: 500 });
    expect(row('0701', 0)).toMatchObject({ qty: 80, taxable: 3200 });
    expect(row('998314', 18)).toMatchObject({ qty: 4, taxable: 58500, cgst: 5265, sgst: 5265 });
    const jh = j.hsn.data.find((h: any) => h.hsn_sc === '8471');
    expect(jh).toMatchObject({ qty: 21, txval: 209000, rt: 18 });
  });
});

describe('GSTR-3B', () => {
  it('3.1(a) outward taxable, 3.1(c) nil/exempt and 3.2 inter-state consumer sales match the hand totals', async () => {
    const r = (await owner.get(`/api/shop/gst/gstr3b?period=${PERIOD}`)).body;
    expect(r.sup_details.osup_det).toEqual({ txval: 443750, iamt: 68700, camt: 12037.5, samt: 12037.5 });
    expect(r.sup_details.osup_nil_exmp.txval).toBe(3700);
    // Kerala: 50,000 + 1,00,000 + 1,00,000 − 25,000 returned = 2,25,000; IGST 9,000 + 28,000 + 18,000 − 7,000
    expect(r.inter_sup.unreg_details).toEqual([{ pos: '32-Kerala', txval: 225000, iamt: 48000 }]);
  });

  it('the return agrees with the invoices: tax on issued bills less credit notes', async () => {
    const shop = (await query("SELECT shop_id FROM users WHERE email = 'owner@shop.com'"))[0].shop_id;
    const [i] = await query(`SELECT sum(cgst)::float AS c, sum(sgst)::float AS s, sum(igst)::float AS g FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND date BETWEEN '2025-05-01' AND '2025-05-31'`, [shop]);
    const [n] = await query(`SELECT sum(cgst)::float AS c, sum(sgst)::float AS s, sum(igst)::float AS g FROM credit_notes WHERE shop_id = $1 AND date BETWEEN '2025-05-01' AND '2025-05-31'`, [shop]);
    const r = (await owner.get(`/api/shop/gst/gstr3b?period=${PERIOD}`)).body.sup_details.osup_det;
    expect(r.camt).toBeCloseTo(i.c - n.c, 2);
    expect(r.samt).toBeCloseTo(i.s - n.s, 2);
    expect(r.iamt).toBeCloseTo(i.g - n.g, 2);
  });

  it('tax payable follows the set-off order of the law, paying the least cash', () => {
    // IGST credit 80,000 pays IGST 68,700; the 11,300 left covers CGST (12,037.50 less own credit 1,000 = 11,037.50)
    // and 262.50 of SGST; SGST credit 500 pays SGST too, leaving 11,275 SGST in cash.
    expect(setOff({ iamt: 68700, camt: 12037.5, samt: 12037.5 }, { iamt: 80000, camt: 1000, samt: 500 }))
      .toEqual({ payable: { iamt: 0, camt: 0, samt: 11275 }, carryForward: { iamt: 0, camt: 0, samt: 0 } });
    // CGST/SGST credit left after their own head pays IGST; CGST credit never pays SGST.
    expect(setOff({ iamt: 1000, camt: 100, samt: 500 }, { iamt: 0, camt: 700, samt: 0 }))
      .toEqual({ payable: { iamt: 400, camt: 0, samt: 500 }, carryForward: { iamt: 0, camt: 0, samt: 0 } });
    expect(setOff({ iamt: 0, camt: 100, samt: 100 }, { iamt: 50, camt: 300, samt: 0 }))
      .toEqual({ payable: { iamt: 0, camt: 0, samt: 50 }, carryForward: { iamt: 0, camt: 200, samt: 0 } });
  });
});
