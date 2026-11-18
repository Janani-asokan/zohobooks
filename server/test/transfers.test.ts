import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, freshDb, login, today } from './helpers';
import { devOutbox } from '../src/mailer';
import { query } from '../src/db';

let owner: Awaited<ReturnType<typeof login>>;
let manager: Awaited<ReturnType<typeof login>>;
let sales: Awaited<ReturnType<typeof login>>;
let head: string;       // Branch A
let vel: string;        // Branch B
let apple: any;
const BATCH = 'BATCH-2026-001';
const csrf = { 'X-Requested-With': 'ledgerly' };

/** The newest code mailed for a transfer. */
const codeFor = (number: string) => {
  const m = [...devOutbox()].reverse().find((x) => x.subject.includes(`stock transfer ${number}`));
  expect(m?.subject).not.toMatch(/\d{6}/); // never in the subject (lock screens, logs)
  return { code: /^\s{4}(\d{6})$/m.exec(m?.text ?? '')?.[1] ?? '', to: m?.to };
};
const batchAt = async (branchId: string) => (await owner.get(`/api/shop/stock/batches?itemId=${apple.id}&branchId=${branchId}&all=1`)).body.find((b: any) => b.batchNo === BATCH);
const send = (qty: number, extra: Record<string, unknown> = {}) => owner.post('/api/shop/stock/transfers').send({ fromBranchId: head, toBranchId: vel, lines: [{ itemId: apple.id, batchNo: BATCH, qty }], ...extra });
/** Lets the next code be sent without waiting out the 60-second gap. */
const skipCooldown = (id: string) => query("UPDATE transfer_otps SET created_at = created_at - interval '2 minutes' WHERE transfer_id = $1", [id]);

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  sales = await login('sales@shop.com', 'sales123');
  const branches = (await owner.get('/api/shop/branches')).body;
  head = branches.find((b: any) => b.isPrimary).id;
  vel = branches.find((b: any) => !b.isPrimary).id;
  // Meena manages Branch B and gets its receipt codes.
  const staff = (await owner.get('/api/shop/staff')).body;
  const meena = staff.find((u: any) => u.email === 'manager@shop.com');
  expect((await owner.patch(`/api/shop/staff/${meena.id}`).send({ branchId: vel })).status).toBe(200);
  const b = branches.find((x: any) => x.id === vel);
  expect((await owner.put(`/api/shop/branches/${vel}`).send({ name: b.name, address: b.address, phone: b.phone, managerUserId: meena.id, gstin: '', state: 'Tamil Nadu' })).status).toBe(200);
  manager = await login('manager@shop.com', 'manager123');
  const slab = (await owner.get('/api/shop/tax-slabs')).body.find((s: any) => s.rate === 5).id;
  // 100 apples arrive at Branch A in one batch, bought at ₹40.
  apple = (await owner.post('/api/shop/items').send({ type: 'Goods', name: 'Shimla Apple', unit: 'kg', hsn: '0808', category: 'Fruit', cost: 40, sp1: 60, sp2: 60, sp3: 60,
    taxSlabId: slab, trackBatches: true, openingStock: 100, branchId: head, batchNo: BATCH, expiryDate: '2027-01-31' })).body;
  expect(apple.id).toBeTruthy();
});

