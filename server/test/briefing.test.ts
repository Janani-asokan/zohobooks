import { beforeAll, describe, expect, it } from 'vitest';
import { freshDb, login } from './helpers';

let owner: Awaited<ReturnType<typeof login>>;
let sales: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  await freshDb();
  owner = await login('owner@shop.com', 'owner123');
  sales = await login('sales@shop.com', 'sales123');
});

describe('business health and the morning plan', () => {
  it('scores five areas out of 20 each, with a grade', async () => {
    const r = await owner.get('/api/shop/insights/health');
    expect(r.status).toBe(200);
    expect(r.body.parts.map((p: any) => p.key)).toEqual(['collections', 'cash', 'growth', 'stock', 'margin']);
    for (const p of r.body.parts) { expect(p.score).toBeGreaterThanOrEqual(0); expect(p.score).toBeLessThanOrEqual(20); }
    expect(r.body.score).toBe(r.body.parts.reduce((s: number, p: any) => s + p.score, 0));
    expect(['Excellent', 'Good', 'Needs care', 'At risk']).toContain(r.body.grade);
  });

  it('lists today’s jobs with links into the app (rules when AI is off), worked out fresh from the books', async () => {
    const r = await owner.post('/api/shop/ai/briefing').send({ lang: 'en' });
    expect(r.status).toBe(200);
    expect(r.body.method).toBe('rules');
    expect(r.body.actions.length).toBeGreaterThan(0);
    const collect = r.body.actions.find((a: any) => a.kind === 'collect');
    expect(collect.link).toMatch(/^\/app\/sales\/invoices\/[0-9a-f-]{36}$/);
    // The plain-words plan is free, so it is never served stale: stock that arrives later in the day shows at once.
    const again = (await owner.post('/api/shop/ai/briefing').send({ lang: 'en' })).body;
    expect(again.cached).toBe(false);
    const low = again.actions.find((a: any) => a.kind === 'reorder');
    if (low) {
      const itemId = low.ref.split(':')[1];
      await owner.post(`/api/shop/items/${itemId}/adjust`).send({ branchId: owner.me.user.branchId, qty: 500, note: 'Stock arrived' });
      const after = (await owner.post('/api/shop/ai/briefing').send({ lang: 'en' })).body;
      expect(after.actions.some((a: any) => a.ref === low.ref)).toBe(false);
    }
  });

  it('is only for people who can see reports', async () => {
    expect((await sales.get('/api/shop/insights/health')).status).toBe(403);
    expect((await sales.post('/api/shop/ai/briefing').send({})).status).toBe(403);
  });
});
