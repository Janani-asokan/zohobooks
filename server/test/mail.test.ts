import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { config } from '../src/config';
import { sendMail } from '../src/mailer';
import { app, freshDb, login } from './helpers';

const saved = { ...config.mail };
const fetchMock = vi.fn();

beforeAll(async () => {
  await freshDb();
});

afterEach(() => {
  Object.assign(config.mail, saved);
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const useProvider = (p: 'brevo' | 'resend', ok = true) => {
  Object.assign(config.mail, { brevoKey: p === 'brevo' ? 'bk' : '', resendKey: p === 'resend' ? 'rk' : '', smtp: null, from: 'Corpus360 <hello@shop.in>' });
  fetchMock.mockResolvedValue(new Response(ok ? '{"id":"1"}' : '{"message":"sender not verified"}', { status: ok ? 201 : 400 }));
  vi.stubGlobal('fetch', fetchMock);
};

describe('email providers', () => {
  it('sends through Brevo over HTTPS with the sender split into name and address', async () => {
    useProvider('brevo');
    const sent = await sendMail({ to: 'a@b.in', subject: 'Hi', text: 'Body', attachments: [{ filename: 'x.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' }] });
    expect(sent).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('bk');
    const body = JSON.parse(init.body);
    expect(body.sender).toEqual({ name: 'Corpus360', email: 'hello@shop.in' });
    expect(body.to).toEqual([{ email: 'a@b.in' }]);
    expect(body.attachment[0]).toEqual({ name: 'x.pdf', content: Buffer.from('pdf').toString('base64') });
  });

  it('sends through Resend with a bearer key', async () => {
    useProvider('resend');
    expect(await sendMail({ to: 'a@b.in', subject: 'Hi', text: 'Body' })).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer rk');
    expect(JSON.parse(init.body)).toMatchObject({ from: 'Corpus360 <hello@shop.in>', to: ['a@b.in'], text: 'Body' });
  });

  it('reports the provider’s error', async () => {
    useProvider('brevo', false);
    await expect(sendMail({ to: 'a@b.in', subject: 'Hi', text: 'Body' })).rejects.toThrow(/Brevo rejected the email \(HTTP 400\).*sender not verified/);
  });

  it('forgot-password still answers normally when the send fails, and emails the link when it works', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    useProvider('brevo', false);
    const bad = await request(app).post('/api/auth/forgot').set('X-Requested-With', 'ledgerly').send({ email: 'manager@shop.com' });
    expect(bad.status).toBe(200);
    expect(quiet).toHaveBeenCalledWith(expect.stringMatching(/Password reset email to manager@shop.com failed/));
    quiet.mockRestore();

    useProvider('brevo');
    const ok = await request(app).post('/api/auth/forgot').set('X-Requested-With', 'ledgerly').send({ email: 'manager@shop.com' });
    expect(ok.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).textContent).toMatch(/\/reset-password\?token=/);
  });

  it('lets the super admin check the setup, and hands over the owner reset link when email fails', async () => {
    const sa = await login('admin@ledgerly.in', 'admin123');
    Object.assign(config.mail, { brevoKey: '', resendKey: '', smtp: null });
    expect((await sa.get('/api/platform/mail')).body).toMatchObject({ configured: false, provider: null });
    const none = await sa.post('/api/platform/mail/test').send({ to: 'me@shop.in' });
    expect(none.body).toMatchObject({ sent: false, error: expect.stringMatching(/BREVO_API_KEY/) });

    useProvider('brevo', false);
    const failed = await sa.post('/api/platform/mail/test').send({ to: 'me@shop.in' });
    expect(failed.body).toMatchObject({ configured: true, provider: 'brevo', sent: false, error: expect.stringMatching(/sender not verified/) });

    const shopId = (await sa.get('/api/platform/overview')).body.shops[0].id;
    const reset = await sa.post(`/api/platform/shops/${shopId}/reset-owner-password`);
    expect(reset.body.emailed).toBe(false);
    expect(reset.body.devResetUrl).toMatch(/\/reset-password\?token=/);

    useProvider('brevo');
    expect((await sa.post('/api/platform/mail/test').send({ to: 'me@shop.in' })).body.sent).toBe(true);
    expect((await sa.post(`/api/platform/shops/${shopId}/reset-owner-password`)).body.emailed).toBe(true);
  });

  it('is only for the super admin', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    expect([401, 403]).toContain((await owner.get('/api/platform/mail')).status);
  });
});
