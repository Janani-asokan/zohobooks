import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login, today } from './helpers';

/* Customer mobile numbers (optional, strict 10 digits) and IMEI / serial numbers on purchases and item imports. */

let owner: Awaited<ReturnType<typeof login>>;
let head: string;
let slab: string;
let vendorId: string;
let customerId: string;

const newGoods = async (name: string, extra: Record<string, unknown> = {}) =>
  (await owner.post('/api/shop/items').send({ type: 'Goods', name, cost: 9000, sp1: 12000, sp2: 12000, sp3: 12000, taxSlabId: slab, openingStock: 0, branchId: head, ...extra })).body;
const serialsOf = async (itemId: string) => (await owner.get(`/api/shop/items/${itemId}/serials`)).body as any[];
const stockOf = async (itemId: string) => (await owner.get('/api/shop/items')).body.find((i: any) => i.id === itemId).stock as number;
const bill = (lines: unknown[], extra: Record<string, unknown> = {}) => owner.post('/api/shop/bills').send({ vendorId, vendorBillNo: 'V-1', date: today(), dueDate: today(), lines, ...extra });

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  head = (await owner.get('/api/shop/branches')).body.find((b: any) => b.isPrimary).id;
  slab = (await owner.get('/api/shop/tax-slabs')).body.find((s: any) => s.rate === 18).id;
  vendorId = (await owner.get('/api/shop/vendors')).body[0].id;
  customerId = (await owner.get('/api/shop/customers')).body[0].id;
});

describe('customer mobile number', () => {
  const add = (name: string, phone?: string) => owner.post('/api/shop/customers').send({ type: 'Individual', name, ...(phone === undefined ? {} : { phone }) });

  it('is optional: a walk-in customer saves with no number', async () => {
    const a = await add('No Phone Ravi');
    expect(a.status).toBe(200);
    expect(a.body.phone).toBe('');
    expect((await add('Blank Phone Ravi', '  ')).body.phone).toBe('');
  });

  it('saves a real 10-digit mobile in one format, however it was typed', async () => {
    for (const [i, p] of ['9876543210', '+91 98765 43210', '098765-43210', '919876543210'].entries()) {
      const r = await add(`Mobile Ok ${i}`, p);
      expect(r.status, p).toBe(200);
      expect(r.body.phone).toBe('+91 98765 43210');
    }
  });

  it('refuses anything that is not a 10-digit mobile, and says why', async () => {
    for (const p of ['98765', '98765432101', '1234567890', '98765abcde', '+1 415 555 0100', '0422 2345678']) {
      const r = await add(`Bad ${p}`, p);
      expect(r.status, p).toBe(400);
      expect(JSON.stringify(r.body), p).toMatch(/10-digit mobile/);
    }
  });

  it('applies the same rule when editing a customer', async () => {
    const c = (await add('Edit Phone Meena', '9444011223')).body;
    const put = (phone: string) => owner.put(`/api/shop/customers/${c.id}`).send({ ...c, phone });
    expect((await put('94440')).status).toBe(400);
    expect((await put('')).body.phone).toBe('');
    expect((await put('94440 11224')).body.phone).toBe('+91 94440 11224');
  });

  it('imports a customer list: bad numbers are dropped with a warning, the customer is still added', async () => {
    const csv = 'Name,Phone\r\nImport Good,9840012345\r\nImport Bad,12345\r\nImport None,\r\n';
    const r = await owner.post('/api/shop/customers/import').send({ csv });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(3);
    expect(r.body.warnings.join(' ')).toMatch(/Import Bad.*12345/);
    const list = (await owner.get('/api/shop/customers')).body;
    expect(list.find((x: any) => x.name === 'Import Good').phone).toBe('+91 98400 12345');
    expect(list.find((x: any) => x.name === 'Import Bad').phone).toBe('');
  });
});

