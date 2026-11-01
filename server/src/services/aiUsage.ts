import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { aiCost, featureByKey } from '../../../shared/features';
import type { UserCtx } from '../auth';
import { query } from '../db';
import { HttpError } from '../http';
import { sendMail } from '../mailer';
import { loadEntitlements, priceList } from './features';

/*
 * Every AI call goes through meteredCall / meteredRunner. They check that the shop has the AI feature and credits
 * left this month, make the call, and record the tokens the model actually used. One credit is US$0.004 of AI
 * cost (shared/features.ts). Running out never breaks billing: callers fall back to the offline reader or plain
 * text where they can, and otherwise show the "credits used up" message.
 */

interface AiCtx { shopId: string; userId: string; isOwner: boolean }
const store = new AsyncLocalStorage<AiCtx>();

/** Middleware for /api/shop: makes the shop and user available to the AI helpers for the rest of the request. */
export const aiContext = (req: Request, _res: Response, next: NextFunction) => {
  const c = req.ctx as UserCtx;
  store.run({ shopId: c.shopId, userId: c.id, isOwner: c.permissions.includes('admin') }, next);
};

/** For tests and scripts: run fn as if inside a request of this shop and user. */
export const withAiContext = <T>(ctx: AiCtx, fn: () => Promise<T>) => store.run(ctx, fn);

const current = () => {
  const c = store.getStore();
  if (!c) throw new Error('AI call made outside a shop request; it would not be metered');
  return c;
};

export interface AiBalance { level: string | null; included: number; topups: number; allowance: number; used: number; left: number; pct: number }

/** This month's allowance and use for a shop. The month runs by the business clock (IST). */
export async function aiBalance(shopId: string): Promise<AiBalance> {
  const level = (await loadEntitlements(shopId)).ai ?? null;
  const prices = await priceList();
  const included = level ? prices.find((p) => p.feature === 'ai' && p.level === level)?.includedCredits ?? 0 : 0;
  const [r] = await query(`SELECT
      coalesce((SELECT sum(credits) FROM ai_topups WHERE shop_id = $1 AND status = 'granted' AND month = date_trunc('month', current_date)::date), 0) AS topups,
      coalesce((SELECT sum(credits) FROM ai_usage WHERE shop_id = $1 AND created_at >= date_trunc('month', current_date)), 0) AS used`, [shopId]);
  const topups = Number(r.topups);
  const used = Math.round(Number(r.used) * 10) / 10;
  const allowance = included + topups;
  return { level, included, topups, allowance, used, left: Math.max(0, allowance - used), pct: allowance ? Math.min(100, Math.round((used / allowance) * 100)) : 100 };
}

/** Throws a clear error when the shop can't use AI right now. */
async function assertCanUse(c: AiCtx) {
  const ai = featureByKey('ai')!;
  const b = await aiBalance(c.shopId);
  if (!b.level) throw new HttpError(403, `${ai.name} isn’t turned on for this business. ${c.isOwner ? 'You can turn it on in Settings → Features.' : 'Ask the owner to turn it on.'}`, 'feature_off', { feature: 'ai' });
  if (b.used >= b.allowance) {
    throw new HttpError(402, `This month’s AI credits are used up (${Math.round(b.used)} of ${b.allowance}). ${c.isOwner ? 'Add more in Settings → Features, or wait for next month.' : 'Ask the owner to add more, or wait for next month.'}`, 'ai_limit', b);
  }
}

interface UsageLike { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }

async function record(c: AiCtx, purpose: string, model: string, u: UsageLike) {
  const t = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
  const { usd, credits } = aiCost(model, t);
  const before = await aiBalance(c.shopId);
  await query(`INSERT INTO ai_usage (shop_id, user_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, credits)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [c.shopId, c.userId, purpose, model, t.input, t.output, t.cacheRead, t.cacheWrite, usd, credits]);
  await alertOnThreshold(c.shopId, before, before.used + credits).catch((e) => console.error('[ai] usage alert failed:', (e as Error).message));
}

/** Emails the owner once when the month's use passes 80%, and once when it reaches 100%. */
async function alertOnThreshold(shopId: string, before: AiBalance, usedNow: number) {
  if (!before.allowance) return;
  const crossed = [100, 80].find((p) => (before.used / before.allowance) * 100 < p && (usedNow / before.allowance) * 100 >= p);
  if (!crossed) return;
  const [shop] = await query('SELECT name, email, owner_name FROM shops WHERE id = $1', [shopId]);
  if (!shop) return;
  await sendMail({
    to: shop.email,
    subject: crossed === 100 ? 'Your AI credits for this month are used up' : 'You have used 80% of this month’s AI credits',
    text: `Hi ${shop.owner_name},\n\n${shop.name} has used ${Math.round(usedNow)} of ${before.allowance} AI credits this month.${crossed === 100
      ? '\nAI tools are paused until next month. Billing, invoices and everything else keep working; bill photos are read with the basic reader.'
      : ''}\nYou can add more credits in Settings → Features & add-ons.`,
  });
}

/** One metered AI request (create / parse). Returns the response unchanged. */
export async function meteredCall<T extends { model: string; usage: UsageLike }>(purpose: string, call: () => Promise<T>): Promise<T> {
  const c = current();
  await assertCanUse(c);
  const res = await call();
  await record(c, purpose, res.model, res.usage);
  return res;
}

/** A metered tool-runner loop: every step the model takes is recorded. Returns the last message. */
export async function meteredRunner<M extends { model: string; usage: UsageLike }>(purpose: string, start: () => AsyncIterable<M>): Promise<M> {
  const c = current();
  await assertCanUse(c);
  let last: M | undefined;
  for await (const message of start()) {
    await record(c, purpose, message.model, message.usage);
    last = message;
  }
  if (!last) throw new HttpError(502, 'The AI couldn’t answer right now. Please try again.', 'ai_failed');
  return last;
}

/** True when this shop can make an AI call now (has the feature and credits). For callers that fall back quietly. */
export async function aiAvailable(shopId: string) {
  const b = await aiBalance(shopId);
  return !!b.level && b.used < b.allowance;
}

export const isAiLimit = (e: unknown) => e instanceof HttpError && (e.code === 'ai_limit' || e.code === 'feature_off');
