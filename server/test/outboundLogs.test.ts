import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { query } from '../src/db';
import { sendMail } from '../src/mailer';
import { outboundStore, pruneOutboundLogs, trackedCall } from '../src/services/outbound';
import { freshDb, login } from './helpers';

const saved = { ...config.mail };
const fetchMock = vi.fn();
const lastEmail = async () => (await query('SELECT * FROM email_log ORDER BY id DESC LIMIT 1'))[0];
const lastCall = async () => (await query('SELECT * FROM api_calls ORDER BY id DESC LIMIT 1'))[0];

beforeAll(async () => { await freshDb(); });
afterEach(() => { Object.assign(config.mail, saved); fetchMock.mockReset(); vi.unstubAllGlobals(); });

const brevo = (status: number, body: string) => {
  Object.assign(config.mail, { brevoKey: 'secret-brevo-key', resendKey: '', smtp: null, from: 'Corpus360 <hello@shop.in>' });
  fetchMock.mockImplementation(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
};

describe('email log', () => {
  it('records an email that could not go out because no provider is set up', async () => {
    Object.assign(config.mail, { brevoKey: '', resendKey: '', smtp: null });
    expect(await sendMail({ kind: 'test_email', to: 'x@y.in', subject: 'Hello', text: 'secret body 123456' })).toBe(false);
    const r = await lastEmail();
    expect(r).toMatchObject({ kind: 'test_email', recipient: 'x@y.in', subject: 'Hello', provider: 'none', status: 'not_sent' });
    expect(r.error).toMatch(/No email provider/);
    expect(JSON.stringify(r)).not.toContain('secret body'); // the body is never kept
  });

  it('records a sent email with the provider’s message id, and the provider call in the API log', async () => {
    brevo(201, '{"messageId":"<202611.abc@smtp-relay.brevo.com>"}');
    const shop = (await query("SELECT id FROM shops LIMIT 1"))[0].id;
    await sendMail({ kind: 'invoice', shopId: shop, to: 'buyer@co.in', cc: 'acc@co.in', subject: 'Invoice INV-1', text: 'x',
      attachments: [{ filename: 'INV-1.pdf', content: Buffer.alloc(3000), contentType: 'application/pdf' }] });
    const r = await lastEmail();
    expect(r).toMatchObject({ kind: 'invoice', status: 'sent', provider: 'brevo', provider_message_id: '<202611.abc@smtp-relay.brevo.com>', shop_id: shop, cc: 'acc@co.in' });
    expect(r.attachments).toEqual([{ name: 'INV-1.pdf', kb: 3 }]);
    const c = await lastCall();
    expect(c).toMatchObject({ service: 'brevo', feature: 'invoice', endpoint: 'api.brevo.com/v3/smtp/email', status_code: 201, ok: true, shop_id: shop });
  });

  it('records a failed email with the provider’s error, then reports the failure as before', async () => {
    brevo(400, '{"message":"sender not valid"}');
    await expect(sendMail({ kind: 'password_reset', to: 'a@b.in', subject: 'Reset', text: 'link' })).rejects.toThrow(/Brevo rejected/);
    const r = await lastEmail();
    expect(r).toMatchObject({ kind: 'password_reset', status: 'failed', provider: 'brevo' });
    expect(r.error).toMatch(/HTTP 400.*sender not valid/);
    expect((await lastCall())).toMatchObject({ service: 'brevo', ok: false, status_code: 400 });
  });

  it('takes the shop and person from the request when the code does not pass them', async () => {
    Object.assign(config.mail, { brevoKey: '', resendKey: '', smtp: null });
    const shop = (await query("SELECT id FROM shops LIMIT 1"))[0].id;
    const user = (await query('SELECT id FROM users WHERE shop_id = $1 LIMIT 1', [shop]))[0].id;
    await outboundStore.run({ shopId: shop, userId: user }, () => sendMail({ kind: 'payment_reminder', to: 'c@d.in', subject: 'Reminder', text: 'x' }));
    expect(await lastEmail()).toMatchObject({ shop_id: shop, user_id: user, kind: 'payment_reminder' });
  });
});

describe('API-call log', () => {
  it('records SDK calls (e.g. the AI) with their feature, and failures with the HTTP status', async () => {
    await trackedCall('anthropic', 'bill_parse', 'api.anthropic.com/v1/messages', async () => ({ id: 'msg_1' }), (r) => r.id);
    expect(await lastCall()).toMatchObject({ service: 'anthropic', feature: 'bill_parse', ok: true, ref: 'msg_1' });
    const overloaded = Object.assign(new Error('Overloaded'), { status: 529 });
    await expect(trackedCall('anthropic', 'assistant', 'api.anthropic.com/v1/messages', async () => { throw overloaded; })).rejects.toThrow('Overloaded');
    expect(await lastCall()).toMatchObject({ service: 'anthropic', feature: 'assistant', ok: false, status_code: 529, error: 'Overloaded' });
  });

  it('removes rows older than the keep periods', async () => {
    await query("INSERT INTO email_log (kind, recipient, subject, provider, status, created_at) VALUES ('other', 'old@x.in', 'Old', 'none', 'not_sent', now() - interval '800 days')");
    await query("INSERT INTO api_calls (service, feature, endpoint, ok, duration_ms, created_at) VALUES ('brevo', 'other', 'x', true, 1, now() - interval '200 days')");
    await pruneOutboundLogs();
    expect(await query("SELECT 1 FROM email_log WHERE recipient = 'old@x.in'")).toHaveLength(0);
    expect(await query("SELECT 1 FROM api_calls WHERE created_at < now() - interval '190 days'")).toHaveLength(0);
  });
});

describe('super admin Logs pages', () => {
  it('lists and filters emails, exports a safe CSV, and is closed to shop users', async () => {
    Object.assign(config.mail, { brevoKey: '', resendKey: '', smtp: null });
    await sendMail({ kind: 'invoice', to: 'filter-me@co.in', subject: '=HYPERLINK("x")', text: 'x' });
    const sa = await login('admin@ledgerly.in', 'admin123');
    const list = await sa.get('/api/platform/logs/emails?q=filter-me');
    expect(list.status).toBe(200);
    expect(list.body.rows[0]).toMatchObject({ recipient: 'filter-me@co.in', status: 'not_sent', purpose: 'Invoice email with PDF' });
    expect((await sa.get('/api/platform/logs/emails?status=problems')).body.rows.every((r: { status: string }) => r.status !== 'sent')).toBe(true);
    const csv = await sa.get('/api/platform/logs/emails?q=filter-me&format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`); // formulas are neutralised
    const owner = await login('owner@shop.com', 'owner123');
    expect([401, 403]).toContain((await owner.get('/api/platform/logs/emails')).status);
  });

  it('maps each outside service to its features and setting names, never their values', async () => {
    process.env.BREVO_API_KEY = 'super-secret-value';
    const sa = await login('admin@ledgerly.in', 'admin123');
    const r = await sa.get('/api/platform/logs/integrations');
    delete process.env.BREVO_API_KEY;
    expect(r.status).toBe(200);
    const b = r.body.services.find((s: { key: string }) => s.key === 'brevo');
    expect(b.settingsStatus).toContainEqual({ name: 'BREVO_API_KEY', set: true });
    expect(b.features.map((f: { key: string }) => f.key)).toContain('signup_code');
    expect(JSON.stringify(r.body)).not.toContain('super-secret-value');
    expect((await sa.get('/api/platform/logs/api-calls?service=anthropic')).body.rows.length).toBeGreaterThan(0);
  });
});
