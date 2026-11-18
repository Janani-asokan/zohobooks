import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, freshDb, login, today } from './helpers';
import { runLicenseJob } from '../src/services/licenses';
import { query } from '../src/db';
import { addDays } from '../../shared/licenses';

let owner: Awaited<ReturnType<typeof login>>;
let sales: Awaited<ReturnType<typeof login>>;
let compliance: Awaited<ReturnType<typeof login>>;
let wh: string;          // the licensed warehouse
let svc: any;            // a service item (storage charge)
let goods: any;          // a goods item
let customer: any;
const csrf = { 'X-Requested-With': 'ledgerly' };

const bill = (extra: Record<string, unknown> = {}, lines: unknown[] = [{ itemId: svc.id, qty: 1, rate: 1000 }]) =>
  ({ customerId: customer.id, date: today(), dueDate: today(), withGst: true, issue: true, branchId: wh, lines, ...extra });

const newLicense = (b: Record<string, unknown>) => owner.post('/api/shop/licenses').send({
  branchId: wh, issueDate: addDays(today(), -300), expiryDate: addDays(today(), 200), ...b,
});

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  sales = await login('sales@shop.com', 'sales123');
  const items = (await owner.get('/api/shop/items')).body;
  svc = items.find((i: any) => i.sku === 'SRV-AMC');
  goods = items.find((i: any) => i.sku === 'SD-64U3');
  customer = (await owner.get('/api/shop/customers')).body.find((c: any) => c.companyName === 'Nila Textiles');
  const b = await owner.post('/api/shop/branches').send({ name: 'Cold Store, Ambattur', address: 'Plot 4, Ambattur', phone: '' });
  expect(b.status, JSON.stringify(b.body)).toBeLessThan(300);
  wh = b.body.id;
  const u = await owner.post('/api/shop/staff').send({ name: 'Kavya Compliance', email: 'kavya@shop.com', role: 'Compliance Manager', branchId: null, password: 'Comply#2026' });
  expect(u.status, JSON.stringify(u.body)).toBeLessThan(300);
  compliance = await login('kavya@shop.com', 'Comply#2026');
  // Staff the owner creates choose their own password before anything else.
  expect((await compliance.post('/api/auth/change-password').send({ current: 'Comply#2026', next: 'KavyaOwn#2026' })).status).toBe(200);
});

