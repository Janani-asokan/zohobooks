import { generateKeyPairSync, createVerify } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { freshDb, login } from './helpers';
import { resetGa, summarise } from '../src/services/gaTraffic';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyJson = JSON.stringify({ type: 'service_account', client_email: 'traffic@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });

const row = (dims: string[], mets: number[]) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((m) => ({ value: String(m) })) });
const batch = { reports: [
  { rows: [row(['today'], [5, 3, 6, 20]), row(['week'], [40, 30, 55, 210]), row(['month'], [120, 90, 160, 700])] },
  { rows: [row(['20261127'], [9]), row(['20261126'], [7]), row(['20261128'], [5])] },
  { rows: [row(['/'], [150, 90]), row(['/signup'], [30, 25])] },
  { rows: [row(['Organic Search'], [80]), row(['Direct'], [50])] },
  { rows: [row(['sign_up'], [4]), row(['generate_lead'], [6])] },
] };

let calls: Array<{ url: string; init: RequestInit }> = [];
const google = (opts: { reportStatus?: number; reportError?: string } = {}) => vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit) => {
  calls.push({ url: String(u), init });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (String(u).startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'tok-1', expires_in: 3600 });
  if (opts.reportStatus) return json({ error: { message: opts.reportError } }, opts.reportStatus);
  if (String(u).endsWith(':runRealtimeReport')) return json({ rows: [{ metricValues: [{ value: '2' }] }] });
  return json(batch);
}));

beforeAll(async () => { await freshDb(); });
afterEach(() => { vi.unstubAllGlobals(); calls = []; resetGa(); });

describe('website traffic (Google Analytics Data API)', () => {
  it('summarises the batch reports', () => {
    const s = summarise(batch.reports, { rows: [{ metricValues: [{ value: '2' }] }] });
    expect(s.liveNow).toBe(2);
    expect(s.totals.week).toEqual({ users: 40, newUsers: 30, sessions: 55, views: 210 });
    expect(s.daily.map((d) => d.date)).toEqual(['2026-11-26', '2026-11-27', '2026-11-28']);
    expect(s.events).toEqual({ signUps: 4, leads: 6, logins: 0 });
    expect(s.pages[0]).toEqual({ path: '/', views: 150, users: 90 });
  });

  it('is super admin only, keeps the key on the server, signs in with a valid JWT and returns the numbers', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    expect([401, 403]).toContain((await owner.get('/api/platform/ga/traffic')).status);
    const admin = await login('admin@ledgerly.in', 'admin123');
    expect((await admin.get('/api/platform/ga/traffic')).body).toEqual({ configured: false });
    expect((await admin.put('/api/platform/ga').send({ propertyId: 'G-JRTYV5SF8Y', keyJson })).status).toBe(400);
    expect((await admin.put('/api/platform/ga').send({ propertyId: '512345678', keyJson: '{"type":"user"}' })).status).toBe(400);
    const saved = await admin.put('/api/platform/ga').send({ propertyId: '512345678', keyJson });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({ configured: true, propertyId: '512345678', clientEmail: 'traffic@proj.iam.gserviceaccount.com' });
    expect(JSON.stringify((await admin.get('/api/platform/ga')).body)).not.toMatch(/PRIVATE KEY/);

    google();
    const t = await admin.get('/api/platform/ga/traffic');
    expect(t.body).toMatchObject({ configured: true, liveNow: 2, totals: { month: { users: 120 } }, events: { signUps: 4, leads: 6 } });
    const tokenCall = calls[0]!;
    const assertion = new URLSearchParams(String(tokenCall.init.body)).get('assertion')!;
    const [h, b, sig] = assertion.split('.');
    expect(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, sig!, 'base64url')).toBe(true);
    expect(JSON.parse(Buffer.from(b!, 'base64url').toString())).toMatchObject({ iss: 'traffic@proj.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/analytics.readonly' });
    expect(calls[1]!.url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/512345678:batchRunReports');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok-1');

    // Cached: a second look doesn't ask Google again.
    const n = calls.length;
    await admin.get('/api/platform/ga/traffic');
    expect(calls.length).toBe(n);

    // Saving again without a new file keeps the key.
    expect((await admin.put('/api/platform/ga').send({ propertyId: '512345679' })).body.clientEmail).toBe('traffic@proj.iam.gserviceaccount.com');
  });

  it('says which switch to flip when Google refuses', async () => {
    const admin = await login('admin@ledgerly.in', 'admin123');
    await admin.put('/api/platform/ga').send({ propertyId: '512345678', keyJson });
    google({ reportStatus: 403, reportError: 'User does not have sufficient permissions for this property.' });
    const t = await admin.get('/api/platform/ga/traffic?fresh=1');
    expect(t.body.error).toMatch(/Property access management/);
    google({ reportStatus: 403, reportError: 'Google Analytics Data API has not been used in project 123 before or it is disabled.' });
    resetGa();
    expect((await admin.get('/api/platform/ga/traffic?fresh=1')).body.error).toMatch(/Google Analytics Data API/);
    expect((await admin.del('/api/platform/ga')).body.configured).toBe(false);
  });
});