describe('IMEI / serial numbers on a purchase bill', () => {
  it('registers one IMEI per unit, linked to the bill and vendor, and the phone can then be sold by IMEI', async () => {
    const phone = await newGoods('Bill Test Phone A15', { trackSerials: true });
    const r = await bill([{ itemId: phone.id, qty: 2, rate: 9000, serials: ['356789104512345', ' 3567 8910 4512 352 '] }]);
    expect(r.status).toBe(200);
    expect(r.body.lines[0].serials).toEqual(['356789104512345', '356789104512352']);
    expect(await stockOf(phone.id)).toBe(2);
    const sn = await serialsOf(phone.id);
    expect(sn).toHaveLength(2);
    expect(sn[0]).toMatchObject({ status: 'In stock', billNumber: r.body.number, receivedOn: today() });
    expect(sn[0].vendorName).toBeTruthy();

    const inv = await owner.post('/api/shop/invoices').send({ customerId, date: today(), dueDate: today(), withGst: true, branchId: head, issue: true, lines: [{ itemId: phone.id, qty: 1, tier: 'SP1', serials: ['356789104512352'] }] });
    expect(inv.status).toBe(200);
    const after = await serialsOf(phone.id);
    expect(after.find((s) => s.serial === '356789104512352')).toMatchObject({ status: 'Sold', invoiceNumber: inv.body.number });
    // Warranty lookup: where it came from and who bought it.
    const look = (await owner.get('/api/shop/serials/lookup?q=4512352')).body[0];
    expect(look).toMatchObject({ billNumber: r.body.number, invoiceNumber: inv.body.number });
    expect(look.customerName).toBeTruthy();
  });

  it('needs exactly one number per unit, and saves nothing when they don’t match', async () => {
    const phone = await newGoods('Bill Test Phone Count', { trackSerials: true });
    const before = (await owner.get('/api/shop/bills')).body.length;
    const few = await bill([{ itemId: phone.id, qty: 3, rate: 9000, serials: ['861234567890121'] }]);
    expect(few.status).toBe(400);
    expect(few.body.error ?? few.body.message).toMatch(/needs 3 serial \/ IMEI numbers.*1 entered/);
    expect((await bill([{ itemId: phone.id, qty: 1, rate: 9000 }])).status).toBe(400);
    expect((await bill([{ itemId: phone.id, qty: 1.5, rate: 9000, serials: ['a', 'b'] }])).status).toBe(400);
    expect((await owner.get('/api/shop/bills')).body.length).toBe(before);
    expect(await stockOf(phone.id)).toBe(0);
  });

  it('refuses a number twice: in one line, across lines, or already in stock under any item', async () => {
    const a = await newGoods('Bill Test Phone Dup A', { trackSerials: true });
    const b = await newGoods('Bill Test Phone Dup B', { trackSerials: true });
    expect((await bill([{ itemId: a.id, qty: 2, rate: 1, serials: ['DUP-1', 'DUP-1'] }])).body.error).toMatch(/entered twice/);
    expect((await bill([{ itemId: a.id, qty: 1, rate: 1, serials: ['DUP-2'] }, { itemId: b.id, qty: 1, rate: 1, serials: ['DUP-2'] }])).body.error).toMatch(/two lines/);
    expect((await bill([{ itemId: a.id, qty: 1, rate: 1, serials: ['DUP-3'] }])).status).toBe(200);
    const again = await bill([{ itemId: b.id, qty: 1, rate: 1, serials: ['DUP-3'] }]);
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/Already in your stock records: DUP-3 \(Bill Test Phone Dup A\)/);
    // The hand-entry screen follows the same shop-wide rule.
    await owner.post('/api/shop/stock/adjustments').send({ branchId: head, date: today(), reason: 'Found', lines: [{ itemId: b.id, qty: 1 }] });
    expect((await owner.post(`/api/shop/items/${b.id}/serials`).send({ branchId: head, serials: ['DUP-3'] })).status).toBe(400);
  });

  it('refuses numbers for an item that doesn’t keep them, and ignores them on a bill that adds no stock', async () => {
    const plain = await newGoods('Bill Test Charger');
    const r = await bill([{ itemId: plain.id, qty: 1, rate: 300, serials: ['X1'] }]);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/doesn’t keep serial/);
    const noStock = await bill([{ itemId: plain.id, qty: 1, rate: 300, serials: ['X1'] }], { addStock: false });
    expect(noStock.status).toBe(200);
    expect(noStock.body.lines[0].serials).toBeUndefined();
    // Ordinary items on bills are unchanged.
    expect((await bill([{ itemId: plain.id, qty: 5, rate: 300 }])).status).toBe(200);
    expect(await stockOf(plain.id)).toBe(5);
  });
});

describe('IMEI / serial numbers when receiving a purchase order', () => {
  it('takes one per unit received, in parts, linked to the order', async () => {
    const phone = await newGoods('PO Test Phone', { trackSerials: true });
    const po = (await owner.post('/api/shop/purchase-orders').send({ vendorId, date: today(), lines: [{ itemId: phone.id, qty: 3, rate: 9000 }] })).body;
    const lineId = po.lines[0].id;
    const recv = (lines: unknown[]) => owner.post(`/api/shop/purchase-orders/${po.id}/receive`).send({ lines });
    expect((await recv([{ lineId, qty: 2, serials: ['PO-IMEI-1'] }])).status).toBe(400);
    expect(await stockOf(phone.id)).toBe(0);
    const part = await recv([{ lineId, qty: 2, serials: ['PO-IMEI-1', 'PO-IMEI-2'] }]);
    expect(part.status).toBe(200);
    expect(part.body.status).toBe('Partially Received');
    expect((await recv([{ lineId, qty: 1, serials: ['PO-IMEI-2'] }])).status).toBe(400);
    expect((await recv([{ lineId, qty: 1, serials: ['PO-IMEI-3'] }])).body.status).toBe('Received');
    const sn = await serialsOf(phone.id);
    expect(sn.map((s) => s.serial).sort()).toEqual(['PO-IMEI-1', 'PO-IMEI-2', 'PO-IMEI-3']);
    expect(sn.every((s) => s.poNumber === po.number)).toBe(true);
    expect(await stockOf(phone.id)).toBe(3);
  });
});

