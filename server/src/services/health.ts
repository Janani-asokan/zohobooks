/* Business Health Score: five plain checks, 20 points each, from the shop's own books. No AI — the same numbers every time,
   so owners can watch it move. The AI briefing explains it in words. */
import type { Db } from '../db';
import { one } from '../db';
import { stockInsights } from './stockInsights';

export interface HealthPart { key: 'collections' | 'cash' | 'growth' | 'stock' | 'margin'; label: string; score: number; max: 20; value: string; tip: string }
export interface Health { score: number; grade: 'Excellent' | 'Good' | 'Needs care' | 'At risk'; parts: HealthPart[] }

const clamp = (n: number, lo = 0, hi = 20) => Math.max(lo, Math.min(hi, n));
const pct = (n: number) => `${Math.round(n * 100)}%`;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export async function businessHealth(db: Db, shopId: string, canCost: boolean): Promise<Health> {
  const s = await one(db, `SELECT
      coalesce(sum(GREATEST(total - amount_paid - amount_credited, 0)), 0) AS receivable,
      coalesce(sum(GREATEST(total - amount_paid - amount_credited, 0)) FILTER (WHERE due_date < current_date - 15), 0) AS late,
      coalesce(sum(total) FILTER (WHERE date > current_date - 30), 0) AS billed30,
      coalesce(sum(total) FILTER (WHERE date >= date_trunc('month', current_date)), 0) AS mtd,
      coalesce(sum(total) FILTER (WHERE date >= date_trunc('month', current_date) - interval '1 month' AND date <= current_date - interval '1 month'), 0) AS last_mtd,
      coalesce(sum(sub_total) FILTER (WHERE date > current_date - 90), 0) AS net90
    FROM invoices WHERE shop_id = $1 AND status = 'Issued'`, [shopId]);
  const paid = await one(db, 'SELECT coalesce(sum(amount), 0) AS v FROM payments WHERE shop_id = $1 AND date > current_date - 30', [shopId]);
  const cost = await one(db, `SELECT coalesce(sum((l->>'qty')::numeric * coalesce((l->>'cost')::numeric, it.cost, 0)), 0) AS v
      FROM invoices i CROSS JOIN jsonb_array_elements(i.lines) l LEFT JOIN items it ON it.id = (l->>'itemId')::uuid
     WHERE i.shop_id = $1 AND i.status = 'Issued' AND i.date > current_date - 90`, [shopId]);
  const ins = await stockInsights(db, shopId);

  const receivable = Number(s.receivable); const late = Number(s.late); const billed30 = Number(s.billed30); const collected30 = Number(paid.v);
  const mtd = Number(s.mtd); const lastMtd = Number(s.last_mtd); const net90 = Number(s.net90); const cost90 = Number(cost.v);

  const lateShare = receivable > 0 ? late / receivable : 0;
  const collectRatio = billed30 > 0 ? collected30 / billed30 : 1;
  const growth = lastMtd > 0 ? (mtd - lastMtd) / lastMtd : mtd > 0 ? 0.2 : 0;
  const outShare = ins.totals.items ? ins.totals.outOfStock / ins.totals.items : 0;
  const deadShare = ins.totals.stockValue > 0 ? ins.totals.deadValue / ins.totals.stockValue : 0;
  const margin = net90 > 0 ? (net90 - cost90) / net90 : 0;

  const parts: HealthPart[] = [
    { key: 'collections', label: 'Collections', max: 20, score: Math.round(clamp(20 - lateShare * 40)),
      value: receivable ? `${pct(lateShare)} of dues are 15+ days late` : 'Nothing due', tip: lateShare > 0.2 ? `Chase the ${inr(late)} that is more than 15 days late; send WhatsApp reminders today.` : 'Customers are paying on time. Keep sending invoices with the UPI QR.' },
    { key: 'cash', label: 'Cash coming in', max: 20, score: Math.round(clamp(collectRatio * 20)),
      value: `${inr(collected30)} collected vs ${inr(billed30)} billed (30 days)`, tip: collectRatio < 0.7 ? 'Less cash is coming in than you bill. Ask for part payment on big orders.' : 'Collections keep pace with sales.' },
    { key: 'growth', label: 'Sales growth', max: 20, score: Math.round(clamp(10 + growth * 40)),
      value: lastMtd ? `${growth >= 0 ? '+' : ''}${pct(growth)} vs same days last month` : 'No sales last month to compare', tip: growth < 0 ? 'Sales are behind last month. Message your top customers about new stock or an offer.' : 'Sales are ahead of last month.' },
    { key: 'stock', label: 'Stock health', max: 20, score: Math.round(clamp(20 - outShare * 60 - deadShare * 40)),
      value: `${ins.totals.outOfStock} out of stock · ${canCost ? inr(ins.totals.deadValue) : `${ins.dead.length} items`} not selling`, tip: ins.totals.outOfStock ? 'Reorder what is out of stock from Smart Reorder.' : deadShare > 0.1 ? 'Clear slow stock with bundles or a discount.' : 'Stock is in good shape.' },
    { key: 'margin', label: 'Profit margin', max: 20, score: canCost && net90 > 0 && cost90 > 0 ? Math.round(clamp(margin * 80)) : 10,
      value: !canCost ? 'Visible to the owner' : net90 > 0 && cost90 > 0 ? `${pct(margin)} gross margin (90 days)` : 'Add cost prices to see margin', tip: canCost && margin < 0.12 && cost90 > 0 ? 'Margins are thin. Check bills sold below cost in Bill-wise Profit.' : 'Margins look healthy.' },
  ];
  const score = parts.reduce((a, p) => a + p.score, 0);
  return { score, grade: score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Needs care' : 'At risk', parts };
}
