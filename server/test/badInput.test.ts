import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
});

describe('malformed input gets a clear 4xx, never a 500', () => {
  it('a bad id in the URL is "not found"', async () => {
    for (const url of ['/api/shop/invoices/not-a-uuid', '/api/shop/invoices/1%27%20OR%201=1/print-data', '/api/shop/items/abc/serials']) {
      const r = await owner.get(url);
      expect(r.status, url).toBe(404);
    }
    expect((await owner.post('/api/shop/stock/transfers/not-a-uuid/receive').send({})).status).toBe(404);
  });

  it('an impossible date is a 400 with a readable message', async () => {
    const r = await owner.get('/api/shop/reports/profit-loss?from=2026-01-01&to=2026-13-45');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/valid date/);
  });

  it('a JSON body of null or broken JSON is a 400', async () => {
    const r = await owner.put('/api/shop/organization').set('content-type', 'application/json').send('null');
    expect(r.status).toBe(400);
    const broken = await owner.post('/api/shop/vendors').set('content-type', 'application/json').send('{"name":');
    expect(broken.status).toBe(400);
  });

  it('a NUL byte in an id is a 400', async () => {
    expect((await owner.get('/api/shop/invoices/%00')).status).toBe(400);
  });
});
