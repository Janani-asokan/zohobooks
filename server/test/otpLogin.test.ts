import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, freshDb, login } from './helpers';
import { query } from '../src/db';

let calls: string[] = [];
/** MSG91's OTP API: send → success; verify → success only for 123456. */
const msg91 = () => vi.stubGlobal('fetch', vi.fn(async (u: string) => {
  calls.push(String(u));
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (String(u).includes('/otp/verify')) return json(new URL(String(u)).searchParams.get('otp') === '123456' ? { type: 'success', message: 'OTP verified success' } : { type: 'error', message: 'OTP not match' });
  return json({ type: 'success', request_id: 'r-1' });
}));
const agent = () => request.agent(app);
const post = (a: ReturnType<typeof agent>, url: string, body: object) => a.post(url).set('X-Requested-With', 'ledgerly').send(body);

beforeAll(async () => {
  await freshDb();
  await query("UPDATE users SET phone = '9840012345' WHERE email = 'owner@shop.com'");
  await query("DELETE FROM login_otps");
});
afterEach(() => { vi.unstubAllGlobals(); calls = []; });

describe('sign in with a mobile OTP (MSG91)', () => {
  it('is hidden until the super admin adds the OTP template and switches it on', async () => {
    expect((await request(app).get('/api/auth/otp')).body).toEqual({ on: false });
    expect((await post(agent(), '/api/auth/otp/send', { phone: '9840012345' })).status).toBe(404);
    const admin = await login('admin@ledgerly.in', 'admin123');
    expect((await admin.put('/api/platform/sms').send({ authKey: 'k-1234', otpEnabled: true })).status).toBe(400); // no OTP template
    const saved = await admin.put('/api/platform/sms').send({ authKey: 'k-1234', otpTemplateId: 'otp_tmpl', otpEnabled: true });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ otpConfigured: true, otpEnabled: true, configured: false, enabled: false });
    expect((await request(app).get('/api/auth/otp')).body).toEqual({ on: true });
    // Bills by SMS stay off without a bill template.
    const owner = await login('owner@shop.com', 'owner123');
    expect((await owner.get('/api/shop/sms/status')).body.on).toBe(false);
  });

  it('sends a code with the OTP template and signs the owner in with it', async () => {
    msg91();
    const a = agent();
    const s = await post(a, '/api/auth/otp/send', { phone: '+91 98400 12345' });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(calls[0]).toContain('https://control.msg91.com/api/v5/otp?');
    expect(calls[0]).toContain('template_id=otp_tmpl');
    expect(calls[0]).toContain('mobile=919840012345');
    // Asking again straight away is refused (30 s gap).
    expect((await post(a, '/api/auth/otp/send', { phone: '9840012345' })).status).toBe(429);
    const bad = await post(a, '/api/auth/otp/verify', { phone: '9840012345', otp: '000000' });
    expect(bad.status).toBe(401);
    const ok = await post(a, '/api/auth/otp/verify', { phone: '9840012345', otp: '123456' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ kind: 'user', user: { email: 'owner@shop.com' } });
    expect((await a.get('/api/auth/me')).body.user.email).toBe('owner@shop.com');
    // The code is used up.
    expect((await post(agent(), '/api/auth/otp/verify', { phone: '9840012345', otp: '123456' })).status).toBe(401);
  });

  it('gives the same answer for a number that is on no login, and sends nothing', async () => {
    msg91();
    const r = await post(agent(), '/api/auth/otp/send', { phone: '9000000001' });
    expect(r.status).toBe(200);
    expect(r.body.sent).toBe(true);
    expect(calls).toHaveLength(0);
    expect((await post(agent(), '/api/auth/otp/verify', { phone: '9000000001', otp: '123456' })).status).toBe(401);
  });

  it('stops guessing after 5 wrong codes', async () => {
    await query("DELETE FROM login_otps");
    msg91();
    const a = agent();
    expect((await post(a, '/api/auth/otp/send', { phone: '9840012345' })).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await post(a, '/api/auth/otp/verify', { phone: '9840012345', otp: '11111' + i })).status).toBe(401);
    expect((await post(a, '/api/auth/otp/verify', { phone: '9840012345', otp: '123456' })).status).toBe(429);
  });

  it('keeps one mobile per login, and the owner can set their own number', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const staff = (await owner.get('/api/shop/staff')).body as Array<{ id: string; role: string; phone: string; email: string }>;
    const own = staff.find((u) => u.email === 'owner@shop.com')!;
    expect(own.phone).toBe('9840012345');
    const other = staff.find((u) => u.role !== 'Owner' && !('linked' in u))!;
    const dup = await owner.patch(`/api/shop/staff/${other.id}`).send({ phone: '98400 12345' });
    expect(dup.status).toBe(409);
    expect((await owner.patch(`/api/shop/staff/${other.id}`).send({ phone: '12345' })).status).toBe(400);
    expect((await owner.patch(`/api/shop/staff/${other.id}`).send({ phone: '+91 97000 11111' })).body.phone).toBe('9700011111');
    expect((await owner.patch(`/api/shop/staff/${own.id}`).send({ phone: '9840054321' })).body.phone).toBe('9840054321');
    expect((await owner.patch(`/api/shop/staff/${own.id}`).send({ name: 'X' })).status).toBe(400);
  });
});
