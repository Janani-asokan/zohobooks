import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../src/db';
import { devOutbox } from '../src/mailer';
import { aiBalance, meteredCall, meteredRunner, withAiContext } from '../src/services/aiUsage';
import { aiCost, USD_PER_CREDIT } from '../../shared/features';
import { freshDb, login } from './helpers';

type Client = Awaited<ReturnType<typeof login>>;
let sa: Client;
let owner: Client;
let shopId: string;
let userId: string;

/** A fake AI response: the metering only reads model and usage. */
const reply = (input: number, output: number, extra: { cacheRead?: number; cacheWrite?: number } = {}) => async () =>
  ({ model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: extra.cacheRead ?? 0, cache_creation_input_tokens: extra.cacheWrite ?? 0 } });
const asOwner = <T>(fn: () => Promise<T>) => withAiContext({ shopId, userId, isOwner: true }, fn);

beforeAll(async () => {
  await freshDb();
  sa = await login('admin@ledgerly.in', 'admin123');
  owner = await login('owner@shop.com', 'owner123');
  shopId = owner.me.shop.id;
  userId = owner.me.user.id;
  // Demo shops get the top AI level; put this one on Standard, the level existing live shops have.
  await sa.post(`/api/platform/shops/${shopId}/features/ai`).send({ level: 'standard', source: 'complimentary', endsOn: null });
});

describe('credits', () => {
  it('are the real cost: input, output and cache tokens each at their own price', () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache read, $5 cache write per million tokens
    const c = aiCost('claude-opus-5-5', { input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 100_000 });
    expect(c.usd).toBeCloseTo(4 + 2 + 0.2 + 0.5, 6);
    expect(c.credits).toBeCloseTo(6.7 / USD_PER_CREDIT, 3);
    // an unknown model is charged at the dearest known price, never less
    expect(aiCost('some-new-model', { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }).usd).toBeGreaterThanOrEqual(aiCost('claude-opus-5-5', { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }).usd);
  });

  it('the demo shop (AI Standard) gets 600 credits a month', async () => {
    const b = await aiBalance(shopId);
    expect(b).toMatchObject({ level: 'standard', included: 600, topups: 0, allowance: 600 });
  });
});

describe('metering', () => {
  it('records every call with its tokens, user and tool', async () => {
    const before = (await aiBalance(shopId)).used;
    await asOwner(() => meteredCall('item_suggest', reply(10_000, 1_000))); // $0.04 + $0.02 = 15 credits
    const [row] = await query("SELECT * FROM ai_usage WHERE shop_id = $1 AND purpose = 'item_suggest' ORDER BY created_at DESC LIMIT 1", [shopId]);
    expect(row).toMatchObject({ user_id: userId, model: 'claude-opus-5-5', input_tokens: 10_000, output_tokens: 1_000 });
    expect(Number(row.credits)).toBeCloseTo(15, 3);
    expect((await aiBalance(shopId)).used).toBeCloseTo(before + 15, 1);
  });

  it('counts every step of a multi-step assistant answer, not just the last one', async () => {
    const before = (await aiBalance(shopId)).used;
    async function* steps() { for (const n of [1, 2, 3]) yield { model: 'claude-opus-5-5', usage: { input_tokens: 1000 * n, output_tokens: 100 } }; }
    const last = await asOwner(() => meteredRunner('assistant', steps));
    expect(last.usage.input_tokens).toBe(3000);
    const n = await query("SELECT count(*)::int AS n FROM ai_usage WHERE shop_id = $1 AND purpose = 'assistant'", [shopId]);
    expect(n[0].n).toBe(3);
    // 6000 in × $4 + 300 out × $20 per million = $0.03 = 7.5 credits
    expect((await aiBalance(shopId)).used).toBeCloseTo(before + 7.5, 1);
  });

  it('refuses an AI call made outside a shop request, so nothing is ever used unmetered', async () => {
    await expect(meteredCall('briefing', reply(1, 1))).rejects.toThrow(/outside a shop request/);
  });

  it('refuses a shop without the AI feature without calling the AI', async () => {
    const basic = await sa.post('/api/platform/shops').send({ shopName: 'No AI', ownerName: 'Ravi', email: 'noai@shop.in', phone: '9876500011', city: 'Salem', planId: 'standard', years: 1, password: 'TempPass1', features: ['pos'] });
    let called = false;
    await expect(withAiContext({ shopId: basic.body.id, userId, isOwner: true }, () => meteredCall('assistant', async () => { called = true; return reply(1, 1)(); })))
      .rejects.toMatchObject({ status: 403, code: 'feature_off' });
    expect(called).toBe(false);
  });
});