describe('IMEI / serial numbers in item imports', () => {
  it('Items page CSV: one row per phone with its IMEI makes one item with that many units', async () => {
    const csv = [
      'Name,SKU,HSN,Cost,SP1,Tax Rate,Stock,IMEI / Serial No,IMEI 2',
      'Import Redmi 13C,RED-13C,8517,8000,9999,18,,861111111111111,862222222222222',
      'Import Redmi 13C,RED-13C,8517,8000,9999,18,,861111111111129,',
      'Import Redmi 13C,RED-13C,8517,8000,9999,18,,861111111111111,',
      'Import Box Phone,BOX-1,8517,1000,1500,18,5,"BX-1, BX-2; BX-3",',
      'Import Sci Phone,SCI-1,8517,1000,1500,18,,3.56789E+14,',
      'Import Cable,CAB-1,8544,50,99,18,20,,',
    ].join('\r\n');
    const r = await owner.post('/api/shop/items/import').send({ csv });
    expect(r.status).toBe(200);
    expect(r.body.serials).toBe(5);
    const w = r.body.warnings.join(' | ');
    expect(w).toMatch(/861111111111111 is in the file twice/);
    expect(w).toMatch(/shortened by Excel/);
    expect(w).toMatch(/counted from the numbers/);
    const items = (await owner.get('/api/shop/items')).body;
    const red = items.find((i: any) => i.sku === 'RED-13C');
    expect(red).toMatchObject({ trackSerials: true, stock: 2 });
    expect(items.filter((i: any) => i.name === 'Import Redmi 13C')).toHaveLength(1);
    const redSn = await serialsOf(red.id);
    expect(redSn.find((s) => s.serial === '861111111111111').note).toMatch(/IMEI 2: 862222222222222/);
    expect(items.find((i: any) => i.sku === 'BOX-1')).toMatchObject({ trackSerials: true, stock: 3 });
    expect(items.find((i: any) => i.sku === 'SCI-1')).toMatchObject({ stock: 0 });
    expect(items.find((i: any) => i.sku === 'CAB-1')).toMatchObject({ trackSerials: false, stock: 20 });
    // Found by its second IMEI too.
    expect((await owner.get('/api/shop/serials/lookup?q=862222222222222')).body[0].serial).toBe('861111111111111');
  });

  it('a "Serial No." column that only counts rows is not taken as IMEIs', async () => {
    const csv = 'Serial No,Name,SP1,Stock\r\n1,Import Row Count A,10,4\r\n2,Import Row Count B,10,6\r\n3,Import Row Count C,10,1\r\n';
    const r = await owner.post('/api/shop/items/import').send({ csv });
    expect(r.body.created).toBe(3);
    expect(r.body.serials).toBe(0);
    expect(r.body.warnings.join(' ')).toMatch(/counts rows/);
    expect((await owner.get('/api/shop/items')).body.find((i: any) => i.name === 'Import Row Count A')).toMatchObject({ stock: 4, trackSerials: false });
  });

  it('Import from any software (mapped columns): repeated rows add their IMEIs to the same item', async () => {
    const rows = [
      { name: 'Mapped Vivo Y28', sp1: '13999', cost: '11000', tax_rate: '18', serials: '867000000000011' },
      { name: 'Mapped Vivo Y28', sp1: '13999', cost: '11000', tax_rate: '18', serials: '867000000000029' },
      { name: 'Mapped Vivo Y28', sp1: '13999', cost: '11000', tax_rate: '18', serials: '867000000000011' },
    ];
    const r = await owner.post('/api/shop/data-import').send({ kind: 'items', rows });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ created: 1, skipped: 0, serials: 2 });
    expect(r.body.warnings.join(' ')).toMatch(/in the file twice/);
    const it = (await owner.get('/api/shop/items')).body.find((i: any) => i.name === 'Mapped Vivo Y28');
    expect(it).toMatchObject({ trackSerials: true, stock: 2 });
    // Importing the same sheet again adds nothing twice.
    const again = await owner.post('/api/shop/data-import').send({ kind: 'items', rows: rows.slice(0, 2) });
    expect(again.body.serials ?? 0).toBe(0);
    expect(again.body.warnings.join(' ')).toMatch(/already in your stock records/);
    expect(await stockOf(it.id)).toBe(2);
  });

  it('does not switch on IMEI tracking for an item that already has stock without numbers', async () => {
    const r1 = await owner.post('/api/shop/data-import').send({ kind: 'items', rows: [{ name: 'Mapped Old Stock Phone', sp1: '5000', stock: '4' }] });
    expect(r1.body.created).toBe(1);
    const r2 = await owner.post('/api/shop/data-import').send({ kind: 'items', rows: [{ name: 'Mapped Old Stock Phone', sp1: '5000', serials: 'OLD-1' }] });
    expect(r2.body.warnings.join(' ')).toMatch(/already has 4 in stock without IMEI/);
    expect((await owner.get('/api/shop/items')).body.find((i: any) => i.name === 'Mapped Old Stock Phone')).toMatchObject({ trackSerials: false, stock: 4 });
  });
});
