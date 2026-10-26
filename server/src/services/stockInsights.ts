/* Stock intelligence: how fast each item sells, how many days of stock are left, what to reorder (how much, from whom),
   and what is not selling or about to expire. Pure numbers from the shop's own data; the AI layer explains and prioritises. */
import type { Db } from '../db';
import { many } from '../db';

export interface ReorderRow {
  itemId: string; name: string; sku: string; unit: string; category: string; stock: number; reorderLevel: number;
  sold30: number; sold90: number; perDay: number; daysLeft: number | null; trend: number | null;
  suggestQty: number; cost: number; vendorId: string | null; vendorName: string | null; lastPurchaseRate: number | null; urgency: 'out' | 'critical' | 'soon' | 'ok';
}
export interface StockInsights {
  leadDays: number; coverDays: number;
  reorder: ReorderRow[];
  dead: Array<{ itemId: string; name: string; unit: string; stock: number; value: number; lastSold: string | null; daysIdle: number | null }>;
  slow: Array<{ itemId: string; name: string; unit: string; stock: number; perDay: number; daysLeft: number; value: number }>;
  expiring: Array<{ itemId: string; name: string; batchNo: string; expiryDate: string; qty: number; days: number; value: number }>;
  topMovers: Array<{ itemId: string; name: string; sold30: number; trend: number | null }>;
  totals: { items: number; stockValue: number; toReorder: number; outOfStock: number; critical: number; deadValue: number; expiringValue: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * leadDays: how long a supplier takes to deliver. coverDays: how many days of sales an order should cover.
 * Sales speed blends the last 30 days (weight 0.6) with the last 90 (0.4) so one busy week doesn't over-order.
 */
export async function stockInsights(db: Db, shopId: string, opts: { leadDays?: number; coverDays?: number } = {}): Promise<StockInsights> {
  const leadDays = Math.min(60, Math.max(1, opts.leadDays ?? 7));
  const coverDays = Math.min(120, Math.max(7, opts.coverDays ?? 30));
  const rows = await many(db, `
    WITH sales AS (
      SELECT (l->>'itemId')::uuid AS item_id,
             sum((l->>'qty')::numeric) FILTER (WHERE i.date > current_date - 30) AS sold30,
             sum((l->>'qty')::numeric) FILTER (WHERE i.date > current_date - 60 AND i.date <= current_date - 30) AS prev30,
             sum((l->>'qty')::numeric) FILTER (WHERE i.date > current_date - 90) AS sold90,
             max(i.date) AS last_sold
        FROM invoices i CROSS JOIN jsonb_array_elements(i.lines) l
       WHERE i.shop_id = $1 AND i.status = 'Issued' GROUP BY 1),
    stock AS (SELECT item_id, sum(qty) AS qty FROM item_stock WHERE shop_id = $1 GROUP BY 1),
    lastbuy AS (
      SELECT DISTINCT ON (item_id) item_id, vendor_id, rate FROM (
        SELECT (l->>'itemId')::uuid AS item_id, b.vendor_id, (l->>'rate')::numeric AS rate, b.date, b.created_at FROM bills b CROSS JOIN jsonb_array_elements(b.lines) l WHERE b.shop_id = $1
        UNION ALL
        SELECT (l->>'itemId')::uuid, po.vendor_id, (l->>'rate')::numeric, po.date, po.created_at FROM purchase_orders po CROSS JOIN jsonb_array_elements(po.lines) l WHERE po.shop_id = $1 AND po.status <> 'Cancelled'
      ) x ORDER BY item_id, date DESC, created_at DESC)
    SELECT it.id, it.name, it.sku, it.unit, it.category, it.cost, it.reorder_level, coalesce(st.qty, 0) AS stock,
           coalesce(s.sold30, 0) AS sold30, coalesce(s.prev30, 0) AS prev30, coalesce(s.sold90, 0) AS sold90, s.last_sold,
           lb.vendor_id, v.name AS vendor_name, lb.rate AS last_rate, it.created_at::date AS created
      FROM items it LEFT JOIN stock st ON st.item_id = it.id LEFT JOIN sales s ON s.item_id = it.id
      LEFT JOIN lastbuy lb ON lb.item_id = it.id LEFT JOIN vendors v ON v.id = lb.vendor_id
     WHERE it.shop_id = $1 AND it.type = 'Goods' AND NOT it.archived AND NOT it.is_group`, [shopId]);
  const today = new Date(`${(await many(db, 'SELECT current_date::text AS d'))[0]!.d}T00:00:00Z`).getTime();
  const reorder: ReorderRow[] = [];
  const dead: StockInsights['dead'] = [];
  const slow: StockInsights['slow'] = [];
  const movers: StockInsights['topMovers'] = [];
  let stockValue = 0;
  for (const r of rows) {
    const stock = Number(r.stock); const sold30 = Number(r.sold30); const sold90 = Number(r.sold90); const prev30 = Number(r.prev30);
    const cost = Number(r.cost); const level = Number(r.reorder_level);
    const perDay = 0.6 * (sold30 / 30) + 0.4 * (sold90 / 90);
    const daysLeft = perDay > 0 ? Math.max(0, stock) / perDay : null;
    const trend = prev30 > 0 ? Math.round(((sold30 - prev30) / prev30) * 100) : sold30 > 0 ? null : null;
    stockValue += Math.max(0, stock) * cost;
    if (sold30 > 0) movers.push({ itemId: r.id, name: r.name, sold30, trend });
    const target = perDay * (leadDays + coverDays);
    const belowLevel = stock <= level;
    const runsOut = daysLeft !== null && daysLeft <= leadDays + 7;
    if (belowLevel || runsOut) {
      // Order enough to cover lead time + cover days, and at least back up to twice the reorder level.
      const want = Math.max(target, level * 2) - Math.max(0, stock);
      const suggestQty = Math.max(1, Math.ceil(want));
      const urgency = stock <= 0 ? 'out' : daysLeft !== null && daysLeft <= leadDays ? 'critical' : runsOut || belowLevel ? 'soon' : 'ok';
      reorder.push({
        itemId: r.id, name: r.name, sku: r.sku, unit: r.unit, category: r.category, stock, reorderLevel: level, sold30, sold90, perDay: r2(perDay),
        daysLeft: daysLeft === null ? null : Math.floor(daysLeft), trend, suggestQty, cost, vendorId: r.vendor_id, vendorName: r.vendor_name,
        lastPurchaseRate: r.last_rate === null ? null : Number(r.last_rate), urgency,
      });
    }
    const idleSince = r.last_sold ?? r.created;
    const daysIdle = idleSince ? Math.floor((today - new Date(`${idleSince}T00:00:00Z`).getTime()) / 864e5) : null;
    if (stock > 0 && sold90 === 0 && (daysIdle ?? 999) >= 60) dead.push({ itemId: r.id, name: r.name, unit: r.unit, stock, value: r2(stock * cost), lastSold: r.last_sold, daysIdle });
    else if (stock > 0 && daysLeft !== null && daysLeft > 180) slow.push({ itemId: r.id, name: r.name, unit: r.unit, stock, perDay: r2(perDay), daysLeft: Math.floor(daysLeft), value: r2(stock * cost) });
  }
  const rank = { out: 0, critical: 1, soon: 2, ok: 3 } as const;
  reorder.sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999) || b.perDay - a.perDay);
  dead.sort((a, b) => b.value - a.value);
  slow.sort((a, b) => b.value - a.value);
  movers.sort((a, b) => b.sold30 - a.sold30);

  const expiring = (await many(db, `
    SELECT b.item_id, it.name, b.batch_no, b.expiry_date::text AS expiry, sum(b.qty) AS qty, it.cost, b.expiry_date - current_date AS days
      FROM item_batches b JOIN items it ON it.id = b.item_id
     WHERE b.shop_id = $1 AND b.qty > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= current_date + 60
     GROUP BY b.item_id, it.name, b.batch_no, b.expiry_date, it.cost ORDER BY b.expiry_date`, [shopId])).map((e) => ({
    itemId: e.item_id, name: e.name, batchNo: e.batch_no, expiryDate: e.expiry, qty: Number(e.qty), days: Number(e.days), value: r2(Number(e.qty) * Number(e.cost)),
  }));

  return {
    leadDays, coverDays, reorder, dead, slow, expiring, topMovers: movers.slice(0, 10),
    totals: {
      items: rows.length, stockValue: r2(stockValue), toReorder: reorder.length, outOfStock: reorder.filter((r) => r.urgency === 'out').length,
      critical: reorder.filter((r) => r.urgency === 'critical').length, deadValue: r2(dead.reduce((s, d) => s + d.value, 0)), expiringValue: r2(expiring.reduce((s, e) => s + e.value, 0)),
    },
  };
}