describe('limits', () => {
  it('warns by email at 80%, stops at 100% with a clear message, and a top-up lets the shop continue', async () => {
    const outbox = devOutbox();
    const b = await aiBalance(shopId);
    const toReach = (pct: number) => Math.ceil(((b.allowance * pct) / 100 - (b.used)) / 0.25) * 0.25; // credits still to use
    // use up to 85%: 1 credit ($0.004) = 1,000 input tokens at $4 per million
    await asOwner(() => meteredCall('assistant', reply(Math.round(toReach(85) * 1000), 0)));
    expect(outbox.some((m) => m.subject === 'You have used 80% of this month’s AI credits')).toBe(true);
    expect((await aiBalance(shopId)).pct).toBeGreaterThanOrEqual(80);

    await asOwner(() => meteredCall('assistant', reply(Math.round(toReach(101) * 1000), 0)));
    expect(outbox.some((m) => m.subject === 'Your AI credits for this month are used up')).toBe(true);
    let called = false;
    await expect(asOwner(() => meteredCall('assistant', async () => { called = true; return reply(1, 1)(); })))
      .rejects.toMatchObject({ status: 402, code: 'ai_limit', message: expect.stringMatching(/Settings → Features/) });
    expect(called).toBe(false);

    // the owner asks for more, the platform grants it, and AI works again
    expect((await owner.post('/api/shop/ai/topup').send({})).status).toBe(200);
    expect((await owner.post('/api/shop/ai/topup').send({})).status).toBe(400); // one open request at a time
    const reqs = (await sa.get('/api/platform/ai')).body.requests;
    expect(reqs.some((r: { shopId: string }) => r.shopId === shopId)).toBe(true);
    const granted = await sa.post(`/api/platform/shops/${shopId}/ai/topups`).send({ note: 'UTR 9912' });
    expect(granted.status).toBe(200);
    expect(granted.body.topups).toBe(500);
    await expect(asOwner(() => meteredCall('assistant', reply(100, 10)))).resolves.toBeTruthy();
  });

  it('the owner sees use by person and by tool; staff cannot see it', async () => {
    const u = (await owner.get('/api/shop/ai/usage')).body;
    expect(u.balance.allowance).toBe(1100);
    expect(u.byUser[0].name).toBe(owner.me.user.name);
    expect(u.byPurpose.map((p: { label: string }) => p.label)).toContain('Ask AI');
    expect(u.pack).toEqual({ credits: 500, price: 249 });
    const staff = await login('sales@shop.com', 'sales123');
    expect((await staff.get('/api/shop/ai/usage')).status).toBe(403);
  });

  it('the platform sets the pack and the credits included with each level', async () => {
    expect((await sa.put('/api/platform/ai/pack').send({ credits: 1000, price: 399 })).status).toBe(200);
    expect((await owner.get('/api/shop/ai/usage')).body.pack).toEqual({ credits: 1000, price: 399 });
    const put = await sa.put('/api/platform/features/prices').send({ prices: [{ feature: 'ai', level: 'standard', monthly: 299, includedCredits: 800 }] });
    expect(put.body.find((p: { feature: string; level: string }) => p.feature === 'ai' && p.level === 'standard').includedCredits).toBe(800);
    expect((await aiBalance(shopId)).included).toBe(800);
    expect((await sa.put('/api/platform/features/prices').send({ prices: [{ feature: 'pos', level: 'standard', monthly: 199, includedCredits: 5 }] })).status).toBe(400);
  });

  it('the console lists every shop with its use and real cost', async () => {
    const r = (await sa.get('/api/platform/ai')).body;
    const mine = r.shops.find((s: { id: string }) => s.id === shopId);
    expect(mine.calls).toBeGreaterThan(0);
    expect(mine.costUsd).toBeGreaterThan(0);
    expect(r.totalCostUsd).toBeGreaterThanOrEqual(mine.costUsd);
  });
});
