import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login, today } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
});

describe('ledger', () => {
  it('keeps the trial balance and balance sheet balanced', async () => {
    const tb = (await owner.get(`/api/shop/accounting/trial-balance?asOf=${today()}`)).body;
    expect(tb.rows.length).toBeGreaterThan(5);
    expect(tb.totalDebit).toBeCloseTo(tb.totalCredit, 2);
    const bs = (await owner.get(`/api/shop/reports/balance-sheet?asOf=${today()}`)).body;
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets).toBeCloseTo(bs.totalLiabilities + bs.totalEquity, 1);
  });

  it('values inventory at the stock summary value and receivables at what customers owe', async () => {
    const accts = (await owner.get('/api/shop/accounting/accounts')).body;
    const ss = (await owner.get(`/api/shop/stock/summary?from=2000-01-01&to=${today()}`)).body;
    expect(accts.find((a: any) => a.key === 'inventory').balance).toBeCloseTo(ss.totals.value, 1);
    // Signed balances: a credit note on a paid invoice leaves the customer in credit.
    const invoices = (await owner.get('/api/shop/invoices')).body.filter((i: any) => i.status === 'Issued');
    const owed = invoices.reduce((s: number, i: any) => s + i.total - i.amountPaid - i.amountCredited, 0);
    expect(accts.find((a: any) => a.key === 'ar').balance).toBeCloseTo(owed, 1);
  });

  it('profit for the year on the balance sheet matches the P&L', async () => {
    const pnl = (await owner.get(`/api/shop/reports/profit-loss?to=${today()}`)).body;
    const bs = (await owner.get(`/api/shop/reports/balance-sheet?asOf=${today()}`)).body;
    const current = bs.equity.rows.find((r: any) => r.key === 'current_profit')?.amount ?? 0;
    expect(pnl.netProfit).toBeCloseTo(current, 1);
    expect(pnl.income.total).toBeGreaterThan(0);
    expect(pnl.grossProfit).toBeCloseTo(pnl.income.total - pnl.cogs.total, 2);
  });

  it('posts balanced manual journals to custom accounts and rejects unbalanced ones', async () => {
    const acc = (await owner.post('/api/shop/accounting/accounts').send({ name: 'Shop furniture', type: 'asset', subtype: 'fixed', code: '1500' })).body;
    expect(acc.key).toMatch(/^acc:/);
    expect((await owner.post('/api/shop/accounting/accounts').send({ name: 'shop furniture', type: 'asset' })).status).toBe(400);
    const bad = await owner.post('/api/shop/accounting/journals').send({ date: today(), lines: [{ account: acc.key, debit: 100 }, { account: 'capital', credit: 90 }] });
    expect(bad.status).toBe(400);
    const j = await owner.post('/api/shop/accounting/journals').send({ date: today(), notes: 'Owner brought in furniture', lines: [{ account: acc.key, debit: 25000 }, { account: 'capital', credit: 25000 }] });
    expect(j.status).toBe(200);
    expect(j.body.number).toMatch(/^JV-\d{4}$/);
    const gl = (await owner.get(`/api/shop/accounting/ledger?account=${encodeURIComponent(acc.key)}&to=${today()}`)).body;
    expect(gl.closing).toBe(25000);
    const bs = (await owner.get(`/api/shop/reports/balance-sheet?asOf=${today()}`)).body;
    expect(bs.balanced).toBe(true);
    expect(bs.assets.find((s: any) => s.label === 'Fixed assets').total).toBe(25000);
    expect((await owner.del(`/api/shop/accounting/journals/${j.body.id}`)).status).toBe(200);
  });

  it('cash flow reconciles opening and closing cash', async () => {
    const cf = (await owner.get(`/api/shop/reports/cash-flow?from=2000-01-01&to=${today()}`)).body;
    const net = cf.sections.reduce((s: number, x: any) => s + x.total, 0);
    expect(cf.opening + net).toBeCloseTo(cf.closing, 1);
    const accts = (await owner.get('/api/shop/accounting/accounts')).body;
    const cash = accts.filter((a: any) => a.subtype === 'cash').reduce((s: number, a: any) => s + a.balance, 0);
    expect(cf.closing).toBeCloseTo(cash, 1);
  });

  it('ages receivables and payables', async () => {
    const r = (await owner.get(`/api/shop/reports/ageing?kind=receivable&asOf=${today()}`)).body;
    expect(r.totals.reduce((s: number, v: number) => s + v, 0)).toBeCloseTo(r.total, 2);
    const dash = (await owner.get('/api/shop/dashboard')).body;
    expect(r.total).toBeCloseTo(dash.receivable, 1);
    const p = (await owner.get(`/api/shop/reports/ageing?kind=payable&asOf=${today()}`)).body;
    expect(p.parties.length).toBeGreaterThan(0);
    const sales = await login('sales@shop.com', 'sales123');
    expect((await sales.get('/api/shop/reports/ageing?kind=payable')).status).toBe(403);
    expect((await sales.get('/api/shop/accounting/accounts')).status).toBe(403);
  });
});

