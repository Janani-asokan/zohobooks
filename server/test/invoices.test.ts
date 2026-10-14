import { beforeAll, describe, expect, it } from 'vitest';
import { query, withTenant } from '../src/db';
import { runRecurring } from '../src/jobs';
import { freshDb, login, today } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
let items: any[];
let customers: any[];
const goods = () => items.find((i) => i.sku === 'SD-64U3');
const biz = () => customers.find((c) => c.companyName === 'Nila Textiles');
const walkin = () => customers.find((c) => c.name === 'Karthik Subramanian');

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  items = (await owner.get('/api/shop/items')).body;
  customers = (await owner.get('/api/shop/customers')).body;
});

const newInvoice = (over: Record<string, unknown> = {}) =>
  owner.post('/api/shop/invoices').send({ customerId: walkin().id, date: today(), dueDate: today(), lines: [{ itemId: goods().id, qty: 1, tier: 'SP1' }], withGst: true, ...over });

describe('invoice numbering', () => {
  it('assigns unique consecutive numbers under concurrency', async () => {
    const before = (await owner.get(`/api/shop/invoices/next-number?date=${today()}`)).body.number as string;
    const start = Number(before.slice(-4));
    const results = await Promise.all(Array.from({ length: 10 }, () => newInvoice()));
    const nums = results.map((r) => { expect(r.status).toBe(200); return Number(r.body.number.slice(-4)); }).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 10 }, (_, i) => start + i));
  });

  it('restarts at 0001 in a new financial year', async () => {
    const res = await newInvoice({ date: '2027-04-02', dueDate: '2027-04-10' });
    expect(res.body.number).toBe('INV-2027-28-0001');
    expect(res.body.fy).toBe('2027-28');
  });

  it('continues across years when auto-reset is off', async () => {
    const sa = await login('admin@ledgerly.in', 'admin123');
    await sa.put('/api/platform/config').send({ autoResetInvoiceNumbering: false });
    const a = await newInvoice();
    const b = await newInvoice({ date: '2027-05-01', dueDate: '2027-05-01' });
    expect(a.body.number).toBe('INV-0001');
    expect(b.body.number).toBe('INV-0002');
    await sa.put('/api/platform/config').send({ autoResetInvoiceNumbering: true });
  });

  it('drafts get no number until issued, and only drafts can be deleted', async () => {
    const d = await newInvoice({ issue: false });
    expect(d.body.number).toBeNull();
    expect(d.body.status).toBe('Draft');
    const issued = await newInvoice();
    expect((await owner.del(`/api/shop/invoices/${issued.body.id}`)).status).toBe(409);
    expect((await owner.del(`/api/shop/invoices/${d.body.id}`)).status).toBe(200);
  });
});

describe('totals, tax treatment and stock', () => {
  it('computes totals on the server, ignoring any client-sent totals', async () => {
    const res = await newInvoice({ lines: [{ itemId: goods().id, qty: 2, tier: 'SP1' }], total: 1 });
    // 2 × 599 = 1198 + 18% = 1413.64 → 1414
    expect(res.body.subTotal).toBe(1198);
    expect(res.body.cgst).toBe(107.82);
    expect(res.body.total).toBe(1414);
    expect(res.body.docType).toBe('TAX INVOICE');
  });

  it('uses IGST for an inter-state customer', async () => {
    const kerala = customers.find((c) => c.state === 'Kerala');
    const res = await newInvoice({ customerId: kerala.id });
    expect(res.body.interState).toBe(true);
    expect(res.body.igst).toBeGreaterThan(0);
    expect(res.body.cgst).toBe(0);
  });

  it('net mode issues an INVOICE without tax; composition shops issue a Bill of Supply', async () => {
    const net = await newInvoice({ withGst: false });
    expect(net.body.taxTotal).toBe(0);
    expect(net.body.docType).toBe('INVOICE');
    const org = (await owner.get('/api/shop/organization')).body;
    await owner.put('/api/shop/organization').send({ ...org, compositionScheme: true });
    const bos = await newInvoice({ withGst: true });
    expect(bos.body.docType).toBe('BILL OF SUPPLY');
    expect(bos.body.taxTotal).toBe(0);
    await owner.put('/api/shop/organization').send({ ...org, compositionScheme: false });
  });

  it('deducts stock on issue and restores it on cancel', async () => {
    const stock = async () => (await owner.get('/api/shop/items')).body.find((i: any) => i.id === goods().id).stock;
    const s0 = await stock();
    const inv = (await newInvoice({ lines: [{ itemId: goods().id, qty: 3 }] })).body;
    expect(await stock()).toBe(s0 - 3);
    const c = await owner.post(`/api/shop/invoices/${inv.id}/cancel`).send({ reason: 'Customer changed mind' });
    expect(c.body.status).toBe('Cancelled');
    expect(await stock()).toBe(s0);
  });

  it('records reverse charge and TCS', async () => {
    const res = await newInvoice({ customerId: biz().id, reverseCharge: true, tcsRate: 0.1 });
    expect(res.body.reverseCharge).toBe(true);
    expect(res.body.tcs).toBeGreaterThan(0);
  });
});

