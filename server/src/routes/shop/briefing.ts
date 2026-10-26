import { Router } from 'express';
import { z } from 'zod';
import { rateLimit, todayISO, userCtx } from '../../auth';
import { many, one, withTenant } from '../../db';
import { forbidden, h, parse } from '../../http';
import { getOrg } from '../../services/common';
import { businessHealth } from '../../services/health';
import { stockInsights } from '../../services/stockInsights';
import { aiError, dailyBriefing } from '../../services/assistant';
import { aiEnabled } from '../../services/extract';
import { T, allowed } from './ctx';

/* The dashboard's "Today" card: a health score from the books, and an AI-written plan for the day with one-tap actions. */
export const briefingRouter = Router();

const canSee = (c: Parameters<typeof allowed>[0]) => allowed(c, 'reports.read') || allowed(c, 'admin');
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

briefingRouter.get('/insights/health', T(async (db, _req, c) => {
  if (!canSee(c)) throw forbidden();
  return businessHealth(db, c.shopId, allowed(c, 'items.cost'));
}));

type Action = { ref: string; kind: 'collect' | 'reorder' | 'expiry' | 'followup' | 'clear'; about: string; link: string; cta: string; phone?: string };

briefingRouter.post('/ai/briefing', rateLimit('ai-brief', 12, 60_000), h(async (req, res) => {
  const c = userCtx(req);
  if (!canSee(c)) throw forbidden();
  const b = parse(z.object({ lang: z.enum(['en', 'hi', 'ta']).default('en'), refresh: z.boolean().default(false) }), req.body ?? {});
  const today = todayISO();
  const ctx = await withTenant(c.shopId, async (db) => {
    const cached = b.refresh ? null : await one(db, 'SELECT content FROM ai_briefings WHERE shop_id = $1 AND date = $2 AND lang = $3', [c.shopId, today, b.lang]);
    const health = await businessHealth(db, c.shopId, allowed(c, 'items.cost'));
    if (cached) return { cached: cached.content, health };
    const org = await getOrg(db, c.shopId);
    const k = await one(db, `SELECT coalesce(sum(total) FILTER (WHERE date = current_date), 0) AS today,
        coalesce(sum(total) FILTER (WHERE date = current_date - 1), 0) AS yesterday,
        coalesce(sum(total) FILTER (WHERE date >= date_trunc('month', current_date)), 0) AS mtd,
        coalesce(sum(total) FILTER (WHERE date >= date_trunc('month', current_date) - interval '1 month' AND date <= current_date - interval '1 month'), 0) AS last_mtd,
        coalesce(sum(GREATEST(total - amount_paid - amount_credited, 0)), 0) AS receivable
      FROM invoices WHERE shop_id = $1 AND status = 'Issued'`, [c.shopId]);
    const overdue = await many(db, `SELECT id, number, coalesce(nullif(customer->>'companyName', ''), customer->>'name') AS customer, customer->>'phone' AS phone,
        total - amount_paid - amount_credited AS balance, current_date - due_date AS late
      FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND due_date < current_date AND total - amount_paid - amount_credited > 0
      ORDER BY total - amount_paid - amount_credited DESC LIMIT 4`, [c.shopId]);
    const ins = await stockInsights(db, c.shopId);
    const follow = await many(db, `SELECT DISTINCT ON (coalesce(customer_id::text, customer_name)) id, customer_name, user_name, notes, next_visit FROM field_visits
      WHERE shop_id = $1 AND next_visit IS NOT NULL AND next_visit <= current_date + 1 AND next_visit >= current_date - 7 ORDER BY coalesce(customer_id::text, customer_name), next_visit LIMIT 3`, [c.shopId]);
    const actions: Action[] = [
      ...overdue.map((o): Action => ({ ref: `collect:${o.id}`, kind: 'collect', about: `${o.customer} owes ${inr(Number(o.balance))} on ${o.number}, ${o.late} days overdue${o.phone ? '' : ' (no phone saved)'}`, link: `/app/sales/invoices/${o.id}`, cta: 'Send reminder', phone: o.phone || undefined })),
      ...ins.reorder.slice(0, 3).map((r): Action => ({ ref: `reorder:${r.itemId}`, kind: 'reorder', about: `${r.name}: ${r.stock} ${r.unit} left${r.daysLeft !== null ? `, about ${r.daysLeft} days of stock` : ''}; order ${r.suggestQty}${r.vendorName ? ` from ${r.vendorName}` : ''}`, link: '/app/inventory/reorder', cta: 'Reorder' })),
      ...ins.expiring.slice(0, 2).map((e): Action => ({ ref: `expiry:${e.itemId}:${e.batchNo}`, kind: 'expiry', about: `${e.qty} of ${e.name} (batch ${e.batchNo}) expire on ${e.expiryDate}`, link: '/app/inventory/reorder', cta: 'See batches' })),
      ...follow.map((f): Action => ({ ref: `followup:${f.id}`, kind: 'followup', about: `Follow up ${f.customer_name} (visited by ${f.user_name}${f.notes ? `: ${f.notes}` : ''}), due ${f.next_visit}`, link: '/app/field/team', cta: 'Open' })),
      ...ins.dead.slice(0, 1).map((d): Action => ({ ref: `clear:${d.itemId}`, kind: 'clear', about: `${d.name}: ${d.stock} ${d.unit} not sold for ${d.daysIdle ?? 90}+ days`, link: '/app/inventory/reorder', cta: 'Plan a clearance' })),
    ];
    return { org, k, health, actions, best: ins.topMovers[0] ?? null };
  });
  if ('cached' in ctx && ctx.cached) return res.json({ ...ctx.cached, health: ctx.health, cached: true });
  const { org, k, health, actions, best } = ctx as Exclude<typeof ctx, { cached: unknown }>;
  let out: Record<string, unknown>;
  const facts = {
    salesToday: inr(Number(k.today)), salesYesterday: inr(Number(k.yesterday)), monthToDate: inr(Number(k.mtd)), sameDaysLastMonth: inr(Number(k.last_mtd)),
    customersOwe: inr(Number(k.receivable)), healthScore: `${health.score}/100 (${health.grade})`, weakestArea: [...health.parts].sort((a, x) => a.score - x.score)[0]?.label,
    bestSeller30Days: best ? `${best.name} (${best.sold30} sold)` : null,
  };
  if (aiEnabled()) {
    const ai = await dailyBriefing({ shop: org.company_name, owner: c.name.split(' ')[0]!, today, facts, refs: actions.map((a) => ({ ref: a.ref, about: a.about })) }, b.lang).catch(aiError);
    const byRef = new Map(actions.map((a) => [a.ref, a]));
    out = { greeting: ai.greeting, tip: ai.tip, actions: ai.actions.map((a) => ({ ...byRef.get(a.ref)!, title: a.title, detail: a.detail })), method: 'ai' };
  } else {
    // Without AI the same actions are listed in plain words.
    out = { greeting: `Sales this month: ${facts.monthToDate} (same days last month ${facts.sameDaysLastMonth}).`, tip: null, actions: actions.slice(0, 5).map((a) => ({ ...a, title: a.about, detail: '' })), method: 'rules' };
  }
  out = { ...out, date: today, lang: b.lang };
  await withTenant(c.shopId, (db) => db.query(`INSERT INTO ai_briefings (shop_id, date, lang, content) VALUES ($1,$2,$3,$4)
    ON CONFLICT (shop_id, date, lang) DO UPDATE SET content = EXCLUDED.content, created_at = now()`, [c.shopId, today, b.lang, JSON.stringify(out)]));
  res.json({ ...out, health, cached: false });
}));
