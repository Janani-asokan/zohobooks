import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';
import { query } from '../src/db';
import { attendanceSummary } from '../../shared/attendance';

/**
 * A pretend phone: a WebAuthn authenticator with a P-256 key that "unlocks" with the fingerprint (user verified).
 * It answers exactly as a browser's navigator.credentials does, so the server's checks run for real.
 */
const ORIGIN = 'http://localhost:5173';
const b64 = (b: Buffer) => b.toString('base64url');
function phone(opts: { uv?: boolean; counter?: boolean } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = b64(crypto.randomBytes(32));
  let count = 0;
  const authData = (origin = ORIGIN) => {
    const flags = Buffer.from([opts.uv === false ? 0x01 : 0x05]);
    const ctr = Buffer.alloc(4); if (opts.counter !== false) ctr.writeUInt32BE(++count);
    return Buffer.concat([crypto.createHash('sha256').update(new URL(origin).hostname).digest(), flags, ctr]);
  };
  return {
    credentialId,
    register: (o: { challenge: string; token: string }, origin = ORIGIN) => ({
      token: o.token, credentialId,
      clientDataJSON: b64(Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: o.challenge, origin }))),
      authenticatorData: b64(authData(origin)), publicKey: b64(publicKey.export({ format: 'der', type: 'spki' }) as Buffer), algorithm: -7, label: 'Test phone',
    }),
    sign: (o: { challenge: string; token: string }, origin = ORIGIN, key = privateKey) => {
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: o.challenge, origin }));
      const ad = authData(origin);
      const signature = crypto.sign('sha256', Buffer.concat([ad, crypto.createHash('sha256').update(cd).digest()]), { key, dsaEncoding: 'der' });
      return { token: o.token, credentialId, clientDataJSON: b64(cd), authenticatorData: b64(ad), signature: b64(signature) };
    },
  };
}
const SELFIE = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(3000)]).toString('base64');
const SHOP = { lat: 13.0827, lng: 80.2707 }; // Chennai
const FAR = { lat: 13.0827, lng: 80.2907 }; // ~2.2 km east

let shopId = '';
const setLevel = async (level: string) => {
  const r = await query("UPDATE shop_features SET level = $2 WHERE shop_id = $1 AND feature_key = 'attendance' AND status = 'active' RETURNING id", [shopId, level]);
  if (!r.length) await query(`INSERT INTO shop_features (shop_id, feature_key, level, status, source, starts_on, monthly_price, decided_by)
    VALUES ($1, 'attendance', $2, 'active', 'paid', current_date, 0, 'test')`, [shopId, level]);
};

beforeAll(async () => {
  await freshDb();
  shopId = (await query("SELECT shop_id FROM users WHERE email = 'owner@shop.com'"))[0].shop_id;
  await query("DELETE FROM shop_features WHERE shop_id = $1 AND feature_key = 'attendance'", [shopId]);
  await setLevel('biometric');
});

describe('fingerprint / face unlock check-in', () => {
  const dev = phone();
  let sales: Awaited<ReturnType<typeof login>>;
  beforeAll(async () => { sales = await login('sales@shop.com', 'sales123'); });

  it('asks for a selfie and the fingerprint at the top level', async () => {
    const me = (await sales.get('/api/shop/attendance/me')).body;
    expect(me).toMatchObject({ level: 'biometric', needs: { selfie: true, biometric: true }, state: 'out', canManage: false, devices: [] });
    expect((await sales.post('/api/shop/attendance/mark').send({ kind: 'in', ...SHOP })).body.error).toMatch(/selfie/);
    expect((await sales.post('/api/shop/attendance/mark').send({ kind: 'in', ...SHOP, selfie: SELFIE })).body.error).toMatch(/fingerprint/);
  });

  it('sets up the phone: the key must be for our site and the person verified on the device', async () => {
    const opts = async () => (await sales.post('/api/shop/attendance/devices/options')).body;
    expect((await sales.post('/api/shop/attendance/devices').send(dev.register(await opts(), 'https://evil.example'))).status).toBe(400);
    expect((await sales.post('/api/shop/attendance/devices').send(phone({ uv: false }).register(await opts()))).body.error).toMatch(/fingerprint or face/);
    const o = await opts();
    const r = await sales.post('/api/shop/attendance/devices').send(dev.register(o));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await sales.post('/api/shop/attendance/devices').send(dev.register(o))).status).toBe(400); // the same challenge twice
    expect((await sales.get('/api/shop/attendance/me')).body.devices).toHaveLength(1);
  });

  it('checks in with a signed fingerprint check, a selfie and location; a replay or another key is refused', async () => {
    const ch = (await sales.post('/api/shop/attendance/challenge')).body;
    expect(ch.allow).toEqual([dev.credentialId]);
    const forged = dev.sign(ch, ORIGIN, crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey);
    expect((await sales.post('/api/shop/attendance/mark').send({ kind: 'in', ...SHOP, selfie: SELFIE, assertion: forged })).body.error).toMatch(/didn’t verify/);
    const good = dev.sign(ch);
    const r = await sales.post('/api/shop/attendance/mark').send({ kind: 'in', ...SHOP, accuracy: 12, selfie: SELFIE, assertion: good });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ kind: 'in', method: 'biometric', hasSelfie: true, deviceLabel: 'Test phone' });
    // The same signed answer again (as if copied off the network): refused.
    expect((await sales.post('/api/shop/attendance/mark').send({ kind: 'out', ...SHOP, selfie: SELFIE, assertion: good })).status).toBe(400);
    expect((await sales.post('/api/shop/attendance/mark').send({ kind: 'in', ...SHOP, selfie: SELFIE, assertion: dev.sign((await sales.post('/api/shop/attendance/challenge').send()).body) })).status).toBe(409); // already in
    const out = await sales.post('/api/shop/attendance/mark').send({ kind: 'out', ...SHOP, selfie: SELFIE, assertion: dev.sign((await sales.post('/api/shop/attendance/challenge').send()).body) });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect((await sales.get('/api/shop/attendance/me')).body).toMatchObject({ state: 'out', marks: [{ kind: 'in' }, { kind: 'out' }] });
  });

  it('a device that can’t do fingerprint (the phone app) still checks in with a selfie, flagged for the owner', async () => {
    const r = await sales.post('/api/shop/attendance/mark').send({ kind: 'in', ...SHOP, selfie: SELFIE, noBiometric: 'unsupported' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ method: 'selfie', note: expect.stringMatching(/^No fingerprint/) });
  });

  it('staff see only their own; they can’t open the register or someone else’s selfie', async () => {
    expect((await sales.get('/api/shop/attendance/day')).status).toBe(403);
    const owner = await login('owner@shop.com', 'owner123');
    const mine = (await owner.post('/api/shop/attendance/mark').send({ kind: 'in', ...SHOP, selfie: SELFIE, noBiometric: 'unsupported' })).body;
    expect((await sales.get(`/api/shop/attendance/marks/${mine.id}/selfie`)).status).toBe(403);
    const own = (await sales.get('/api/shop/attendance/me')).body.marks[0];
    const img = await sales.get(`/api/shop/attendance/marks/${own.id}/selfie`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
  });
});

