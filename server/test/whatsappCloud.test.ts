import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { app, freshDb, login } from './helpers';
import { config } from '../src/config';
import { query } from '../src/db';

const SECRET = 'test-app-secret';
const saved = config.whatsapp;
beforeAll(async () => {
  await freshDb();
  config.whatsapp = { token: 'test-token', phoneId: '123456', appSecret: SECRET, verifyToken: 'verify-me', template: 'support_followup', templateLang: 'en', version: 'v21.0' };
});
afterAll(() => { config.whatsapp = saved; });
afterEach(() => { vi.unstubAllGlobals(); });

const sign = (body: string, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
const hook = (payload: object, signature?: string) => {
  const body = JSON.stringify(payload);
  return request(app).post('/api/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', signature ?? sign(body)).send(body);
};
const inbound = (from: string, id: string, text: string, name = 'Aravind', ts = Math.floor(Date.now() / 1000)) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id, timestamp: String(ts), type: 'text', text: { body: text } }] } }] }],
});
const statusUpdate = (id: string, status: string, errors?: object[]) => ({ entry: [{ changes: [{ value: { statuses: [{ id, status, ...(errors ? { errors } : {}) }] } }] }] });

describe('webhook', () => {
  it('answers Meta’s verification only with the right token', async () => {
    const ok = await request(app).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '4242' });
    expect(ok.status).toBe(200); expect(ok.text).toBe('4242');
    expect((await request(app).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' })).status).toBe(403);
  });

  it('refuses calls that are not signed by Meta', async () => {
    expect((await hook(inbound('919999900001', 'wamid.X1', 'hi'), 'sha256=00')).status).toBe(401);
    expect((await hook(inbound('919999900001', 'wamid.X1', 'hi'), sign('{}'))).status).toBe(401);
    expect((await hook(inbound('919999900001', 'wamid.X1', 'hi'), sign(JSON.stringify(inbound('919999900001', 'wamid.X1', 'hi')), 'other-secret'))).status).toBe(401);
    expect(await query("SELECT 1 FROM wa_messages WHERE wa_message_id = 'wamid.X1'")).toHaveLength(0);
  });

  it('stores a message once, links it to the shop by its phone, and counts it unread', async () => {
    const [shop] = await query("SELECT id, phone FROM shops WHERE name = 'Aravind Computer Store'");
    const wa = (shop.phone as string).replace(/\D/g, '').replace(/^(?=\d{10}$)/, '91');
    const p = inbound(wa, 'wamid.A1', 'Printer is not printing');
    expect((await hook(p)).status).toBe(200);
    expect((await hook(p)).status).toBe(200); // Meta retries: no duplicate
    const [c] = await query('SELECT * FROM wa_conversations WHERE wa_id = $1', [wa]);
    expect(c).toMatchObject({ shop_id: shop.id, unread: 1, profile_name: 'Aravind', status: 'open', last_preview: 'Printer is not printing' });
    expect(await query('SELECT 1 FROM wa_messages WHERE conversation_id = $1', [c.id])).toHaveLength(1);
  });

  it('links an unknown number by the "Shop:" line of the WhatsApp us message', async () => {
    await hook(inbound('919999900002', 'wamid.B1', 'Hi Corpus360 support, I need help.\nShop: Aravind Computer Store\nName: Meena\nAbout: GST'));
    const [c] = await query("SELECT c.shop_id, s.name FROM wa_conversations c JOIN shops s ON s.id = c.shop_id WHERE c.wa_id = '919999900002'");
    expect(c.name).toBe('Aravind Computer Store');
  });
});

