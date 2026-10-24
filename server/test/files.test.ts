import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login, today } from './helpers';
import { dataUrl, makePdf } from './pdfFixture';

let owner: Awaited<ReturnType<typeof login>>;
beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
});

describe('reading uploads into form fields (offline reader)', () => {
  it('fills an item from a product sheet PDF, including "30k"', async () => {
    const pdf = makePdf(['Product Name: Lenovo ThinkPad E14', 'Brand: Lenovo', 'HSN Code: 8471', 'MRP: Rs. 38,999', 'Selling Price: 30k', 'GST 18%']);
    const r = await owner.post('/api/shop/extract').send({ kind: 'item', file: dataUrl('application/pdf', pdf), filename: 'sheet.pdf' });
    expect(r.status).toBe(200);
    expect(r.body.method).toBe('pdf-text');
    expect(r.body.data.lines[0]).toMatchObject({ name: 'Lenovo ThinkPad E14', brand: 'Lenovo', hsn: '8471', mrp: 38999, sellingPrice: 30000, taxRate: 18 });
  });

  it('reads a vendor bill and ignores the shop’s own GSTIN', async () => {
    const pdf = makePdf([
      'TAX INVOICE', 'Chennai Paper Mart', 'GSTIN: 33AAFFC7788Q1Z6', 'Invoice No: CPM-881  Date: 14/10/2026',
      'Bill To: Aravind Computer Store GSTIN 33AABCA1234F1Z5', 'Taxable Value 5,000.00', 'CGST 6% 300.00', 'SGST 6% 300.00', 'Grand Total 5,600.00',
    ]);
    const r = await owner.post('/api/shop/extract').send({ kind: 'bill', file: dataUrl('application/pdf', pdf) });
    expect(r.body.data).toMatchObject({ documentNumber: 'CPM-881', date: '2026-10-14', total: 5600, subtotal: 5000, taxTotal: 600 });
    expect(r.body.data.party.gstin).toBe('33AAFFC7788Q1Z6');
  });

  it('rejects files that are not what they claim', async () => {
    expect((await owner.post('/api/shop/extract').send({ kind: 'item', file: dataUrl('application/pdf', Buffer.from('hello world, not a pdf')) })).status).toBe(400);
    expect((await owner.post('/api/shop/extract').send({ kind: 'item', file: dataUrl('text/html', Buffer.from('<script>')) })).status).toBe(400);
    expect((await owner.get('/api/shop/extract/status')).body).toEqual({ ai: false });
  });
});

describe('attachments', () => {
  it('stores, lists, serves and deletes files on a record', async () => {
    const item = (await owner.get('/api/shop/items')).body[0];
    const pdf = makePdf(['Warranty card']);
    const up = await owner.post('/api/shop/attachments').send({ entity: 'item', entityId: item.id, filename: 'warranty/../card.pdf', file: dataUrl('application/pdf', pdf) });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ filename: 'warranty_.._card.pdf', mime: 'application/pdf', size: pdf.length });
    const list = (await owner.get(`/api/shop/attachments?entity=item&entityId=${item.id}`)).body;
    expect(list).toHaveLength(1);
    const file = await owner.get(`/api/shop/attachments/${up.body.id}`).buffer(true);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(file.body).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await owner.del(`/api/shop/attachments/${up.body.id}`)).status).toBe(200);
    expect((await owner.get(`/api/shop/attachments?entity=item&entityId=${item.id}`)).body).toHaveLength(0);
  });

  it('checks the record exists and who may attach', async () => {
    const missing = await owner.post('/api/shop/attachments').send({ entity: 'bill', entityId: '00000000-0000-4000-8000-000000000000', filename: 'x.pdf', file: dataUrl('application/pdf', makePdf(['x'])) });
    expect(missing.status).toBe(404);
    const sales = await login('sales@shop.com', 'sales123');
    const bill = (await owner.post('/api/shop/bills').send({ vendorId: (await owner.get('/api/shop/vendors')).body[0].id, date: today(), dueDate: today(), taxableAmount: 100, taxAmount: 0 })).body;
    expect((await sales.post('/api/shop/attachments').send({ entity: 'bill', entityId: bill.id, filename: 'b.pdf', file: dataUrl('application/pdf', makePdf(['b'])) })).status).toBe(403);
    expect((await sales.get(`/api/shop/attachments?entity=bill&entityId=${bill.id}`)).status).toBe(403);
  });
});