describe('inter-branch stock transfers', () => {
  it('keeps the batch purchase cost and prices the stock for the destination', async () => {
    expect(await batchAt(head)).toMatchObject({ qty: 100, unitCost: 40, sellingPrice: 60 });
    const loc = await owner.post('/api/shop/pricing-rules').send({ name: 'Velachery fruit', kind: 'location', branchId: vel, category: 'Fruit', adjustType: 'percent', adjustValue: 20 });
    expect(loc.status, JSON.stringify(loc.body)).toBe(201);
    const season = await owner.post('/api/shop/pricing-rules').send({ name: 'Winter glut', kind: 'seasonal', branchId: null, itemId: apple.id, adjustType: 'percent', adjustValue: -10,
      startsOn: '2026-01-01', endsOn: '2030-12-31' });
    expect(season.status).toBe(201);
    expect((await owner.post('/api/shop/pricing-rules').send({ name: 'Bad', kind: 'seasonal', adjustType: 'percent', adjustValue: 5 })).status).toBe(400);
    const p = await owner.post('/api/shop/transfers/price-preview').send({ fromBranchId: head, toBranchId: vel, lines: [{ itemId: apple.id, batchNo: BATCH, qty: 25 }] });
    // ₹60 × 1.20 (location) × 0.90 (season) = ₹64.80; cost stays ₹40.
    expect(p.body.lines[0]).toMatchObject({ unitCost: 40, sourcePrice: 60, destPrice: 64.8, belowCost: false });
    expect(p.body.lines[0].applied.map((a: any) => a.name)).toEqual(['Velachery fruit', 'Winter glut']);
  });

  it('refuses more than the batch holds, unknown batches and batch items without a batch', async () => {
    const big = await send(150);
    expect(big.status).toBe(400);
    expect(big.body).toMatchObject({ code: 'insufficient_batch_stock', details: { available: 100, requested: 150 } });
    // Two lines of the same batch count together.
    expect((await owner.post('/api/shop/stock/transfers').send({ fromBranchId: head, toBranchId: vel, lines: [{ itemId: apple.id, batchNo: BATCH, qty: 60 }, { itemId: apple.id, batchNo: BATCH, qty: 50 }] })).body.code).toBe('insufficient_batch_stock');
    expect((await owner.post('/api/shop/stock/transfers').send({ fromBranchId: head, toBranchId: vel, lines: [{ itemId: apple.id, batchNo: 'NOPE', qty: 1 }] })).status).toBe(400);
    expect((await owner.post('/api/shop/stock/transfers').send({ fromBranchId: head, toBranchId: vel, lines: [{ itemId: apple.id, qty: 1 }] })).status).toBe(400);
    expect((await send(1, { toBranchId: head })).status).toBe(400);
    expect((await sales.post('/api/shop/stock/transfers').send({ fromBranchId: head, toBranchId: vel, lines: [{ itemId: apple.id, batchNo: BATCH, qty: 1 }] })).status).toBe(403);
    expect((await batchAt(head)).qty).toBe(100);
  });

  let tr: any;
  it('initiating takes stock out of Branch A into transit, not into Branch B, and emails Branch B’s manager a code', async () => {
    const r = await send(25, { ewayBillNo: '', vehicleNo: 'TN 09 AB 1234' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    tr = r.body;
    // Tests run without an email provider: the code goes to the dev outbox and the screen is told it wasn't delivered.
    expect(tr).toMatchObject({ status: 'In transit', otp: { delivered: false, sentTo: 'ma•••••@shop.com' } });
    expect(tr.lines[0]).toMatchObject({ batchNo: BATCH, qty: 25, unitCost: 40, destPrice: 64.8, qtyReceived: null });
    expect((await batchAt(head)).qty).toBe(75);
    expect(await batchAt(vel)).toBeUndefined();
    const mail = codeFor(tr.number);
    expect(mail.to).toBe('manager@shop.com');
    expect(mail.code).toMatch(/^\d{6}$/);
    // The code itself is never stored.
    const [row] = await query('SELECT code_hash FROM transfer_otps WHERE transfer_id = $1', [tr.id]);
    expect(row.code_hash).not.toContain(mail.code);
    expect((await owner.post(`/api/shop/stock/transfers/${tr.id}/receive`).send({})).body.code).toBe('otp_required');
  });

  it('the sender can’t confirm; wrong codes are counted and lock the code after 3', async () => {
    const { code } = codeFor(tr.number);
    expect((await owner.post('/api/shop/transfers/verify-receipt').send({ transferId: tr.id, otp: code })).body.code).toBe('sender_cannot_receive');
    const wrong = code === '000000' ? '111111' : '000000';
    const w1 = await manager.post('/api/shop/transfers/verify-receipt').send({ transferId: tr.id, otp: wrong });
    expect(w1.status).toBe(400);
    expect(w1.body).toMatchObject({ code: 'otp_wrong', details: { attemptsLeft: 2 } });
    expect((await manager.post('/api/shop/transfers/verify-receipt').send({ transferId: tr.id, otp: wrong })).body.details.attemptsLeft).toBe(1);
    expect((await manager.post('/api/shop/transfers/verify-receipt').send({ transferId: tr.id, otp: wrong })).status).toBe(423);
    // Locked: even the right code no longer works.
    expect((await manager.post('/api/shop/transfers/verify-receipt').send({ transferId: tr.id, otp: code })).body.code).toBe('otp_locked');
    expect((await batchAt(vel))).toBeUndefined();
  });

  it('resend: waits 60 seconds between codes, voids the old code, and codes expire after 15 minutes', async () => {
    const old = codeFor(tr.number).code;
    expect((await manager.post('/api/shop/transfers/resend-otp').send({ transferId: tr.id })).body.code).toBe('otp_cooldown');
    await skipCooldown(tr.id);
    const r = await manager.post('/api/shop/transfers/resend-otp').send({ transferId: tr.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toMatchObject({ state: 'open', attemptsLeft: 3 });
    const fresh = codeFor(tr.number).code;
    if (fresh !== old) expect((await manager.post('/api/shop/transfers/verify-receipt').send({ transferId: tr.id, otp: old })).body.code).toBe('otp_wrong');
    await query("UPDATE transfer_otps SET expires_at = now() - interval '1 second' WHERE transfer_id = $1 AND superseded_at IS NULL", [tr.id]);
    expect((await manager.post('/api/shop/transfers/verify-receipt').send({ transferId: tr.id, otp: fresh })).status).toBe(410);
    await skipCooldown(tr.id);
    expect((await manager.post('/api/shop/transfers/resend-otp').send({ transferId: tr.id })).status).toBe(200);
  });

  it('verifying with what arrived adds it to Branch B under the same batch, cost and destination price', async () => {
    const t = (await manager.get(`/api/shop/stock/transfers/${tr.id}`)).body;
    expect(t.can).toMatchObject({ receive: true, cancel: false });
    const lineId = t.lines[0].id;
    const { code } = codeFor(tr.number);
    // 22 good, 2 damaged, 1 missing: must add up, and must be explained.
    expect((await manager.post('/api/shop/transfers/verify-receipt').send({ transferId: tr.id, otp: code, lines: [{ lineId, received: 22, damaged: 2, missing: 0 }] })).status).toBe(400);
    expect((await manager.post('/api/shop/transfers/verify-receipt').send({ transferId: tr.id, otp: code, lines: [{ lineId, received: 22, damaged: 2, missing: 1 }] })).body.details).toHaveProperty('note');
    const ok = await manager.post('/api/shop/transfers/verify-receipt').send({ transferId: tr.id, otp: code, note: '2 kg bruised in the van, 1 kg short', lines: [{ lineId, received: 22, damaged: 2, missing: 1 }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'Received', receivedBy: 'Meena Krishnan', verifiedVia: 'otp', lossValue: 120 });
    expect(ok.body.lines[0]).toMatchObject({ qtyReceived: 22, qtyDamaged: 2, qtyMissing: 1, destPriceApplied: 64.8 });
    expect(await batchAt(vel)).toMatchObject({ qty: 22, unitCost: 40, sellingPrice: 64.8, originBranch: expect.any(String) });
    expect((await batchAt(head)).qty).toBe(75);
    // Single use.
    expect((await manager.post('/api/shop/transfers/verify-receipt').send({ transferId: tr.id, otp: code })).status).toBe(409);
    const log = (await owner.get(`/api/shop/stock/transfers/${tr.id}`)).body.otpLog.map((l: any) => l.event);
    expect(log).toEqual(expect.arrayContaining(['send_failed', 'verify_failed', 'locked', 'expired', 'verified']));
  });

  it('bills at Branch B use the destination price, and profit uses the batch’s purchase cost', async () => {
    const cust = (await owner.get('/api/shop/customers')).body[0];
    const inv = await manager.post('/api/shop/invoices').send({ customerId: cust.id, date: today(), dueDate: today(), withGst: true, issue: true, branchId: vel,
      lines: [{ itemId: apple.id, qty: 2, tier: 'SP1', batchNo: BATCH }] });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    expect(inv.body.lines[0].rate).toBe(64.8);
    const p = await owner.get(`/api/shop/invoices/${inv.body.id}/profit`);
    expect(p.body.profit.cost).toBeCloseTo(80, 2);
    const prices = (await owner.get(`/api/shop/stock/branch-prices?branchId=${vel}`)).body;
    expect(prices[apple.id].batches[BATCH]).toBe(64.8);
  });

  it('drafts move nothing until initiated; cancelling puts the units back in the source batch', async () => {
    const d = await send(10, { initiate: false });
    expect(d.status).toBe(201);
    expect(d.body.status).toBe('Draft');
    expect((await batchAt(head)).qty).toBe(75);
    const go = await owner.post('/api/shop/transfers/initiate').send({ transferId: d.body.id });
    expect(go.status, JSON.stringify(go.body)).toBe(201);
    expect(go.body).toMatchObject({ status: 'In transit', number: d.body.number });
    expect((await batchAt(head)).qty).toBe(65);
    // Branch B staff can't cancel what Branch A sent.
    expect((await manager.post(`/api/shop/stock/transfers/${d.body.id}/cancel`).send({})).status).toBe(403);
    const c = await owner.post(`/api/shop/stock/transfers/${d.body.id}/cancel`).send({ reason: 'Truck not available' });
    expect(c.body.status).toBe('Cancelled');
    expect((await batchAt(head)).qty).toBe(75);
    const { code } = codeFor(d.body.number);
    expect((await manager.post('/api/shop/transfers/verify-receipt').send({ transferId: d.body.id, otp: code })).status).toBe(409);
  });

  it('only the owner can receive without a code, with a reason', async () => {
    const t = (await send(5)).body;
    expect((await manager.post('/api/shop/transfers/owner-receive').send({ transferId: t.id, reason: 'Email is down today' })).status).toBe(403);
    expect((await owner.post('/api/shop/transfers/owner-receive').send({ transferId: t.id, reason: 'short' })).status).toBe(400);
    const r = await owner.post('/api/shop/transfers/owner-receive').send({ transferId: t.id, reason: 'Email provider down; goods checked on video call' });
    expect(r.body).toMatchObject({ status: 'Received', verifiedVia: 'owner_override' });
    expect((await batchAt(vel)).qty).toBe(25);
  });

  it('a new branch starts at zero, and the item drawer’s quick transfer waits in transit too', async () => {
    const nb = (await owner.post('/api/shop/branches').send({ name: 'Anna Nagar', address: '', phone: '' })).body.id;
    const item = () => owner.get('/api/shop/items').then((r) => r.body.find((i: any) => i.id === apple.id));
    let it = await item();
    expect(it.stockByBranch[nb] ?? 0).toBe(0);
    const headBefore = it.stockByBranch[head];
    const r = await owner.post('/api/shop/stock/transfer').send({ itemId: apple.id, fromBranchId: head, toBranchId: nb, qty: 10 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.transfer).toMatchObject({ status: 'In transit', toName: 'Anna Nagar' });
    expect(r.body.transfer.lines[0]).toMatchObject({ batchNo: BATCH, qty: 10 });
    it = await item();
    expect(it.stockByBranch[head]).toBe(headBefore - 10);
    expect(it.stockByBranch[nb] ?? 0).toBe(0);        // nothing at the new branch yet
    expect(it.inTransitByBranch[nb]).toBe(10);        // shown as on the way
    await owner.post('/api/shop/transfers/owner-receive').send({ transferId: r.body.transfer.id, reason: 'Checked at Anna Nagar on arrival' });
    it = await item();
    expect(it.stockByBranch[nb]).toBe(10);
    expect(it.inTransitByBranch[nb] ?? 0).toBe(0);
  });

  it('keeps transfers to their shop', async () => {
    const other = request.agent(app);
    await other.post('/api/auth/signup').set(csrf).send({ shopName: 'Second Shop', ownerName: 'Lakshmi R', email: 'second@example.com', phone: '9000012345', password: 'Second#2026' });
    expect((await other.get(`/api/shop/stock/transfers/${tr.id}`).set(csrf)).status).toBe(404);
    expect((await other.post('/api/shop/transfers/verify-receipt').set(csrf).send({ transferId: tr.id, otp: '123456' })).status).toBe(404);
    expect((await other.get('/api/shop/pricing-rules').set(csrf)).body).toEqual([]);
  });
});