describe('payments and credit notes', () => {
  it('supports partial payments with TDS, and refuses overpayment', async () => {
    const inv = (await newInvoice({ customerId: biz().id, lines: [{ itemId: goods().id, qty: 10 }] })).body;
    const p1 = await owner.post(`/api/shop/invoices/${inv.id}/payments`).send({ amount: 3000, tdsAmount: 100, mode: 'UPI', reference: 'UPI123' });
    expect(p1.body.paymentStatus).toBe('Partially Paid');
    expect(p1.body.balance).toBe(inv.total - 3100);
    expect((await owner.post(`/api/shop/invoices/${inv.id}/payments`).send({ amount: inv.total, mode: 'Cash' })).status).toBe(400);
    const p2 = await owner.post(`/api/shop/invoices/${inv.id}/payments`).send({ amount: inv.total - 3100, mode: 'Cash' });
    expect(p2.body.paymentStatus).toBe('Paid');
    // can't cancel a paid invoice
    expect((await owner.post(`/api/shop/invoices/${inv.id}/cancel`).send({ reason: 'nope nope' })).status).toBe(409);
  });

  it('limits credit notes to the invoiced quantity and restocks returns', async () => {
    const inv = (await newInvoice({ lines: [{ itemId: goods().id, qty: 4 }] })).body;
    const line = inv.lines[0].id;
    const cn = await owner.post('/api/shop/credit-notes').send({ invoiceId: inv.id, date: today(), reason: 'Sales return', lines: [{ lineId: line, qty: 3 }] });
    expect(cn.status).toBe(200);
    expect(cn.body.number).toMatch(/^CN-/);
    const again = await owner.post('/api/shop/credit-notes').send({ invoiceId: inv.id, date: today(), reason: 'Sales return', lines: [{ lineId: line, qty: 2 }] });
    expect(again.status).toBe(400);
    const after = (await owner.get(`/api/shop/invoices/${inv.id}`)).body;
    expect(after.amountCredited).toBe(cn.body.total);
    expect(after.creditNotes).toHaveLength(1);
  });

  it('POS sale issues and settles in one step', async () => {
    const res = await owner.post('/api/shop/pos/sale').send({ customerId: null, lines: [{ itemId: goods().id, qty: 1 }], withGst: true, mode: 'Cash', tendered: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.invoice.paymentStatus).toBe('Paid');
    expect(res.body.invoice.customer.name).toBe('Walk-in Customer');
    expect(res.body.change).toBe(1000 - res.body.invoice.total);
  });
});

describe('plans, recurring and public links', () => {
  it('enforces the branch limit of the plan', async () => {
    await query("UPDATE shops SET plan_id = 'standard' WHERE email = 'owner@shop.com'"); // standard = 2 branches, demo already has 2
    const res = await owner.post('/api/shop/branches').send({ name: 'Third' });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('plan_limit');
    await query("UPDATE shops SET plan_id = 'premium' WHERE email = 'owner@shop.com'");
  });

  it('generates due recurring invoices', async () => {
    // RLS: tenant tables can only be touched inside that shop's context
    await withTenant(owner.me.shop.id, (db) => db.query("UPDATE recurring_profiles SET next_date = current_date - 1"));
    const before = (await owner.get('/api/shop/invoices')).body.filter((i: any) => i.source === 'recurring').length;
    await runRecurring();
    const after = (await owner.get('/api/shop/invoices')).body.filter((i: any) => i.source === 'recurring');
    expect(after.length).toBe(before + 1);
    expect(after[0].status).toBe('Issued');
    const rec = (await owner.get('/api/shop/recurring')).body[0];
    expect(rec.nextDate > today()).toBe(true);
  });

  it('serves issued invoices on a public link without login', async () => {
    const inv = (await newInvoice()).body;
    const { default: request } = await import('supertest');
    const { app } = await import('./helpers');
    const res = await request(app).get(`/api/public/invoices/${inv.publicToken}`);
    expect(res.status).toBe(200);
    expect(res.body.invoice.number).toBe(inv.number);
    expect(res.body.org.upiId).toBe('aravindstore@okhdfcbank');
    expect((await request(app).get('/api/public/invoices/' + 'a'.repeat(36))).status).toBe(404);
  });
});
