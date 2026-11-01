import { Router } from 'express';
import { z } from 'zod';
import { perm } from '../../auth';
import { audit } from '../../audit';
import { badRequest, parse } from '../../http';
import { query } from '../../db';
import { aiBalance } from '../../services/aiUsage';
import { FEATURES } from '../../../../shared/features';
import { cancelRequest, loadEntitlements, priceList, requestFeature, shopFeatureHistory } from '../../services/features';
import { T } from './ctx';

/** The owner's Features page: what can be switched on, what it costs, what this shop has, and asking for more. */
export const featuresRouter = Router();

featuresRouter.get(
  '/features',
  perm('admin'),
  T(async (_db, _req, c) => {
    const [prices, ent, history] = await Promise.all([priceList(), loadEntitlements(c.shopId), shopFeatureHistory(c.shopId)]);
    return {
      features: FEATURES.filter((f) => f.available).map((f) => {
        const current = history.find((h) => h.feature === f.key && h.status === 'active' && h.live);
        const request = history.find((h) => h.feature === f.key && h.status === 'requested');
        return {
          key: f.key, name: f.name, group: f.group, summary: f.summary, includes: f.includes,
          levels: f.levels.map((l) => ({ ...l, ...prices.find((p) => p.feature === f.key && p.level === l.key)! })),
          on: !!ent[f.key],
          level: ent[f.key] ?? null,
          source: current?.source ?? null,
          endsOn: current?.endsOn ?? null,
          requested: request ? { level: request.level, at: request.createdAt } : null,
        };
      }),
      history: history.slice(0, 50),
    };
  }),
);

featuresRouter.post(
  '/features/:key/request',
  perm('admin'),
  T(async (db, req, c) => {
    const b = parse(z.object({ level: z.string().min(1).max(40), note: z.string().trim().max(300).default('') }), req.body);
    const id = await requestFeature(c.shopId, req.params.key!, b.level, c.email, b.note);
    await audit(db, req, c.shopId, 'request_feature', 'feature', id, { feature: req.params.key, level: b.level });
    return { ok: true };
  }),
);

featuresRouter.delete(
  '/features/:key/request',
  perm('admin'),
  T(async (db, req, c) => {
    await cancelRequest(c.shopId, req.params.key!, c.email);
    await audit(db, req, c.shopId, 'withdraw_feature_request', 'feature', c.shopId, { feature: req.params.key });
  }),
);

/* ---------------- AI credits ---------------- */

const PURPOSE: Record<string, string> = {
  assistant: 'Ask AI', smart_reader: 'Reading bills and photos', bill_parse: 'Type or speak a bill', item_suggest: 'Item details',
  stock_advice: 'Stock advice', reminder: 'Payment reminders', column_map: 'Import column matching', field_summary: 'Field team summary', briefing: 'Daily plan',
};

/** This month's AI credits: allowance, use by person and by tool, the last six months, and the top-up pack on offer. */
featuresRouter.get(
  '/ai/usage',
  perm('admin'),
  T(async (_db, _req, c) => {
    const [balance, byUser, byPurpose, months, [pack], [open]] = await Promise.all([
      aiBalance(c.shopId),
      query(`SELECT coalesce(u.name, 'Unknown') AS name, sum(a.credits) AS credits, count(*)::int AS calls FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.shop_id = $1 AND a.created_at >= date_trunc('month', current_date) GROUP BY 1 ORDER BY 2 DESC`, [c.shopId]),
      query(`SELECT purpose, sum(credits) AS credits, count(*)::int AS calls FROM ai_usage
        WHERE shop_id = $1 AND created_at >= date_trunc('month', current_date) GROUP BY 1 ORDER BY 2 DESC`, [c.shopId]),
      query(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, sum(credits) AS credits FROM ai_usage
        WHERE shop_id = $1 AND created_at >= date_trunc('month', current_date) - interval '5 months' GROUP BY 1 ORDER BY 1`, [c.shopId]),
      query('SELECT ai_topup_credits AS credits, ai_topup_price AS price FROM platform_config WHERE id = 1'),
      query("SELECT credits, price, created_at FROM ai_topups WHERE shop_id = $1 AND status = 'requested'", [c.shopId]),
    ]);
    const n = (v: unknown) => Math.round(Number(v) * 10) / 10;
    return {
      balance,
      byUser: byUser.map((r) => ({ name: r.name, credits: n(r.credits), calls: r.calls })),
      byPurpose: byPurpose.map((r) => ({ purpose: r.purpose, label: PURPOSE[r.purpose] ?? r.purpose, credits: n(r.credits), calls: r.calls })),
      months: months.map((r) => ({ month: r.month, credits: n(r.credits) })),
      pack: { credits: pack.credits, price: Number(pack.price) },
      requested: open ? { credits: open.credits, price: Number(open.price), at: open.created_at } : null,
    };
  }),
);

/** Owner asks for one top-up pack for this month; the platform grants it after payment. */
featuresRouter.post(
  '/ai/topup',
  perm('admin'),
  T(async (db, req, c) => {
    if (!(await loadEntitlements(c.shopId)).ai) throw badRequest('Turn on the AI assistant first');
    const [pack] = await query('SELECT ai_topup_credits AS credits, ai_topup_price AS price FROM platform_config WHERE id = 1');
    const r = await query(`INSERT INTO ai_topups (shop_id, month, credits, price, status, requested_by) VALUES ($1, date_trunc('month', current_date)::date, $2, $3, 'requested', $4)
      ON CONFLICT DO NOTHING RETURNING id`, [c.shopId, pack.credits, pack.price, c.email]);
    if (!r.length) throw badRequest('You have already asked for more credits. We will be in touch shortly.');
    await audit(db, req, c.shopId, 'request_ai_topup', 'feature', r[0].id, { credits: pack.credits });
  }),
);

featuresRouter.delete(
  '/ai/topup',
  perm('admin'),
  T(async (db, req, c) => {
    await query("UPDATE ai_topups SET status = 'declined', decided_by = $2, note = 'Withdrawn by the shop', decided_at = now() WHERE shop_id = $1 AND status = 'requested'", [c.shopId, c.email]);
    await audit(db, req, c.shopId, 'withdraw_ai_topup', 'feature', c.shopId, {});
  }),
);
