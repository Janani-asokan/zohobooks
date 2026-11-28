import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, freshDb, login } from './helpers';
import { query } from '../src/db';
import { setGoogleKeysForTest } from '../src/services/googleAuth';

const CLIENT = '1234567890-abc123def.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims: Record<string, unknown>, key = privateKey) => {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64({ iss: 'https://accounts.google.com', aud: CLIENT, exp: now + 3600, iat: now, email_verified: true, sub: '42', ...claims })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(key, 'base64url')}`;
};
const post = (a: ReturnType<typeof request.agent>, url: string, body: object) => a.post(url).set('X-Requested-With', 'ledgerly').send(body);
const form = { shopName: 'Nila Fruits', ownerName: 'Nila', city: 'Kochi', businessType: 'general' };

let calls: string[] = [];
const msg91 = () => vi.stubGlobal('fetch', vi.fn(async (u: string) => {
  calls.push(String(u));
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (String(u).includes('/otp/verify')) return json(new URL(String(u)).searchParams.get('otp') === '654321' ? { type: 'success', message: 'OTP verified success' } : { type: 'error', message: 'OTP not match' });
  return json({ type: 'success', request_id: 'r' });
}));

beforeAll(async () => {
  await freshDb();
  setGoogleKeysForTest(new Map([['k1', jwk]]));
});
afterEach(() => { vi.unstubAllGlobals(); calls = []; });

describe('Continue with Google', () => {
  it('is off until the super admin adds the client ID', async () => {
    expect((await request(app).get('/api/auth/google')).body).toEqual({ on: false });
    const admin = await login('admin@ledgerly.in', 'admin123');
    expect((await admin.put('/api/platform/google-auth').send({ clientId: 'not-a-client-id', enabled: true })).status).toBe(400);
    expect((await admin.put('/api/platform/google-auth').send({ clientId: CLIENT, enabled: true })).status).toBe(200);
    expect((await request(app).get('/api/auth/google')).body).toEqual({ on: true, clientId: CLIENT });
  });

  it('signs in an existing shop login, and refuses forged, foreign, expired or unverified tokens', async () => {
    const a = request.agent(app);
    const ok = await post(a, '/api/auth/google', { credential: idToken({ email: 'Owner@Shop.com' }) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.user.email).toBe('owner@shop.com');
    expect((await a.get('/api/auth/me')).body.user.email).toBe('owner@shop.com');
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect((await post(request.agent(app), '/api/auth/google', { credential: idToken({ email: 'owner@shop.com' }, other) })).status).toBe(401);
    expect((await post(request.agent(app), '/api/auth/google', { credential: idToken({ email: 'owner@shop.com', aud: 'someone-else' }) })).status).toBe(401);
    expect((await post(request.agent(app), '/api/auth/google', { credential: idToken({ email: 'owner@shop.com', exp: 1000 }) })).status).toBe(401);
    expect((await post(request.agent(app), '/api/auth/google', { credential: idToken({ email: 'owner@shop.com', email_verified: false }) })).status).toBe(401);
    // Super admins keep their password.
    expect((await post(request.agent(app), '/api/auth/google', { credential: idToken({ email: 'admin@ledgerly.in' }) })).status).toBe(403);
  });

  it('offers sign-up for a new Google email, and creates the shop without a password or email code', async () => {
    const cred = idToken({ email: 'nila.fruits@gmail.com', name: 'Nila K' });
    const none = await post(request.agent(app), '/api/auth/google', { credential: cred });
    expect(none.status).toBe(404);
    expect(none.body.details).toEqual({ email: 'nila.fruits@gmail.com', name: 'Nila K' });
    const a = request.agent(app);
    // The email in the form is ignored: Google's is used.
    const r = await post(a, '/api/auth/signup', { ...form, email: 'someone@else.com', phone: '9811122233', googleCredential: cred });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.user.email).toBe('nila.fruits@gmail.com');
    expect((await post(request.agent(app), '/api/auth/google', { credential: cred })).status).toBe(200);
    // Without Google, a password is still required.
    expect((await post(request.agent(app), '/api/auth/signup', { ...form, email: 'x1@shop.in', phone: '9811122299' })).status).toBe(400);
  });
});

describe('sign-up confirms the mobile by SMS when OTP is on', () => {
  it('holds the shop until the SMS code is entered', async () => {
    const admin = await login('admin@ledgerly.in', 'admin123');
    expect((await admin.put('/api/platform/sms').send({ authKey: 'k-1', otpTemplateId: 'otp_t', otpEnabled: true })).status).toBe(200);
    expect((await request(app).get('/api/auth/signup')).body.verifyPhone).toBe(true);
    msg91();
    const a = request.agent(app);
    const r = await post(a, '/api/auth/signup', { ...form, email: 'sms.owner@shop.in', phone: '+91 97000 22233', password: 'Strong123' });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(r.body).toMatchObject({ verify: true, channel: 'sms', phone: '+91 97••• ••233' });
    expect(calls[0]).toContain('template_id=otp_t');
    expect(calls[0]).toContain('mobile=919700022233');
    const bad = await post(a, '/api/auth/signup/verify', { signupId: r.body.signupId, code: '111111' });
    expect(bad.status).toBe(400);
    const ok = await post(a, '/api/auth/signup/verify', { signupId: r.body.signupId, code: '654321' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const [u] = await query("SELECT phone FROM users WHERE email = 'sms.owner@shop.in'");
    expect(u.phone).toBe('9700022233');
    // The same mobile can't start a second shop.
    expect((await post(request.agent(app), '/api/auth/signup', { ...form, email: 'again@shop.in', phone: '9700022233', password: 'Strong123' })).status).toBe(409);
  });
});