describe('Customer care inbox', () => {
  const graph = () => {
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${calls.length}` }], success: true }), { status: 200 });
    }));
    return calls;
  };

  it('lists conversations, opens one (marking it read on WhatsApp too) and replies within 24 hours', async () => {
    const admin = await login('admin@ledgerly.in', 'admin123');
    const list = (await admin.get('/api/platform/support/wa')).body;
    expect(list).toMatchObject({ configured: true, webhookSecured: true, templateSet: true });
    expect(list.webhookAt).not.toBeNull();
    const conv = list.conversations.find((c: { preview: string }) => c.preview === 'Printer is not printing');
    expect(conv).toMatchObject({ shopName: 'Aravind Computer Store', unread: 1, windowOpen: true });

    const calls = graph();
    const open = (await admin.get(`/api/platform/support/wa/${conv.id}`)).body;
    expect(open.conversation.unread).toBe(0);
    expect(open.messages[0]).toMatchObject({ direction: 'in', body: 'Printer is not printing' });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((c) => c.body?.status === 'read' && c.body.message_id === 'wamid.A1')).toBe(true);

    const sent = await admin.post(`/api/platform/support/wa/${conv.id}/messages`).send({ body: 'Please share a photo of the printer settings.' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body).toMatchObject({ direction: 'out', status: 'sent', sentBy: 'Platform Admin' });
    const reply = calls.find((c) => c.body?.type === 'text')!;
    expect(reply.url).toBe('https://graph.facebook.com/v21.0/123456/messages');
    expect(reply.body).toMatchObject({ to: conv.waId, text: { body: 'Please share a photo of the printer settings.' } });
    // The call is in the API log, with the feature that made it.
    expect(await query("SELECT 1 FROM api_calls WHERE service = 'whatsapp' AND feature = 'support_reply' AND ok")).not.toHaveLength(0);

    // Delivery and read ticks arrive later, possibly out of order: only ever forward.
    await hook(statusUpdate(sent.body.id ? 'wamid.OUT2' : 'x', 'read'));
    await hook(statusUpdate('wamid.OUT2', 'delivered'));
    const [m] = await query("SELECT status FROM wa_messages WHERE wa_message_id = 'wamid.OUT2'");
    expect(m.status).toBe('read');
  });

  it('after 24 hours only the approved template can be sent; a failed send is recorded', async () => {
    const admin = await login('admin@ledgerly.in', 'admin123');
    await hook(inbound('919999900003', 'wamid.C1', 'old question', 'Old', Math.floor(Date.now() / 1000) - 2 * 86400));
    const conv = (await admin.get('/api/platform/support/wa')).body.conversations.find((c: { waId: string }) => c.waId === '919999900003');
    expect(conv.windowOpen).toBe(false);
    graph();
    const blocked = await admin.post(`/api/platform/support/wa/${conv.id}/messages`).send({ body: 'hello' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('window_closed');
    const t = await admin.post(`/api/platform/support/wa/${conv.id}/template`);
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    expect(t.body).toMatchObject({ kind: 'template', status: 'sent' });

    await hook(statusUpdate(String((await query("SELECT wa_message_id FROM wa_messages WHERE kind = 'template' ORDER BY id DESC LIMIT 1"))[0].wa_message_id), 'failed', [{ code: 131026, title: 'Message undeliverable' }]));
    const [f] = await query("SELECT status, error FROM wa_messages WHERE kind = 'template' ORDER BY id DESC LIMIT 1");
    expect(f).toMatchObject({ status: 'failed' });
    expect(f.error).toContain('131026');
  });

  it('closes and reopens; never sends the WhatsApp token to a non-Meta address for media; staff only', async () => {
    const admin = await login('admin@ledgerly.in', 'admin123');
    const conv = (await admin.get('/api/platform/support/wa')).body.conversations[0];
    expect((await admin.patch(`/api/platform/support/wa/${conv.id}`).send({ status: 'closed' })).body.status).toBe('closed');
    expect((await admin.get('/api/platform/support/wa?view=closed')).body.conversations.some((c: { id: string }) => c.id === conv.id)).toBe(true);

    await hook({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '919999900004', profile: { name: 'P' } }], messages: [{ from: '919999900004', id: 'wamid.D1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg' } }] } }] }] });
    const [m] = await query("SELECT id FROM wa_messages WHERE wa_message_id = 'wamid.D1'");
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { seen.push(String(url)); return new Response(JSON.stringify({ url: 'https://evil.example.com/steal', mime_type: 'image/jpeg' }), { status: 200 }); }));
    expect((await admin.get(`/api/platform/support/wa/media/${m.id}`)).status).toBe(502);
    expect(seen.every((u) => !u.includes('evil.example.com'))).toBe(true);

    const owner = await login('owner@shop.com', 'owner123');
    expect([401, 403]).toContain((await owner.get('/api/platform/support/wa')).status);
  });
});
