import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, freshDb, login } from './helpers';
import { query } from '../src/db';
import { smsNumber } from '../src/services/sms';

let calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
const msg91 = (reply: unknown = { type: 'success', message: 'req-123' }, status = 200) => vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit) => {
  calls.push({ url: String(u), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
  return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
}));

beforeAll(async () => { await freshDb(); });
afterEach(() => { vi.unstubAllGlobals(); calls = []; });

describe('bills by SMS (MSG91)', () => {
  it('reads Indian mobile numbers', () => {
    expect(smsNumber('98400 12345')).toBe('919840012345');
    expect(smsNumber('+91 98400-12345')).toBe('919840012345');
    expect(smsNumber('098400 12345')).toBe('919840012345');
    expect(smsNumber('12345')).toBeNull();
    expect(smsNumber('0422 2345678')).toBeNull(); // a landline can't get SMS
  });

  it('is hidden until the super admin sets it up and switches it on; the key is never sent back', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    expect((await owner.get('/api/shop/sms/status')).body).toEqual({ on: false, leftToday: 0 });
    const admin = await login('admin@ledgerly.in', 'admin123');
    expect((await admin.put('/api/platform/sms').send({ templateId: 't1' })).status).toBe(400); // no key
    const saved = await admin.put('/api/platform/sms').send({ authKey: 'msg91-secret-key-9876', templateId: 'tmpl_abc', enabled: true, dailyPerShop: 2,
      vars: { name: 'cname', shop: 'shop', bill: 'billno', amount: 'amt', code: 'code' } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ configured: true, keyEnd: '9876', enabled: true, dailyPerShop: 2 });
    expect(JSON.stringify(saved.body)).not.toMatch(/msg91-secret-key/);
    msg91();
    const t = await admin.post('/api/platform/sms/test').send({ phone: '9840012345' });
    expect(t.body).toMatchObject({ ok: true, to: '919840012345' });
    expect(calls[0]!.url).toBe('https://control.msg91.com/api/v5/flow');
    expect(calls[0]!.headers.authkey).toBe('msg91-secret-key-9876');
  });

  it('a shop sends an issued bill: the template variables, each at most 30 characters, and a short link code that opens the bill', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    expect((await owner.get('/api/shop/sms/status')).body).toEqual({ on: true, leftToday: 2 });
    const inv = (await owner.get('/api/shop/invoices')).body.find((i: { status: string }) => i.status === 'Issued');
    const full = (await owner.get(`/api/shop/invoices/${inv.id}`)).body;
    msg91();
    expect((await owner.post(`/api/shop/invoices/${inv.id}/sms`).send({ phone: '123' })).status).toBe(400);
    const r = await owner.post(`/api/shop/invoices/${inv.id}/sms`).send({ phone: '98400 12345' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const sent = calls[0]!.body;
    expect(sent.template_id).toBe('tmpl_abc');
    const rcp = sent.recipients[0];
    expect(rcp).toMatchObject({ mobiles: '919840012345', billno: full.number, amt: full.total.toFixed(2) });
    for (const v of Object.values(rcp)) expect(String(v).length).toBeLessThanOrEqual(30);
    expect(rcp.code).toBe(full.publicToken.slice(0, 24));
    // The short code in the SMS opens the same bill as the full link.
    const pub = await request(app).get(`/api/public/invoices/${rcp.code}`);
    expect(pub.status).toBe(200);
    expect(pub.body.invoice.number).toBe(full.number);
    const [{ n }] = await query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'sms_sent' AND entity_id = $1", [inv.id]);
    expect(n).toBe(1);
  });

  it('stops at the daily limit, and says why when MSG91 refuses', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const inv = (await owner.get('/api/shop/invoices')).body.find((i: { status: string }) => i.status === 'Issued');
    msg91({ type: 'error', message: 'Invalid template id' });
    const bad = await owner.post(`/api/shop/invoices/${inv.id}/sms`).send({ phone: '9840012345' });
    expect(bad.body.error).toMatch(/Invalid template id/);
    msg91();
    expect((await owner.post(`/api/shop/invoices/${inv.id}/sms`).send({ phone: '9840012345' })).status).toBe(200); // 2nd of 2
    const over = await owner.post(`/api/shop/invoices/${inv.id}/sms`).send({ phone: '9840012345' });
    expect(over.status).toBe(429);
    expect(over.body.code).toBe('sms_limit');
  });
});