describe('the owner’s register', () => {
  it('flags check-ins far from the shop, marks by hand, and shows who is in today', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    const branches = (await owner.get('/api/shop/attendance/branches')).body;
    for (const b of branches) expect((await owner.put(`/api/shop/attendance/branches/${b.id}`).send({ ...SHOP, radiusM: 200 })).status).toBe(200);
    await setLevel('face');
    const mgr = await login('manager@shop.com', 'manager123');
    const far = await mgr.post('/api/shop/attendance/mark').send({ kind: 'in', ...FAR, accuracy: 20, selfie: SELFIE });
    expect(far.status, JSON.stringify(far.body)).toBe(200);
    expect(far.body.outside).toBe(true);
    expect(far.body.distanceM).toBeGreaterThan(2000);

    const wh = (await query("SELECT id FROM users WHERE email = 'warehouse@shop.com'"))[0].id;
    expect((await owner.post('/api/shop/attendance/manual').send({ userId: wh, kind: 'out', at: new Date().toISOString(), note: 'Forgot phone' })).status).toBe(409);
    // Three hours ago, but never before midnight India time (the register is per India day).
    const istMidnight = new Date(`${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}T00:01:00+05:30`).getTime();
    const at = new Date(Math.max(Date.now() - 3 * 3600_000, istMidnight)).toISOString();
    const expectMin = Math.floor((Date.now() - new Date(at).getTime()) / 60000) - 1;
    const m = await owner.post('/api/shop/attendance/manual').send({ userId: wh, kind: 'in', at, note: 'Forgot phone' });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    expect(m.body).toMatchObject({ method: 'manual', manual: true });

    const day = (await mgr.get('/api/shop/attendance/day')).body; // managers have attendance.manage
    const who = (name: RegExp) => day.people.find((p: any) => name.test(p.name));
    expect(who(/Vignesh/)).toMatchObject({ status: 'in' });
    expect(who(/Murugan/)).toMatchObject({ status: 'in' });
    expect(who(/Murugan/).minutes).toBeGreaterThanOrEqual(expectMin);
    const month = (await owner.get('/api/shop/attendance/month')).body;
    const mp = month.people.find((p: any) => /Vignesh/.test(p.name));
    expect(mp).toMatchObject({ daysPresent: 1, noBiometricMarks: 1 });
  });

  it('at the location level no selfie is needed', async () => {
    await setLevel('manual');
    const acc = await login('accountant@shop.com', 'accountant123').catch(() => null);
    if (!acc) return;
    expect((await acc.post('/api/shop/attendance/mark').send({ kind: 'in', ...SHOP })).status).toBe(200);
  });
});

describe('hours worked', () => {
  it('pairs check-ins with check-outs; an earlier day without check-out adds no hours; today counts to now', () => {
    const m = (kind: 'in' | 'out', day: string, hhmm: string) => ({ userId: 'u', kind, day, at: `${day}T${hhmm}:00+05:30` });
    const s = attendanceSummary([
      m('in', '2026-11-02', '09:30'), m('out', '2026-11-02', '13:00'), m('in', '2026-11-02', '14:00'), m('out', '2026-11-02', '18:30'),
      m('in', '2026-11-03', '10:00'),
      m('in', '2026-11-04', '09:00'),
    ], '2026-11-01', '2026-11-30', new Date('2026-11-04T11:15:00+05:30'));
    expect(s.u!.days['2026-11-02']).toMatchObject({ minutes: 480, status: 'present', open: false }); // 3h30 + 4h30
    expect(s.u!.days['2026-11-03']).toMatchObject({ minutes: 0, open: true, status: 'present' });
    expect(s.u!.days['2026-11-04']).toMatchObject({ minutes: 135, open: true, status: 'in' });
    expect(s.u).toMatchObject({ daysPresent: 3, minutes: 615 });
  });
});
