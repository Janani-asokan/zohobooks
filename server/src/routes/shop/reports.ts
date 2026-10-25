import { Router } from 'express';
import { perm, todayISO } from '../../auth';
import { audit } from '../../audit';
import { many, one } from '../../db';
import { badRequest } from '../../http';
import { platformConfig } from '../../services/common';
import { buildGstr1, buildGstr3b, hsnSummary } from '../../services/gstReturns';
import { fyLabel } from '../../../../shared/fy';
import { allowed, T } from './ctx';

export const reportsRouter = Router();

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Home dashboard numbers — available to every role (no cost data). */
reportsRouter.get(
  '/dashboard',
  T(async (db, _req, c) => {
    const cfg = await platformConfig(db);
    const fy = fyLabel(todayISO(), cfg.fyStartMonth);
    const k = await one(
      db,
      `SELECT
         coalesce(sum(GREATEST(total - amount_paid - amount_credited, 0)) FILTER (WHERE status = 'Issued'), 0) AS receivable,
         coalesce(sum(GREATEST(total - amount_paid - amount_credited, 0)) FILTER (WHERE status = 'Issued' AND due_date < current_date), 0) AS overdue,
         count(*) FILTER (WHERE status = 'Issued' AND due_date < current_date AND total - amount_paid - amount_credited > 0) AS overdue_count,
         count(*) FILTER (WHERE status = 'Issued' AND total - amount_paid - amount_credited > 0) AS open_count,
         coalesce(sum(total - amount_credited) FILTER (WHERE status = 'Issued' AND fy = $2), 0) AS fy_sales,
         coalesce(sum(total) FILTER (WHERE status = 'Issued' AND date = current_date), 0) AS today_sales
       FROM invoices WHERE shop_id = $1`,
      [c.shopId, fy],
    );
    const monthly = await many(
      db,
      `SELECT to_char(m, 'YYYY-MM') AS month,
              coalesce((SELECT sum(total) FROM invoices i WHERE i.shop_id = $1 AND i.status = 'Issued' AND date_trunc('month', i.date) = m), 0) AS invoiced,
              coalesce((SELECT sum(amount) FROM payments p WHERE p.shop_id = $1 AND date_trunc('month', p.date) = m), 0) AS collected
         FROM generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m ORDER BY m`,
      [c.shopId],
    );
    const top = await many(
      db,
      `SELECT l->>'name' AS name, sum((l->>'amount')::numeric) AS amount FROM invoices i, jsonb_array_elements(i.lines) l
        WHERE i.shop_id = $1 AND i.status = 'Issued' AND i.fy = $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      [c.shopId, fy],
    );
    const low = await one(db, "SELECT count(*)::int AS n FROM (SELECT i.id FROM items i LEFT JOIN item_stock s ON s.item_id = i.id WHERE i.shop_id = $1 AND i.type = 'Goods' AND NOT i.archived GROUP BY i.id HAVING coalesce(sum(s.qty),0) <= max(i.reorder_level)) x", [c.shopId]);
    const month = await one(db, `SELECT
        coalesce(sum(total) FILTER (WHERE date >= date_trunc('month', current_date)), 0) AS this_month,
        coalesce(sum(total) FILTER (WHERE date >= date_trunc('month', current_date) - interval '1 month' AND date < date_trunc('month', current_date)), 0) AS last_month,
        coalesce(sum(total) FILTER (WHERE date >= date_trunc('month', current_date) - interval '1 month' AND date <= current_date - interval '1 month'), 0) AS last_month_to_date
      FROM invoices WHERE shop_id = $1 AND status = 'Issued'`, [c.shopId]);
    const overdueList = await many(db, `SELECT id, number, due_date, coalesce(nullif(customer->>'companyName', ''), customer->>'name') AS customer, total - amount_paid - amount_credited AS balance
        FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND due_date < current_date AND total - amount_paid - amount_credited > 0 ORDER BY due_date LIMIT 5`, [c.shopId]);
    const lowList = await many(db, `SELECT i.id, i.name, i.unit, i.reorder_level, coalesce(sum(s.qty), 0) AS stock FROM items i LEFT JOIN item_stock s ON s.item_id = i.id
        WHERE i.shop_id = $1 AND i.type = 'Goods' AND NOT i.archived AND NOT i.is_group GROUP BY i.id HAVING coalesce(sum(s.qty), 0) <= max(i.reorder_level) ORDER BY coalesce(sum(s.qty), 0) - max(i.reorder_level), i.name LIMIT 6`, [c.shopId]);
    const pay = allowed(c, 'purchases.read')
      ? await one(db, `SELECT coalesce(sum(amount - amount_paid), 0) AS due, coalesce(sum(amount - amount_paid) FILTER (WHERE due_date < current_date), 0) AS overdue, count(*) FILTER (WHERE due_date < current_date AND amount > amount_paid) AS overdue_n
          FROM bills WHERE shop_id = $1 AND amount > amount_paid`, [c.shopId])
      : null;
    const cash = allowed(c, 'banking.read')
      ? await many(db, `SELECT a.id, a.name, a.type, a.opening_balance + coalesce((SELECT sum(amount) FROM bank_transactions t WHERE t.account_id = a.id), 0) AS balance FROM bank_accounts a WHERE a.shop_id = $1 ORDER BY a.created_at`, [c.shopId])
      : null;
    return {
      fy,
      thisMonthSales: Number(month.this_month),
      lastMonthSales: Number(month.last_month),
      lastMonthToDate: Number(month.last_month_to_date),
      payable: pay ? Number(pay.due) : null,
      payableOverdue: pay ? Number(pay.overdue) : null,
      payableOverdueCount: pay ? Number(pay.overdue_n) : null,
      cash: cash ? cash.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: Number(a.balance) })) : null,
      overdueList: overdueList.map((r) => ({ id: r.id, number: r.number, customer: r.customer || 'Walk-in customer', dueDate: r.due_date, balance: Number(r.balance), days: Math.floor((Date.parse(todayISO()) - Date.parse(r.due_date)) / 86400000) })),
      lowStockList: lowList.map((r) => ({ id: r.id, name: r.name, unit: r.unit, stock: Number(r.stock), reorderLevel: Number(r.reorder_level) })),
      receivable: Number(k.receivable),
      overdue: Number(k.overdue),
      overdueCount: Number(k.overdue_count),
      openCount: Number(k.open_count),
      fySales: Number(k.fy_sales),
      todaySales: Number(k.today_sales),
      lowStock: low.n,
      monthly: monthly.map((m) => ({ month: m.month, invoiced: Number(m.invoiced), collected: Number(m.collected) })),
      topItems: top.map((t) => ({ name: t.name, amount: Number(t.amount) })),
    };
  }),
);

reportsRouter.get(
  '/reports/sales',
  perm('reports.read'),
  T(async (db, req, c) => {
    const fy = String(req.query.fy ?? '');
    if (!/^\d{4}-\d{2}$/.test(fy)) throw badRequest('Choose a financial year');
    const showCost = allowed(c, 'items.cost');
    const monthly = await many(
      db,
      `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS month, count(*) AS count, sum(sub_total) AS net, sum(tax_total) AS tax, sum(total) AS total
         FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND fy = $2 GROUP BY 1 ORDER BY 1`,
      [c.shopId, fy],
    );
    const byCustomer = await many(
      db,
      `SELECT coalesce(customer_id::text, 'walk-in') AS id, max(customer->>'companyName') AS company, max(customer->>'name') AS name, max(customer->>'customId') AS custom_id,
              max(customer->>'type') AS type, count(*) AS count, sum(total) AS total
         FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND fy = $2 GROUP BY 1 ORDER BY total DESC`,
      [c.shopId, fy],
    );
    const byItem = await many(
      db,
      `SELECT l->>'itemId' AS item_id, max(l->>'name') AS name, sum((l->>'qty')::numeric) AS qty, sum((l->>'amount')::numeric) AS amount,
              sum((l->>'qty')::numeric * coalesce(it.cost, 0)) AS cost
         FROM invoices i CROSS JOIN jsonb_array_elements(i.lines) l LEFT JOIN items it ON it.id = (l->>'itemId')::uuid
        WHERE i.shop_id = $1 AND i.status = 'Issued' AND i.fy = $2 GROUP BY 1 ORDER BY amount DESC`,
      [c.shopId, fy],
    );
    const aging = await one(
      db,
      `SELECT
         coalesce(sum(b) FILTER (WHERE d <= 0), 0) AS current, count(*) FILTER (WHERE d <= 0) AS current_n,
         coalesce(sum(b) FILTER (WHERE d BETWEEN 1 AND 15), 0) AS d15, count(*) FILTER (WHERE d BETWEEN 1 AND 15) AS d15_n,
         coalesce(sum(b) FILTER (WHERE d BETWEEN 16 AND 30), 0) AS d30, count(*) FILTER (WHERE d BETWEEN 16 AND 30) AS d30_n,
         coalesce(sum(b) FILTER (WHERE d BETWEEN 31 AND 45), 0) AS d45, count(*) FILTER (WHERE d BETWEEN 31 AND 45) AS d45_n,
         coalesce(sum(b) FILTER (WHERE d > 45), 0) AS older, count(*) FILTER (WHERE d > 45) AS older_n
       FROM (SELECT total - amount_paid - amount_credited AS b, current_date - due_date AS d FROM invoices
              WHERE shop_id = $1 AND status = 'Issued' AND total - amount_paid - amount_credited > 0) x`,
      [c.shopId],
    );
    return {
      monthly: monthly.map((m) => ({ month: m.month, count: Number(m.count), net: Number(m.net), tax: Number(m.tax), total: Number(m.total) })),
      byCustomer: byCustomer.map((r) => ({ id: r.id, name: r.company || r.name, customId: r.custom_id, type: r.type, count: Number(r.count), total: Number(r.total) })),
      byItem: byItem.map((r) => ({ itemId: r.item_id, name: r.name, qty: Number(r.qty), amount: Number(r.amount), cost: showCost ? Number(r.cost) : null })),
      aging: [
        { label: 'Current', amount: Number(aging.current), count: Number(aging.current_n) },
        { label: '1–15 days', amount: Number(aging.d15), count: Number(aging.d15_n) },
        { label: '16–30 days', amount: Number(aging.d30), count: Number(aging.d30_n) },
        { label: '31–45 days', amount: Number(aging.d45), count: Number(aging.d45_n) },
        { label: '> 45 days', amount: Number(aging.older), count: Number(aging.older_n) },
      ],
    };
  }),
);

/** Profit & loss for a financial year: sales − returns − cost of goods − expenses. */
reportsRouter.get(
  '/reports/pnl',
  perm('reports.read'),
  T(async (db, req, c) => {
    const fy = String(req.query.fy ?? '');
    if (!/^\d{4}-\d{2}$/.test(fy)) throw badRequest('Choose a financial year');
    const cfg = await platformConfig(db);
    const from = `${fy.slice(0, 4)}-${String(cfg.fyStartMonth ?? 4).padStart(2, '0')}-01`;
    const showCost = allowed(c, 'items.cost');
    const range = `date >= $2::date AND date < ($2::date + interval '1 year')`;
    const sales = await many(db, `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS m, sum(sub_total) AS v FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND ${range} GROUP BY 1`, [c.shopId, from]);
    const returns = await many(db, `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS m, sum(sub_total) AS v FROM credit_notes WHERE shop_id = $1 AND ${range} GROUP BY 1`, [c.shopId, from]);
    const cogs = await many(
      db,
      `SELECT to_char(date_trunc('month', i.date), 'YYYY-MM') AS m, sum((l->>'qty')::numeric * coalesce(it.cost, 0)) AS v
         FROM invoices i CROSS JOIN jsonb_array_elements(i.lines) l LEFT JOIN items it ON it.id = (l->>'itemId')::uuid
        WHERE i.shop_id = $1 AND i.status = 'Issued' AND i.date >= $2::date AND i.date < ($2::date + interval '1 year') GROUP BY 1`,
      [c.shopId, from],
    );
    const expenses = await many(db, `SELECT category AS k, to_char(date_trunc('month', date), 'YYYY-MM') AS m, sum(amount) AS v FROM expenses WHERE shop_id = $1 AND ${range} GROUP BY 1, 2`, [c.shopId, from]);
    // Vendor bills are stock purchases and reach P&L through cost of goods sold; running costs come from Expenses.
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1 + i, 1));
      return d.toISOString().slice(0, 7);
    });
    const at = (rows: any[], m: string) => Number(rows.find((r) => r.m === m)?.v ?? 0);
    const total = (rows: any[]) => rows.reduce((s, r) => s + Number(r.v), 0);
    const byCat = new Map<string, number>();
    for (const e of expenses) byCat.set(e.k, (byCat.get(e.k) ?? 0) + Number(e.v));
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const income = r2(total(sales) - total(returns));
    const cost = showCost ? r2(total(cogs)) : null;
    const opex = r2([...byCat.values()].reduce((s, v) => s + v, 0));
    return {
      fy, from,
      income: { sales: r2(total(sales)), returns: r2(total(returns)), net: income },
      costOfGoods: cost,
      grossProfit: cost === null ? null : r2(income - cost),
      expenses: [...byCat.entries()].map(([category, amount]) => ({ category, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
      totalExpenses: opex,
      netProfit: cost === null ? null : r2(income - cost - opex),
      monthly: months.map((m) => {
        const inc = at(sales, m) - at(returns, m);
        const exp = expenses.filter((e) => e.m === m).reduce((s, e) => s + Number(e.v), 0);
        return { month: m, income: r2(inc), expenses: r2(exp + (showCost ? at(cogs, m) : 0)), profit: showCost ? r2(inc - at(cogs, m) - exp) : null };
      }),
    };
  }),
);

reportsRouter.get(
  '/gst/gstr1',
  perm('reports.read'),
  T(async (db, req, c, res) => {
    const period = String(req.query.period ?? '');
    if (!PERIOD.test(period)) throw badRequest('Choose a month (YYYY-MM)');
    const out = await buildGstr1(db, c.shopId, period);
    if (req.query.download) {
      await audit(db, req, c.shopId, 'export_gstr1', 'gst', period);
      res.setHeader('Content-Disposition', `attachment; filename="GSTR1_${out.json.gstin || 'NOGSTIN'}_${out.json.fp}.json"`);
      return res.json(out.json);
    }
    return out.summary;
  }),
);

reportsRouter.get(
  '/gst/gstr3b',
  perm('reports.read'),
  T(async (db, req, c, res) => {
    const period = String(req.query.period ?? '');
    if (!PERIOD.test(period)) throw badRequest('Choose a month (YYYY-MM)');
    const out = await buildGstr3b(db, c.shopId, period);
    if (req.query.download) {
      await audit(db, req, c.shopId, 'export_gstr3b', 'gst', period);
      res.setHeader('Content-Disposition', `attachment; filename="GSTR3B_${out.gstin || 'NOGSTIN'}_${period}.json"`);
      return res.json(out);
    }
    return out;
  }),
);

reportsRouter.get(
  '/gst/hsn',
  perm('reports.read'),
  T(async (db, req, c) => {
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (!ISO.test(from) || !ISO.test(to)) throw badRequest('Choose a date range');
    return hsnSummary(db, c.shopId, from, to);
  }),
);

/* ---------- Bill-wise profit ---------- */
// Cost is the item cost saved on the line when the bill was made; older bills fall back to today's cost.
const PROFIT_SQL = `SELECT i.id, i.number, i.date, coalesce(nullif(i.customer->>'companyName', ''), i.customer->>'name') AS customer, i.source,
    i.sub_total AS sales, i.total,
    coalesce(sum((l->>'qty')::numeric * coalesce((l->>'cost')::numeric, it.cost, 0)) FILTER (WHERE l->>'type' = 'Goods' OR it.type = 'Goods'), 0) AS cost
  FROM invoices i CROSS JOIN jsonb_array_elements(i.lines) l LEFT JOIN items it ON it.id = (l->>'itemId')::uuid
  WHERE i.shop_id = $1 AND i.status = 'Issued'`;
const profitRow = (r: any) => {
  const sales = Number(r.sales); const cost = Math.round(Number(r.cost) * 100) / 100;
  return { id: r.id, number: r.number, date: r.date, customer: r.customer, source: r.source, sales, total: Number(r.total), cost, profit: Math.round((sales - cost) * 100) / 100, margin: sales > 0 ? Math.round(((sales - cost) / sales) * 1000) / 10 : 0 };
};

reportsRouter.get(
  '/invoices/:id/profit',
  perm('items.cost'),
  T(async (db, req, c) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id!)) return { profit: null };
    const r = await one(db, `${PROFIT_SQL} AND i.id = $2 GROUP BY i.id`, [c.shopId, req.params.id]);
    const lines = await many(db, `SELECT l->>'name' AS name, (l->>'qty')::numeric AS qty, (l->>'amount')::numeric AS amount,
        (l->>'qty')::numeric * coalesce((l->>'cost')::numeric, it.cost, 0) AS cost
      FROM invoices i CROSS JOIN jsonb_array_elements(i.lines) l LEFT JOIN items it ON it.id = (l->>'itemId')::uuid WHERE i.shop_id = $1 AND i.id = $2`, [c.shopId, req.params.id]);
    return {
      profit: r ? profitRow(r) : null,
      lines: lines.map((l) => ({ name: l.name, qty: Number(l.qty), amount: Number(l.amount), cost: Math.round(Number(l.cost) * 100) / 100, profit: Math.round((Number(l.amount) - Number(l.cost)) * 100) / 100 })),
    };
  }),
);

reportsRouter.get(
  '/reports/bill-profit',
  perm('reports.read'),
  perm('items.cost'),
  T(async (db, req, c) => {
    const from = ISO.test(String(req.query.from)) ? String(req.query.from) : todayISO().slice(0, 8) + '01';
    const to = ISO.test(String(req.query.to)) ? String(req.query.to) : todayISO();
    if (from > to) throw badRequest('From date is after the to date');
    const rows = (await many(db, `${PROFIT_SQL} AND i.date BETWEEN $2 AND $3 GROUP BY i.id ORDER BY i.date DESC, i.number DESC`, [c.shopId, from, to])).map(profitRow);
    const sales = rows.reduce((s, r) => s + r.sales, 0); const cost = rows.reduce((s, r) => s + r.cost, 0);
    return { from, to, rows, totals: { bills: rows.length, sales: Math.round(sales * 100) / 100, cost: Math.round(cost * 100) / 100, profit: Math.round((sales - cost) * 100) / 100, margin: sales > 0 ? Math.round(((sales - cost) / sales) * 1000) / 10 : 0 }, lossMaking: rows.filter((r) => r.profit < 0).length };
  }),
);
