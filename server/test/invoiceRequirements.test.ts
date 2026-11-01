import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db';
import { pdfName } from '../src/routes/shop/sales';
import { app, freshDb, login, today } from './helpers';

/* Checks against the Invoice Design Requirements: CMP-14/15, TRD, FUN-04, FUN-11/TEC-05, OUT-06, NFR-04. */

type Client = Awaited<ReturnType<typeof login>>;
let owner: Client;
let customerId: string;
let itemId: string;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  itemId = (await owner.get('/api/shop/items')).body.find((i: any) => i.sku === 'SD-64U3').id;
  customerId = (await owner.get('/api/shop/customers')).body.find((c: any) => c.companyName === 'Nila Textiles').id;
});

const issue = (over: Record<string, unknown> = {}) =>
  owner.post('/api/shop/invoices').send({ customerId, date: today(), dueDate: today(), lines: [{ itemId, qty: 1, tier: 'SP1', discount: 0 }], withGst: true, issue: true, ...over });
const printData = async (id: string) => (await owner.get(`/api/shop/invoices/${id}/print-data`)).body;

describe('reprints match the original (FUN-11, TEC-05)', () => {
  it('an issued invoice keeps its business details and layout after the profile and print settings change', async () => {
    const inv = (await issue()).body;
    const before = await printData(inv.id);
    expect(before.snapshotAt).toBeTruthy();

    const org = (await owner.get('/api/shop/organization')).body;
    const ps = (await owner.get('/api/shop/print-settings')).body;
    await owner.put('/api/shop/organization').send({ ...org, address: 'New address, Madurai', companyName: 'Renamed Store' });
    await owner.put('/api/shop/print-settings').send({ ...ps, invoice: { ...ps.invoice, color: '#123456', terms: 'Changed terms' } });

    const after = await printData(inv.id);
    expect(after.org).toEqual(before.org);
    expect(after.settings.invoice).toEqual(before.settings.invoice);
    // a draft (and every new invoice) uses the new details
    const draft = (await issue({ issue: false })).body;
    const d = await printData(draft.id);
    expect(d.org.companyName).toBe('Renamed Store');
    expect(d.settings.invoice.color).toBe('#123456');
    expect(d.snapshotAt).toBeNull();
    await owner.put('/api/shop/organization').send(org); // put the demo profile back
  });

  it('every issued invoice in the demo data has its snapshot', async () => {
    const shopId = owner.me.shop.id;
    const [{ n }] = await withTenant(shopId, async (db) => (await db.query("SELECT count(*)::int AS n FROM invoices WHERE shop_id = $1 AND status <> 'Draft' AND print_snapshot IS NULL", [shopId])).rows);
    expect(n).toBe(0);
  });
});

describe('fields GST requires cannot be hidden (CMP-14, CUS-08)', () => {
  it('turning off HSN, unit, place of supply, signature or e-invoice is ignored', async () => {
    const ps = (await owner.get('/api/shop/print-settings')).body;
    const off = { ...ps.invoice.fields, hsn: false, unit: false, placeOfSupply: false, signature: false, eInvoice: false, discount: false };
    const saved = (await owner.put('/api/shop/print-settings').send({ ...ps, invoice: { ...ps.invoice, fields: off } })).body;
    expect(saved.invoice.fields).toMatchObject({ hsn: true, unit: true, placeOfSupply: true, signature: true, eInvoice: true, discount: false });
    expect((await owner.get('/api/shop/print-settings')).body.invoice.fields.hsn).toBe(true);
  });
});