describe('warehouse licences', () => {
  let fssai: any;

  it('creates a regulatory licence, validates it, and prints its number on invoices', async () => {
    expect((await newLicense({ licenseType: 'regulatory', licenseNumber: 'X1' })).status).toBe(400); // kind missing
    expect((await newLicense({ licenseType: 'regulatory', regulatoryKind: 'fssai', licenseNumber: 'X1', documentUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await sales.post('/api/shop/licenses').send({})).status).toBe(403);
    const r = await newLicense({ licenseType: 'regulatory', regulatoryKind: 'fssai', licenseNumber: '12423008000123', issuingAuthority: 'FSSAI Tamil Nadu', graceDays: 0, enforceScope: 'all' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('active');
    fssai = r.body;
    expect((await newLicense({ licenseType: 'regulatory', regulatoryKind: 'fssai', licenseNumber: '12423008000123' })).status).toBe(409); // duplicate

    const inv = await owner.post('/api/shop/invoices').send(bill());
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    const pd = await owner.get(`/api/shop/invoices/${inv.body.id}/print-data`);
    expect(pd.body.org.tradeDetails).toContainEqual({ label: 'FSSAI Lic. No.', value: '12423008000123' });
  });

  it('blocks invoices once the licence expires, even back-dated ones, until a documented override', async () => {
    // Expired yesterday, no grace.
    await query('UPDATE warehouse_licenses SET issue_date = $2, term_start = $2, expiry_date = $3 WHERE id = $1', [fssai.id, addDays(today(), -400), addDays(today(), -1)]);
    const blocked = await owner.post('/api/shop/invoices').send(bill());
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('license_blocked');
    expect(blocked.body.details.licenses[0]).toMatchObject({ licenseNumber: '12423008000123', status: 'expired' });
    // Dating the invoice inside the licence's validity doesn't get round it.
    expect((await owner.post('/api/shop/invoices').send(bill({ date: addDays(today(), -5), dueDate: addDays(today(), -5) }))).body.code).toBe('license_blocked');
    // Drafts can still be prepared.
    expect((await owner.post('/api/shop/invoices').send(bill({ issue: false }))).status).toBe(200);
    // Sales staff can't override; a short reason is refused; the owner with a reason can.
    expect((await sales.post('/api/shop/invoices').send(bill({ licenseOverride: { reason: 'Customer is waiting at the counter' } }))).status).toBe(403);
    expect((await owner.post('/api/shop/invoices').send(bill({ licenseOverride: { reason: 'ok' } }))).body.code).toBe('license_override_reason');
    const ok = await owner.post('/api/shop/invoices').send(bill({ licenseOverride: { reason: 'Renewal filed on 10 Nov, acknowledgement 4471' } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // On record: the override, the invoice it was used for, and the licence status then.
    const d = (await owner.get(`/api/shop/licenses/${fssai.id}`)).body;
    expect(d.overrides[0]).toMatchObject({ kind: 'invoice_override', invoiceId: ok.body.id, grantedBy: 'Aravind Kumar' });
    expect(d.invoices.find((i: any) => i.id === ok.body.id)).toMatchObject({ statusAtIssue: 'expired', overridden: true });
    // An expired number is not printed on the tax invoice.
    expect((await owner.get(`/api/shop/invoices/${ok.body.id}/print-data`)).body.org.tradeDetails.some((t: any) => t.value === '12423008000123')).toBe(false);
  });

  it('lets a Compliance Manager grant a grace period with a reason, which re-opens billing with a warning', async () => {
    expect((await sales.post(`/api/shop/licenses/${fssai.id}/grace`).send({ days: 10, reason: 'Renewal applied for' })).status).toBe(403);
    expect((await compliance.post(`/api/shop/licenses/${fssai.id}/grace`).send({ days: 10, reason: 'short' })).status).toBe(400);
    const g = await compliance.post(`/api/shop/licenses/${fssai.id}/grace`).send({ days: 10, reason: 'Renewal applied for, ARN 77812 dated 12 Nov' });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    expect(g.body).toMatchObject({ status: 'grace', extraGraceDays: 10 });
    const inv = await sales.post('/api/shop/invoices').send(bill());
    expect(inv.status).toBe(200);
    expect(inv.body.licenseWarnings[0]).toMatchObject({ status: 'grace' });
  });

  it('blocks a suspended licence whatever its dates, and renewing gives a fresh term', async () => {
    const ren = await owner.post(`/api/shop/licenses/${fssai.id}/renew`).send({ expiryDate: addDays(today(), 364), licenseNumber: '12423008000999' });
    expect(ren.status, JSON.stringify(ren.body)).toBe(200);
    expect(ren.body).toMatchObject({ status: 'active', extraGraceDays: 0, licenseNumber: '12423008000999' }); // old extension retired
    expect((await compliance.post(`/api/shop/licenses/${fssai.id}/suspend`).send({ reason: 'Fire inspection failed on 15 Nov' })).body.status).toBe('suspended');
    expect((await owner.post('/api/shop/invoices').send(bill())).body.code).toBe('license_blocked');
    expect((await compliance.post(`/api/shop/licenses/${fssai.id}/reinstate`).send({ reason: 'Re-inspection passed on 17 Nov' })).body.status).toBe('active');
    expect((await owner.post('/api/shop/invoices').send(bill())).status).toBe(200);
  });

  it('only gates the invoices in its scope: a service-only licence leaves goods sales alone', async () => {
    const r = await newLicense({ licenseType: 'regulatory', regulatoryKind: 'bonded_warehouse', licenseNumber: 'BOND/CHN/2026/88', expiryDate: addDays(today(), 200) });
    await query('UPDATE warehouse_licenses SET issue_date = $2, term_start = $2, expiry_date = $3 WHERE id = $1', [r.body.id, addDays(today(), -400), addDays(today(), -30)]);
    // The new warehouse needs the goods in stock to sell them (sales can't exceed branch stock).
    expect((await owner.post(`/api/shop/items/${goods.id}/adjust`).send({ branchId: wh, qty: 5, note: 'Opening at Cold Store' })).status).toBe(200);
    expect((await owner.post('/api/shop/invoices').send(bill({}, [{ itemId: goods.id, qty: 1 }]))).status).toBe(200);
    expect((await owner.post('/api/shop/invoices').send(bill())).body.code).toBe('license_blocked');
    // Another warehouse isn't affected.
    expect((await owner.post('/api/shop/invoices').send(bill({ branchId: null }))).status).toBe(200);
    await owner.patch(`/api/shop/licenses/${r.body.id}`).send({ enforceScope: 'none' });
  });

  let cap: any;
  it('bills usage above a capacity licence as overage, or stops it', async () => {
    const r = await newLicense({
      licenseType: 'storage_capacity', licenseNumber: 'SC-NILA-01', customerId: customer.id, maxCapacity: 100, capacityUnit: 'pallets',
      usageItemId: svc.id, overageRate: 75, renewalItemId: svc.id, renewalPrice: 36500, issueDate: addDays(today(), -100), expiryDate: addDays(today(), 264),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    cap = r.body;
    const usage = [{ itemId: svc.id, qty: 80, rate: 50 }, { itemId: svc.id, qty: 45, rate: 50 }];
    const stop = await owner.post('/api/shop/invoices').send(bill({}, usage));
    expect(stop.status).toBe(409);
    expect(stop.body.code).toBe('license_capacity');
    expect(stop.body.details.capacity[0]).toMatchObject({ billed: 125, licensed: 100, excess: 25, overageAmount: 1875, suggestedCapacity: 130 });
    // The same answer from the check the form calls, without saving anything.
    const pre = await owner.post('/api/shop/licenses/check-invoice').send({ branchId: wh, customerId: customer.id, date: today(), lines: usage });
    expect(pre.body).toMatchObject({ ok: false, code: 'license_capacity' });
    const billed = await owner.post('/api/shop/invoices').send(bill({ licenseOverage: 'bill' }, usage));
    expect(billed.status, JSON.stringify(billed.body)).toBe(200);
    expect(billed.body.lines.map((l: any) => [l.qty, l.rate])).toEqual([[80, 50], [20, 50], [25, 75]]);
    expect(billed.body.subTotal).toBe(100 * 50 + 25 * 75);
    expect((await sales.post('/api/shop/invoices').send(bill({ licenseOverage: 'allow', licenseOverride: { reason: 'Free extra space this month' } }, usage))).status).toBe(403);
    // Another client's invoice isn't measured against this client's licence.
    const other = (await owner.get('/api/shop/customers')).body.find((c: any) => c.id !== customer.id);
    expect((await owner.post('/api/shop/invoices').send(bill({ customerId: other.id }, usage))).status).toBe(200);
  });

  it('prorates a mid-term upgrade into a draft invoice and a downgrade into credit for the next renewal', async () => {
    const lic = (await owner.get(`/api/shop/licenses/${cap.id}`)).body.license;
    const up = await owner.post(`/api/shop/licenses/${cap.id}/change-capacity`).send({ newCapacity: 150, reason: 'Client needs one more rack row' });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const totalDays = lic.expiryDate && (Date.parse(lic.expiryDate) - Date.parse(lic.termStart)) / 864e5 + 1;
    const days = (Date.parse(lic.expiryDate) - Date.parse(today())) / 864e5 + 1;
    expect(up.body.proration).toMatchObject({ direction: 'charge', newPrice: 54750, days, totalDays });
    expect(up.body.proration.amount).toBeCloseTo((18250 * days) / totalDays, 2);
    const inv = (await owner.get(`/api/shop/invoices/${up.body.invoice.id}`)).body;
    expect(inv).toMatchObject({ status: 'Draft', subTotal: up.body.proration.amount });
    expect(inv.taxTotal).toBeCloseTo(up.body.proration.amount * 0.18, 1); // the service's 18 % GST on the prorated value
    const down = await owner.post(`/api/shop/licenses/${cap.id}/change-capacity`).send({ newCapacity: 120, reason: 'Client gave back 30 pallets' });
    expect(down.body.proration.direction).toBe('credit');
    expect(down.body.license.creditBalance).toBeCloseTo(down.body.proration.amount, 2);
    expect(down.body.license.maxCapacity).toBe(120);
  });

  it('daily job: sends each reminder once, saves status changes and makes one renewal invoice with the credit', async () => {
    await owner.patch(`/api/shop/licenses/${cap.id}`).send({ autoRenewalInvoice: true });
    const lic = (await owner.get(`/api/shop/licenses/${cap.id}`)).body.license;
    const day = addDays(lic.expiryDate, -29); // inside the 30-day window and the 30-day reminder
    const first = await runLicenseJob(day);
    expect(first.renewals).toBeGreaterThanOrEqual(1);
    const again = await runLicenseJob(day);
    expect(again).toMatchObject({ alerts: 0, renewals: 0 });
    const alerts = (await owner.get(`/api/shop/licenses/${cap.id}`)).body.alerts;
    expect(alerts.map((a: any) => a.threshold)).toEqual([30]);
    const [row] = await query("SELECT id, bill_discount, lines FROM invoices WHERE customer_id = $1 AND lines->0->>'note' LIKE 'Renewal of licence SC-NILA-01%'", [customer.id]);
    expect(row.bill_discount).toMatchObject({ kind: 'amount', value: lic.creditBalance });
    expect((await owner.get(`/api/shop/licenses/${cap.id}`)).body.license.creditBalance).toBe(0);
    const [{ status }] = await query('SELECT status FROM warehouse_licenses WHERE id = $1', [cap.id]);
    expect(status).toBe('expiring_soon');
  });

  it('keeps licences to their shop and shows them in the bell', async () => {
    const other = request.agent(app);
    await other.post('/api/auth/signup').set(csrf).send({ shopName: 'Second Shop', ownerName: 'Lakshmi R', email: 'second@example.com', phone: '9000012345', password: 'Second#2026' });
    expect((await other.get(`/api/shop/licenses/${cap.id}`).set(csrf)).status).toBe(404);
    expect((await other.get('/api/shop/licenses').set(csrf)).body.licenses).toEqual([]);
    expect((await other.post('/api/shop/licenses').set(csrf).send({ branchId: wh, licenseType: 'regulatory', regulatoryKind: 'fssai', licenseNumber: 'Z9', issueDate: today(), expiryDate: addDays(today(), 10) })).status).toBe(400);
    const bell = (await compliance.get('/api/shop/notifications')).body;
    expect(bell.some((n: any) => n.kind.startsWith('wh_license'))).toBe(true);
    // A licence that invoices were checked against can't be deleted.
    expect((await owner.del(`/api/shop/licenses/${fssai.id}`)).status).toBe(409);
  });
});
