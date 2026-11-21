import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, freshDb } from './helpers';
import { config } from '../src/config';
import { query } from '../src/db';
import { devOutbox } from '../src/mailer';
import { signupVerifyOn } from '../src/routes/auth';

const H = { 'X-Requested-With': 'ledgerly' };
const form = (email: string, shopName: string) => ({ shopName, ownerName: 'Selvi R', email, phone: '98400 22334', city: 'Salem', businessType: 'kirana', password: 'Sunrise#2026' });
const post = (url: string, body: object) => request(app).post(url).set(H).send(body);
/** The code is the 6 digits on their own line in the last email to this address. */
const codeFor = (email: string) => {
  const m = [...devOutbox()].reverse().find((x) => x.to === email && /Confirm your email/.test(x.subject));
  return m?.text.match(/^\s+(\d{6})\s*$/m)?.[1] ?? '';
};
const wrong = (c: string) => String((Number(c) + 1) % 1_000_000).padStart(6, '0');

const saved = config.signupVerify;
beforeAll(async () => { await freshDb(); });
afterAll(() => { config.signupVerify = saved; });

describe('the switch', () => {
  it("'auto' asks for a code only once an email provider is set up; 'on' and 'off' force it", async () => {
    const key = config.mail.brevoKey;
    config.signupVerify = 'auto';
    config.mail.brevoKey = ''; expect(signupVerifyOn()).toBe(config.mail.smtp !== null || !!config.mail.resendKey);
    config.mail.brevoKey = 'x'; expect(signupVerifyOn()).toBe(true);
    config.mail.brevoKey = key;
    config.signupVerify = 'off'; expect(signupVerifyOn()).toBe(false);
    config.signupVerify = 'on'; expect(signupVerifyOn()).toBe(true);
    expect((await request(app).get('/api/auth/signup')).body.verifyEmail).toBe(true);
  });

  it('with the check off, sign-up creates the shop straight away (as before)', async () => {
    config.signupVerify = 'off';
    const r = await post('/api/auth/signup', form('straight@example.com', 'Straight Stores'));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await query("SELECT 1 FROM users WHERE email = 'straight@example.com'")).toHaveLength(1);
  });
});

describe('with the email check on', () => {
  beforeAll(() => { config.signupVerify = 'on'; });

  it('holds the form until the emailed code is entered, then creates the shop and signs the owner in', async () => {
    const email = 'selvi@example.com';
    const r = await post('/api/auth/signup', form(email, 'Selvi Stores'));
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(r.body).toMatchObject({ verify: true, expiresInMinutes: 15 });
    expect(r.body.email).not.toBe(email); // masked
    expect(await query('SELECT 1 FROM users WHERE email = $1', [email])).toHaveLength(0);
    // The code is in the body only, and the stored form has no plain-text password.
    const mail = [...devOutbox()].reverse().find((x) => x.to === email)!;
    expect(mail.subject).not.toMatch(/\d{6}/);
    const code = codeFor(email);
    expect(code).toMatch(/^\d{6}$/);
    const [row] = await query('SELECT form::text AS f, code_hash FROM signup_verifications WHERE id = $1', [r.body.signupId]);
    expect(row.f).not.toContain('Sunrise#2026');
    expect(row.code_hash).not.toContain(code);

    const bad = await post('/api/auth/signup/verify', { signupId: r.body.signupId, code: wrong(code) });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/2 tries left/);

    const agent = request.agent(app);
    const ok = await agent.post('/api/auth/signup/verify').set(H).send({ signupId: r.body.signupId, code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await agent.get('/api/shop/organization').set(H)).body.companyName).toBe('Selvi Stores');
    expect((await post('/api/auth/login', { email, password: 'Sunrise#2026' })).status).toBe(200);
    // The code can't be used twice.
    expect((await post('/api/auth/signup/verify', { signupId: r.body.signupId, code })).status).toBe(404);
  });

  it('locks a code after 3 wrong tries; a new code (after the wait) works and the old one does not', async () => {
    const email = 'kumar.r@example.com';
    const r = await post('/api/auth/signup', form(email, 'Kumar Traders'));
    const id = r.body.signupId;
    const first = codeFor(email);
    for (let i = 0; i < 3; i++) await post('/api/auth/signup/verify', { signupId: id, code: wrong(first) });
    const locked = await post('/api/auth/signup/verify', { signupId: id, code: first });
    expect(locked.body.code).toBe('code_locked');
    // A new code has to wait a minute.
    expect((await post('/api/auth/signup/resend', { signupId: id })).body.code).toBe('resend_wait');
    await query("UPDATE signup_verifications SET last_sent_at = now() - interval '2 minutes' WHERE id = $1", [id]);
    const again = await post('/api/auth/signup/resend', { signupId: id });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const second = codeFor(email);
    expect(second).not.toBe('');
    if (second !== first) expect((await post('/api/auth/signup/verify', { signupId: id, code: first })).status).toBe(400);
    expect((await post('/api/auth/signup/verify', { signupId: id, code: second })).status).toBe(201);
  });

  it('turns away expired codes, unknown sign-ups and emails that are already in use', async () => {
    const email = 'late@example.com';
    const r = await post('/api/auth/signup', form(email, 'Late Stores'));
    await query("UPDATE signup_verifications SET expires_at = now() - interval '1 minute' WHERE id = $1", [r.body.signupId]);
    expect((await post('/api/auth/signup/verify', { signupId: r.body.signupId, code: codeFor(email) })).body.code).toBe('code_expired');
    expect((await post('/api/auth/signup/verify', { signupId: '00000000-0000-0000-0000-000000000000', code: '123456' })).status).toBe(404);
    expect((await post('/api/auth/signup', form('selvi@example.com', 'Again'))).status).toBe(409);
  });
});