describe('trade details on the bill (CMP-15, TRD-01 to 06)', () => {
  it('a pharmacy bill carries the drug licence, each medicine’s schedule, manufacturer and MRP, and the patient and doctor', async () => {
    await owner.post('/api/shop/organization/business-type').send({ key: 'pharmacy', samples: false, printLayout: true });
    const org = (await owner.get('/api/shop/organization')).body;
    await owner.put('/api/shop/organization').send({ ...org, tradeDetails: { drugLicence: 'TN-CH-20-12345' } });
    const med = (await owner.post('/api/shop/items').send({ type: 'Goods', name: 'Dolo 650', unit: 'strip', hsn: '3004', cost: 20, sp1: 30, sp2: 30, sp3: 30, mrp: 33.5, taxSlabId: 'tax_5',
      extra: { manufacturer: 'Micro Labs', schedule: 'H', composition: 'Paracetamol 650 mg' } })).body;
    await withTenant(owner.me.shop.id, (db) => db.query('SELECT 1')); // keep the pool warm
    await owner.post(`/api/shop/items/${med.id}/adjust`).send({ branchId: owner.me.user.branchId, qty: 50, note: 'Opening', batchNo: 'B1', expiryDate: '2027-12-31' });
    const inv = (await issue({ lines: [{ itemId: med.id, qty: 2, tier: 'SP1', discount: 0 }], extra: { patientName: 'Lakshmi R', doctorName: 'Dr. Prakash', junk: 'x' } })).body;
    expect(inv.extra).toEqual({ patientName: 'Lakshmi R', doctorName: 'Dr. Prakash' });
    expect(inv.lines[0].extra).toMatchObject({ manufacturer: 'Micro Labs', schedule: 'H' });
    expect(inv.lines[0].mrp).toBe(33.5);
    const p = await printData(inv.id);
    expect(p.org.tradeDetails).toEqual([{ label: 'Drug licence number(s)', value: 'TN-CH-20-12345' }]);
    expect(p.itemFields.find((f: { key: string }) => f.key === 'schedule').print).toBe(true);
    expect(p.invoiceFields.map((f: { key: string }) => f.key)).toEqual(['patientName', 'doctorName']);
    expect(p.settings.invoice.fields.mrp).toBe(true); // the pharmacy layout prints MRP
  });
});

describe('previous balance for credit customers (FUN-04)', () => {
  it('the bill records what the customer already owed when it was issued', async () => {
    const shopId = owner.me.shop.id;
    const [{ open }] = await withTenant(shopId, async (db) => (await db.query(
      "SELECT coalesce(sum(GREATEST(total - amount_paid - amount_credited, 0)), 0) AS open FROM invoices WHERE shop_id = $1 AND customer_id = $2 AND status = 'Issued'", [shopId, customerId])).rows);
    const inv = (await issue()).body;
    const p = await printData(inv.id);
    expect(p.previousBalance).toBeCloseTo(Number(open), 2);
    // paying the new invoice later does not change what was printed
    await owner.post(`/api/shop/invoices/${inv.id}/payments`).send({ amount: inv.total, date: today(), mode: 'Cash' });
    expect((await printData(inv.id)).previousBalance).toBeCloseTo(Number(open), 2);
  });
});

describe('share links can be turned off (NFR-04) and PDFs are named clearly (OUT-06)', () => {
  it('renewing the link stops the old one and the new one works', async () => {
    const inv = (await issue()).body;
    const old = inv.publicToken;
    expect((await request(app).get(`/api/public/invoices/${old}`)).status).toBe(200);
    const r = await owner.post(`/api/shop/invoices/${inv.id}/share-link/renew`).send({});
    expect(r.status).toBe(200);
    expect(r.body.publicToken).not.toBe(old);
    expect((await request(app).get(`/api/public/invoices/${old}`)).status).toBe(404);
    expect((await request(app).get(`/api/public/invoices/${r.body.publicToken}`)).status).toBe(200);
    const staff = await login('warehouse@shop.com', 'warehouse123');
    expect((await staff.post(`/api/shop/invoices/${inv.id}/share-link/renew`).send({})).status).toBe(403);
  });

  it('the PDF file name has the invoice number and the customer', () => {
    expect(pdfName({ number: 'INV-2026-27-0012', status: 'Issued', customer: { name: 'Ravi', companyName: 'BrightPath Academy' } })).toBe('INV-2026-27-0012-BrightPath-Academy.pdf');
    expect(pdfName({ number: null, status: 'Draft', customer: { name: 'Walk-in' } })).toBe('draft-invoice-Walk-in.pdf');
  });
});