describe('roles and permissions', () => {
  it('lets the owner change what a role can do', async () => {
    const roles = (await owner.get('/api/shop/roles')).body;
    expect(roles.map((r: any) => r.role)).toContain('Warehouse');
    const wh = await login('warehouse@shop.com', 'warehouse123');
    expect(wh.me.permissions).toContain('items.write');
    expect((await wh.get('/api/shop/reports/profit-loss')).status).toBe(403);
    expect((await owner.put('/api/shop/roles/Warehouse').send({ permissions: ['items.write', 'purchases.read', 'reports.read'] })).status).toBe(200);
    expect((await wh.get('/api/shop/reports/profit-loss')).status).toBe(200);
    expect((await owner.put('/api/shop/roles/Warehouse').send({ permissions: ['admin'] })).status).toBe(400);
    expect((await owner.del('/api/shop/roles/Warehouse')).status).toBe(200);
    expect((await wh.get('/api/shop/reports/profit-loss')).status).toBe(403);
    expect((await wh.put('/api/shop/roles/Sales Staff').send({ permissions: [] })).status).toBe(403);
  });

  it('logs every change, including routes without their own audit entry', async () => {
    await owner.put('/api/shop/roles/Viewer').send({ permissions: ['reports.read'] });
    const log = (await owner.get('/api/shop/audit?entity=role')).body;
    expect(log.rows[0]).toMatchObject({ action: 'update_permissions', entity: 'role', entityId: 'Viewer' });
    const page = (await owner.get('/api/shop/audit?limit=5')).body;
    expect(page.rows).toHaveLength(5);
    expect(page.nextCursor).toBeTruthy();
    const next = (await owner.get(`/api/shop/audit?limit=5&before=${page.nextCursor}`)).body;
    expect(next.rows[0].id).toBeLessThan(page.rows[4].id);
    const sales = await login('sales@shop.com', 'sales123');
    expect((await sales.get('/api/shop/audit')).status).toBe(403);
  });
});

describe('organisations', () => {
  it('creates a second organisation and switches between them with separate data', async () => {
    const created = await owner.post('/api/shop/organizations').send({ companyName: 'Aravind Mobiles', state: 'Tamil Nadu' });
    expect(created.status).toBe(200);
    const orgs = (await owner.get('/api/auth/orgs')).body;
    expect(orgs).toHaveLength(2);
    const home = orgs.find((o: any) => o.current).id;
    const sw = await owner.post('/api/auth/switch').send({ shopId: created.body.shopId });
    expect(sw.status).toBe(200);
    expect(sw.body.shop.id).toBe(created.body.shopId);
    expect(sw.body.permissions).toContain('admin');
    expect((await owner.get('/api/shop/items')).body).toHaveLength(0);
    expect((await owner.get('/api/shop/organization')).body.companyName).toBe('Aravind Mobiles');
    await owner.post('/api/auth/switch').send({ shopId: home });
    expect((await owner.get('/api/shop/items')).body.length).toBeGreaterThan(0);
    const manager = await login('manager@shop.com', 'manager123');
    expect((await manager.post('/api/auth/switch').send({ shopId: created.body.shopId })).status).toBe(403);
    expect((await manager.post('/api/shop/organizations').send({ companyName: 'Nope', state: 'Kerala' })).status).toBe(403);
  });
});
