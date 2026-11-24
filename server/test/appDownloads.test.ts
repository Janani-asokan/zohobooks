import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, freshDb, login } from './helpers';

// A tiny stand-in for an APK: a zip file that holds AndroidManifest.xml.
const fakeApk = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('AndroidManifest.xml'), Buffer.alloc(2000, 7)]);

beforeAll(async () => { await freshDb(); });

describe('apps on the website', () => {
  it('nothing to offer for Android until the super admin adds it; Windows is always there', async () => {
    const r = (await request(app).get('/api/public/apps')).body;
    expect(r).toEqual({ android: { apk: null, playUrl: '' }, windows: { url: '/downloads/CorpusLite-Setup.exe' } });
    expect((await request(app).get('/downloads/CorpusLite.apk')).status).toBe(404);
  });

  it('the super admin uploads the .apk; visitors download exactly that file', async () => {
    const admin = await login('admin@ledgerly.in', 'admin123');
    const bad = await admin.put('/api/platform/app-downloads/android').send({ fileBase64: Buffer.from('not an app').toString('base64'), fileName: 'x.aab' });
    expect(bad.status).toBe(400);
    const ok = await admin.put('/api/platform/app-downloads/android').send({ fileBase64: fakeApk().toString('base64'), fileName: 'CorpusLite-1.3.2.apk' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.android.apk).toMatchObject({ version: '1.3.2', url: '/downloads/CorpusLite.apk' });
    const dl = await request(app).get('/downloads/CorpusLite.apk').buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toMatch(/android\.package-archive/);
    expect(dl.headers['content-disposition']).toMatch(/CorpusLite-1\.3\.2\.apk/);
    expect(Buffer.compare(dl.body as Buffer, fakeApk())).toBe(0);
  });

  it('the Play Store link must be a real one; the file stays when only the link changes', async () => {
    const admin = await login('admin@ledgerly.in', 'admin123');
    expect((await admin.put('/api/platform/app-downloads/android').send({ playUrl: 'https://example.com/app' })).status).toBe(400);
    const r = await admin.put('/api/platform/app-downloads/android').send({ playUrl: 'https://play.google.com/store/apps/details?id=in.corpus360.lite' });
    expect(r.body.android.playUrl).toMatch(/in\.corpus360\.lite/);
    expect(r.body.android.apk.version).toBe('1.3.2');
  });

  it('shops can’t change the apps', async () => {
    const owner = await login('owner@shop.com', 'owner123');
    expect((await owner.put('/api/platform/app-downloads/android').send({ playUrl: '' })).status).toBeGreaterThanOrEqual(401);
  });
});
