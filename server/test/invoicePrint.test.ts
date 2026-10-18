import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../src/db';
import { renderToken, verifyRenderToken } from '../src/services/printBundle';
import { app, freshDb, login, today } from './helpers';
import { DEFAULT_PRINT_SETTINGS } from '../../shared/printSettings';

let owner: Awaited<ReturnType<typeof login>>;
let customerId: string;
let itemId: string;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  itemId = (await owner.get('/api/shop/items')).body.find((i: any) => i.sku === 'SD-64U3').id;
  customerId = (await owner.get('/api/shop/customers')).body.find((c: any) => c.companyName === 'Nila Textiles').id;
});

const issue = (over: Record<string, unknown> = {}) =>
  owner.post('/api/shop/invoices').send({ customerId, date: today(), dueDate: today(), lines: [{ itemId, qty: 1, tier: 'SP1', discount: 10 }], withGst: true, issue: true, ...over });

describe('render tokens', () => {
  it('accept only the invoice they were issued for, until they expire', () => {
    const t = renderToken('shop-1', 'inv-1');
    expect(verifyRenderToken(t, 'inv-1')).toBe('shop-1');
    expect(verifyRenderToken(t, 'inv-2')).toBeNull();
    expect(verifyRenderToken(t.slice(0, -2) + 'xx', 'inv-1')).toBeNull();
    expect(verifyRenderToken(renderToken('shop-1', 'inv-1', -1), 'inv-1')).toBeNull();
    expect(verifyRenderToken('garbage', 'inv-1')).toBeNull();
  });
});

describe('invoice print data', () => {
  it('saves ship-to and terms, and returns one bundle for print, share and render', async () => {
    const shipTo = { name: 'Nila Textiles Godown', address: '7 SIDCO Estate\nAmbattur', state: 'Tamil Nadu', gstin: '' };
    const inv = (await issue({ shipTo, terms: 'Pay within 7 days.' })).body;
    expect(inv.shipTo).toEqual(shipTo);
    expect(inv.terms).toBe('Pay within 7 days.');

    // Editing without the fields (older clients) keeps them.
    const upd = await owner.put(`/api/shop/invoices/${inv.id}`).send({ customerId, date: today(), dueDate: today(), lines: [{ itemId, qty: 2, tier: 'SP1' }], withGst: true });
    expect(upd.status).toBe(200);
    expect(upd.body.shipTo).toEqual(shipTo);

    const b = (await owner.get(`/api/shop/invoices/${inv.id}/print-data`)).body;
    expect(b.invoice.number).toBe(inv.number);
    expect(b.org.gstin).toMatch(/^33/);
    expect(b.settings.invoice).toEqual(DEFAULT_PRINT_SETTINGS.invoice);

    const token = inv.publicToken as string;
    const pub = await request(app).get(`/api/public/invoices/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.invoice.id).toBe(inv.id);
    expect(pub.body.settings.invoice.paper).toBe('a4');
  });

  it('serves the renderer only with a valid token for that invoice', async () => {
    const a = (await issue()).body;
    const other = (await issue()).body;
    const [{ shop_id: shopId }] = await query('SELECT shop_id FROM public_links WHERE invoice_id = $1', [a.id]);
    expect((await request(app).get(`/api/public/render/invoices/${a.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/public/render/invoices/${a.id}?rt=${renderToken(shopId, other.id)}`)).status).toBe(404);
    const ok = await request(app).get(`/api/public/render/invoices/${a.id}?rt=${encodeURIComponent(renderToken(shopId, a.id))}`);
    expect(ok.status).toBe(200);
    expect(ok.body.invoice.id).toBe(a.id);
  });

  it('records IRN and e-way bill references with validation', async () => {
    const inv = (await issue()).body;
    expect((await owner.put(`/api/shop/invoices/${inv.id}/gst-refs`).send({ irn: 'short' })).status).toBe(400);
    expect((await owner.put(`/api/shop/invoices/${inv.id}/gst-refs`).send({ ewayBillNo: '123' })).status).toBe(400);
    const irn = 'a'.repeat(64);
    const r = await owner.put(`/api/shop/invoices/${inv.id}/gst-refs`).send({ irn, ackNo: '112010036563310', ackDate: '18-10-2026 14:05', ewayBillNo: '331000123456', vehicleNo: 'tn01ab1234' });
    expect(r.status).toBe(200);
    expect(r.body.einvoice).toMatchObject({ irn, ackNo: '112010036563310' });
    expect(r.body.eway).toEqual({ number: '331000123456', date: '', vehicleNo: 'TN01AB1234' });
  });

  it('saves the invoice layout and keeps it when an older client saves receipts only', async () => {
    const cur = (await owner.get('/api/shop/print-settings')).body;
    const invoice = { ...cur.invoice, template: 'modern', paper: 'a5', color: '#0F766E', fields: { ...cur.invoice.fields, upiQr: false } };
    expect((await owner.put('/api/shop/print-settings').send({ ...cur, invoice })).status).toBe(200);
    expect((await owner.put('/api/shop/print-settings').send({ thermal: cur.thermal, barcode: cur.barcode })).status).toBe(200);
    const saved = (await owner.get('/api/shop/print-settings')).body.invoice;
    expect(saved).toMatchObject({ template: 'modern', paper: 'a5', color: '#0F766E' });
    expect(saved.fields.upiQr).toBe(false);
    expect((await owner.put('/api/shop/print-settings').send({ ...cur, invoice: { ...invoice, color: 'teal' } })).status).toBe(400);
  });
});
