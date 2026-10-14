import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
});

const period = (offsetMonths: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

describe('GST returns', () => {
  it('GSTR-1 JSON groups B2B by customer GSTIN and lists the document series', async () => {
    let found = false;
    for (let m = 0; m >= -6; m--) {
      const res = await owner.get(`/api/shop/gst/gstr1?period=${period(m)}&download=1`);
      expect(res.status).toBe(200);
      expect(res.body.gstin).toBe('33AABCA1234F1Z5');
      expect(res.body.fp).toMatch(/^\d{6}$/);
      for (const b of res.body.b2b) {
        found = true;
        expect(b.ctin).toMatch(/^\d{2}[A-Z]{5}/);
        for (const inv of b.inv) {
          expect(inv.idt).toMatch(/^\d{2}-\d{2}-\d{4}$/);
          expect(inv.itms[0].itm_det.rt).toBeGreaterThan(0);
        }
      }
      if (res.body.doc_issue.doc_det.length) expect(res.body.doc_issue.doc_det[0].docs[0].totnum).toBeGreaterThan(0);
    }
    expect(found).toBe(true);
  });

  it('GSTR-3B nets credit notes against outward supplies and shows ITC from bills', async () => {
    let itcSeen = false;
    for (let m = 0; m >= -6; m--) {
      const r = (await owner.get(`/api/shop/gst/gstr3b?period=${period(m)}`)).body;
      const o = r.sup_details.osup_det;
      expect(o.camt).toBeCloseTo(o.samt, 1);
      if (r.itc_elg.itc_avl.camt + r.itc_elg.itc_avl.iamt > 0) itcSeen = true;
    }
    expect(itcSeen).toBe(true);
  });

  it('HSN summary aggregates by HSN and rate', async () => {
    const r = (await owner.get('/api/shop/gst/hsn?from=2000-01-01&to=2100-01-01')).body;
    expect(r.length).toBeGreaterThan(3);
    const keys = r.map((x: any) => `${x.hsn}|${x.rate}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('builds an e-invoice payload for a B2B invoice and refuses B2C', async () => {
    const invs = (await owner.get('/api/shop/invoices')).body.filter((i: any) => i.status === 'Issued');
    const b2b = invs.find((i: any) => i.customer.gstin);
    const b2c = invs.find((i: any) => !i.customer.gstin);
    const e = await owner.get(`/api/shop/invoices/${b2b.id}/einvoice.json`);
    expect(e.status).toBe(200);
    expect(e.body.Version).toBe('1.1');
    expect(e.body.BuyerDtls.Gstin).toBe(b2b.customer.gstin);
    expect(e.body.ValDtls.TotInvVal).toBe(b2b.total);
    expect((await owner.get(`/api/shop/invoices/${b2c.id}/einvoice.json`)).status).toBe(400);
  });

  it('builds an e-way bill payload with transport details', async () => {
    const inv = (await owner.get('/api/shop/invoices')).body.find((i: any) => i.status === 'Issued' && i.lines.some((l: any) => l.type === 'Goods'));
    expect((await owner.post(`/api/shop/invoices/${inv.id}/ewaybill.json`).send({ distanceKm: 12, vehicleNo: 'bad' })).status).toBe(400);
    const r = await owner.post(`/api/shop/invoices/${inv.id}/ewaybill.json`).send({ distanceKm: 12, vehicleNo: 'TN 01 AB 1234' });
    expect(r.status).toBe(200);
    expect(r.body.billLists[0].vehicleNo).toBe('TN01AB1234');
  });
});
