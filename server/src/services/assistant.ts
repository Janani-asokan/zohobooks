/* AI helpers (only when an Anthropic API key is configured): the "Ask Corpus360" business assistant,
   which answers questions from the shop's own data through read-only tools, and item detail suggestions. */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import { todayISO, type UserCtx } from '../auth';
import { config } from '../config';
import { many, one, withTenant } from '../db';
import { HttpError } from '../http';
import { stockInsights, type StockInsights } from './stockInsights';
import type { Permission } from '../../../shared/permissions';

let client: Anthropic | null = null;
const ai = () => {
  if (!config.ai.apiKey) throw new HttpError(503, 'The AI assistant isn’t set up on this server yet.', 'ai_off');
  return (client ??= new Anthropic({ apiKey: config.ai.apiKey, timeout: 90_000, maxRetries: 1 }));
};

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date as YYYY-MM-DD');
const num = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

/** Tools see only this shop's data (row-level security) and only what the user's role may see. */
function shopTools(c: UserCtx) {
  const has = (...p: Permission[]) => p.some((x) => c.permissions.includes(x));
  const q = <R>(fn: (db: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<R>) => withTenant(c.shopId, fn);
  const deny = (what: string) => `Your role doesn't include access to ${what}. Tell the user to ask the shop owner.`;
  const salesOk = () => has('sales.write', 'reports.read');

  return [
    betaZodTool({
      name: 'business_overview',
      description: 'Headline numbers: sales today / this month / last month / this financial year, money customers owe (and overdue), money owed to vendors, and how many items are low on stock.',
      inputSchema: z.object({}),
      run: async () => q(async (db) => {
        const s = await one(db, `SELECT
            coalesce(sum(total) FILTER (WHERE date = current_date), 0) AS today,
            coalesce(sum(total) FILTER (WHERE date >= date_trunc('month', current_date)), 0) AS this_month,
            coalesce(sum(total) FILTER (WHERE date >= date_trunc('month', current_date) - interval '1 month' AND date < date_trunc('month', current_date)), 0) AS last_month,
            coalesce(sum(GREATEST(total - amount_paid - amount_credited, 0)), 0) AS receivable,
            coalesce(sum(GREATEST(total - amount_paid - amount_credited, 0)) FILTER (WHERE due_date < current_date), 0) AS overdue,
            count(*) FILTER (WHERE due_date < current_date AND total - amount_paid - amount_credited > 0) AS overdue_count
          FROM invoices WHERE shop_id = $1 AND status = 'Issued'`, [c.shopId]);
        const low = await one(db, `SELECT count(*)::int AS n FROM (SELECT i.id FROM items i LEFT JOIN item_stock st ON st.item_id = i.id
            WHERE i.shop_id = $1 AND i.type = 'Goods' AND NOT i.archived AND NOT i.is_group GROUP BY i.id HAVING coalesce(sum(st.qty), 0) <= max(i.reorder_level)) x`, [c.shopId]);
        const pay = has('purchases.read') ? await one(db, `SELECT coalesce(sum(amount - amount_paid), 0) AS due, coalesce(sum(amount - amount_paid) FILTER (WHERE due_date < current_date), 0) AS overdue
            FROM bills WHERE shop_id = $1 AND amount > amount_paid`, [c.shopId]) : null;
        return JSON.stringify({
          today: todayISO(),
          sales: salesOk() ? { today: num(s?.today), thisMonth: num(s?.this_month), lastMonth: num(s?.last_month) } : deny('sales figures'),
          customersOwe: { total: num(s?.receivable), overdue: num(s?.overdue), overdueInvoices: Number(s?.overdue_count ?? 0) },
          vendorsOwed: pay ? { total: num(pay.due), overdue: num(pay.overdue) } : deny('purchases'),
          lowStockItems: low?.n ?? 0,
        });
      }),
    }),
    betaZodTool({
      name: 'sales_report',
      description: 'Issued sales between two dates, grouped by day, month, customer or item. Amounts include GST. Returns up to 40 rows, largest first (or in date order for day/month).',
      inputSchema: z.object({ from: ISO, to: ISO, groupBy: z.enum(['day', 'month', 'customer', 'item']) }),
      run: async ({ from, to, groupBy }) => {
        if (!salesOk()) return deny('sales');
        return q(async (db) => {
          const rows = groupBy === 'item'
            ? await many(db, `SELECT l->>'name' AS key, sum((l->>'qty')::numeric) AS qty, sum((l->>'amount')::numeric) AS amount, count(DISTINCT i.id) AS invoices
                FROM invoices i CROSS JOIN jsonb_array_elements(i.lines) l WHERE i.shop_id = $1 AND i.status = 'Issued' AND i.date BETWEEN $2 AND $3
                GROUP BY 1 ORDER BY amount DESC LIMIT 40`, [c.shopId, from, to])
            : await many(db, `SELECT ${groupBy === 'customer' ? "coalesce(nullif(customer->>'companyName', ''), customer->>'name')" : groupBy === 'month' ? "to_char(date, 'YYYY-MM')" : "to_char(date, 'YYYY-MM-DD')"} AS key,
                  count(*) AS invoices, sum(total) AS amount, sum(tax_total) AS gst
                FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND date BETWEEN $2 AND $3
                GROUP BY 1 ORDER BY ${groupBy === 'customer' ? 'amount DESC' : 'key'} LIMIT 40`, [c.shopId, from, to]);
          const total = await one(db, `SELECT count(*) AS invoices, coalesce(sum(total), 0) AS amount, coalesce(sum(tax_total), 0) AS gst FROM invoices
              WHERE shop_id = $1 AND status = 'Issued' AND date BETWEEN $2 AND $3`, [c.shopId, from, to]);
          return JSON.stringify({ from, to, total: { invoices: Number(total?.invoices ?? 0), amount: num(total?.amount), gst: num(total?.gst) },
            rows: rows.map((r) => ({ ...r, amount: num(r.amount), ...(r.gst !== undefined ? { gst: num(r.gst) } : {}), ...(r.qty !== undefined ? { qty: Number(r.qty) } : {}), invoices: Number(r.invoices) })) });
        });
      },
    }),
    betaZodTool({
      name: 'unpaid_invoices',
      description: 'Customer invoices that still have money due, oldest due date first. Use overdueOnly for invoices past their due date. Optionally filter by customer name.',
      inputSchema: z.object({ overdueOnly: z.boolean(), customer: z.string().optional(), limit: z.number().int().min(1).max(50).optional() }),
      run: async ({ overdueOnly, customer, limit }) => q(async (db) => {
        const rows = await many(db, `SELECT number, date, due_date, coalesce(nullif(customer->>'companyName', ''), customer->>'name') AS customer, customer->>'phone' AS phone,
              total, total - amount_paid - amount_credited AS balance, current_date - due_date AS days_overdue
            FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND total - amount_paid - amount_credited > 0
              AND ($2::boolean IS FALSE OR due_date < current_date)
              AND ($3::text IS NULL OR customer->>'name' ILIKE '%' || $3 || '%' OR customer->>'companyName' ILIKE '%' || $3 || '%')
            ORDER BY due_date LIMIT $4`, [c.shopId, overdueOnly, customer ?? null, limit ?? 20]);
        return JSON.stringify(rows.map((r) => ({ ...r, total: num(r.total), balance: num(r.balance), days_overdue: Math.max(0, Number(r.days_overdue)) })));
      }),
    }),
    betaZodTool({
      name: 'find_items',
      description: 'Look up items (products and services) by name, SKU or barcode, or list items low on stock. Returns stock on hand, selling price and GST rate (and cost price if the user may see it).',
      inputSchema: z.object({ search: z.string().optional().describe('Part of the name, SKU or barcode; omit to list all'), lowStockOnly: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }),
      run: async ({ search, lowStockOnly, limit }) => q(async (db) => {
        const rows = await many(db, `SELECT i.name, i.sku, i.type, i.unit, i.hsn, i.sp1 AS price, i.cost, ts.rate AS gst_rate, i.reorder_level, coalesce(sum(st.qty), 0) AS stock
            FROM items i JOIN tax_slabs ts ON ts.id = i.tax_slab_id LEFT JOIN item_stock st ON st.item_id = i.id
            WHERE i.shop_id = $1 AND NOT i.archived AND NOT i.is_group
              AND ($2::text IS NULL OR i.name ILIKE '%' || $2 || '%' OR i.sku ILIKE '%' || $2 || '%' OR i.barcode = $2)
            GROUP BY i.id, ts.rate HAVING $3::boolean IS FALSE OR (max(i.type) = 'Goods' AND coalesce(sum(st.qty), 0) <= max(i.reorder_level))
            ORDER BY ${lowStockOnly ? 'coalesce(sum(st.qty), 0) - max(i.reorder_level)' : 'i.name'} LIMIT $4`, [c.shopId, search || null, !!lowStockOnly, limit ?? 20]);
        const cost = has('items.cost');
        return JSON.stringify(rows.map(({ cost: cp, ...r }) => ({ ...r, price: num(r.price), gst_rate: Number(r.gst_rate), stock: Number(r.stock), reorder_level: Number(r.reorder_level), ...(cost ? { cost: num(cp) } : {}) })));
      }),
    }),
    betaZodTool({
      name: 'find_customers',
      description: 'Look up customers by name, company or phone, with how much each owes and how much they bought this financial year. Omit search to list the customers who owe the most.',
      inputSchema: z.object({ search: z.string().optional(), limit: z.number().int().min(1).max(50).optional() }),
      run: async ({ search, limit }) => q(async (db) => {
        const rows = await many(db, `SELECT cu.name, cu.company_name, cu.phone, cu.email, cu.gstin, cu.state,
              coalesce(sum(GREATEST(i.total - i.amount_paid - i.amount_credited, 0)) FILTER (WHERE i.status = 'Issued'), 0) AS owes,
              coalesce(sum(i.total) FILTER (WHERE i.status = 'Issued' AND i.date >= current_date - interval '365 days'), 0) AS bought_last_12_months,
              max(i.date) FILTER (WHERE i.status = 'Issued') AS last_invoice
            FROM customers cu LEFT JOIN invoices i ON i.customer_id = cu.id
            WHERE cu.shop_id = $1 AND ($2::text IS NULL OR cu.name ILIKE '%' || $2 || '%' OR cu.company_name ILIKE '%' || $2 || '%' OR cu.phone LIKE '%' || $2 || '%')
            GROUP BY cu.id ORDER BY owes DESC, bought_last_12_months DESC LIMIT $3`, [c.shopId, search || null, limit ?? 15]);
        return JSON.stringify(rows.map((r) => ({ ...r, owes: num(r.owes), bought_last_12_months: num(r.bought_last_12_months) })));
      }),
    }),
    betaZodTool({
      name: 'stock_planning',
      description: 'What to reorder (with suggested quantity, days of stock left, sales per day and usual vendor), dead stock (no sales in 90 days), slow movers, batches expiring within 60 days, and the fastest sellers.',
      inputSchema: z.object({}),
      run: async () => {
        if (!has('items.write', 'purchases.read', 'reports.read')) return deny('stock planning');
        const ins = await q((db) => stockInsights(db, c.shopId));
        const cost = has('items.cost');
        return JSON.stringify({
          reorder: ins.reorder.slice(0, 25).map((r) => ({ name: r.name, stock: r.stock, unit: r.unit, perDay: r.perDay, daysLeft: r.daysLeft, suggestQty: r.suggestQty, vendor: r.vendorName, urgency: r.urgency, trendPct: r.trend })),
          dead: ins.dead.slice(0, 15).map((d) => ({ name: d.name, stock: d.stock, daysIdle: d.daysIdle, ...(cost ? { value: d.value } : {}) })),
          slow: ins.slow.slice(0, 10).map((d) => ({ name: d.name, stock: d.stock, daysOfStock: d.daysLeft })),
          expiring: ins.expiring.slice(0, 15), topMovers: ins.topMovers, totals: cost ? ins.totals : { ...ins.totals, stockValue: undefined, deadValue: undefined, expiringValue: undefined },
        });
      },
    }),
    betaZodTool({
      name: 'purchases_and_expenses',
      description: 'Vendor bills still unpaid, and spending between two dates: bills by vendor and expenses by category.',
      inputSchema: z.object({ from: ISO, to: ISO }),
      run: async ({ from, to }) => {
        if (!has('purchases.read')) return deny('purchases and expenses');
        return q(async (db) => {
          const unpaid = await many(db, `SELECT b.number, b.vendor_bill_no, v.name AS vendor, b.date, b.due_date, b.amount, b.amount - b.amount_paid AS balance
              FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.shop_id = $1 AND b.amount > b.amount_paid ORDER BY b.due_date LIMIT 20`, [c.shopId]);
          const byVendor = await many(db, `SELECT v.name AS vendor, count(*) AS bills, sum(b.amount) AS amount FROM bills b JOIN vendors v ON v.id = b.vendor_id
              WHERE b.shop_id = $1 AND b.date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY amount DESC LIMIT 20`, [c.shopId, from, to]);
          const byCategory = await many(db, `SELECT category, count(*) AS entries, sum(amount + tax_amount) AS amount FROM expenses
              WHERE shop_id = $1 AND date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY amount DESC`, [c.shopId, from, to]);
          return JSON.stringify({
            unpaidBills: unpaid.map((r) => ({ ...r, amount: num(r.amount), balance: num(r.balance) })),
            billsByVendor: byVendor.map((r) => ({ ...r, amount: num(r.amount), bills: Number(r.bills) })),
            expensesByCategory: byCategory.map((r) => ({ ...r, amount: num(r.amount), entries: Number(r.entries) })),
          });
        });
      },
    }),
  ];
}

const ASSISTANT_SYSTEM = `You are the assistant inside Corpus360, a billing, GST and inventory app used by small Indian businesses.
You answer the shop team's questions about their own business using the tools, which read the shop's live data. Look the numbers up; never guess or invent figures.
- Money is in rupees: write ₹1,25,000 (Indian digit grouping). Dates like 5 Apr 2026. The Indian financial year runs April to March.
- Keep answers short and practical: a one-line answer first, then at most a few bullet points or a small table. Plain words, no accounting jargon unless asked.
- If a tool says the user's role can't see something, say so politely.
- You can't create, change or delete records. When the user wants to do something, tell them where in the app to do it (e.g. Sales → Invoices → New invoice; Items → New item; Purchases → Bills).
- General GST, invoicing or business questions you may answer from knowledge, briefly, and say when they should confirm with their CA.`;

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export async function askAssistant(c: UserCtx, shop: { name: string; state: string }, history: ChatTurn[]): Promise<string> {
  const runner = ai().beta.messages.toolRunner({
    model: config.ai.model,
    max_tokens: 16000,
    max_iterations: 8,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: `${ASSISTANT_SYSTEM}\nShop: ${shop.name}${shop.state ? `, ${shop.state}` : ''}. User role: ${c.role}. Today is ${todayISO()}.${festivalLine()}`,
    tools: shopTools(c),
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });
  const final = await runner;
  if (final.stop_reason === 'refusal') return 'Sorry, I can’t help with that one.';
  const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return text || 'I couldn’t find an answer to that. Try asking another way.';
}

/* ---------- Item details from a name ---------- */

const ItemSuggestion = z.object({
  type: z.enum(['Goods', 'Services']),
  hsn: z.string().describe('HSN code for goods or SAC code (starting 99) for services: 4–8 digits, as precise as you can be sure of'),
  gstRate: z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]).describe('Usual GST rate in India for this item, in percent'),
  unit: z.string().describe('Selling unit, one of: pcs, box, kg, g, ltr, ml, m, set, pair, dozen, pack, job, hour, month'),
  category: z.string().describe('Short shop category, e.g. Mobiles, Groceries, Garments, Repairs'),
  brand: z.string().nullable().describe('Brand if the name contains one'),
  description: z.string().describe('One or two plain sentences a customer would read on an invoice or online store; no prices, no claims that are not in the name'),
  note: z.string().nullable().describe('One short caution if the GST rate depends on price or variant (e.g. footwear or garments by price band), else null'),
});
export type ItemSuggestion = z.infer<typeof ItemSuggestion>;

export async function suggestItem(name: string, hint: string): Promise<ItemSuggestion> {
  const response = await ai().beta.messages.parse({
    model: config.ai.model,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: zodOutputFormat(ItemSuggestion) },
    system: 'You help Indian shopkeepers fill in item details for GST billing. Give the most likely HSN/SAC code and GST rate under current Indian GST law for the item described.',
    messages: [{ role: 'user', content: `Item: ${name}${hint ? `\nMore details: ${hint}` : ''}` }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) throw new HttpError(422, 'Couldn’t suggest details for this item. Fill them in by hand.', 'ai_no_answer');
  return response.parsed_output;
}

export function aiError(e: unknown): never {
  if (e instanceof HttpError) throw e;
  if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The AI is busy right now. Try again in a minute.', 'ai_busy');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    console.error('[ai] API key rejected:', e.message);
    throw new HttpError(503, 'The AI key on this server isn’t working. Ask the admin to check ANTHROPIC_API_KEY.', 'ai_key');
  }
  console.error('[ai] request failed:', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error).message);
  throw new HttpError(502, 'The AI couldn’t answer right now. Please try again.', 'ai_failed');
}

/* ---------- Stock advice ---------- */

/** Main shopping festivals and seasons. Lunar-calendar dates can shift by a day by region; the model gets these
 *  instead of guessing, so it never calls a festival past or upcoming wrongly. */
const FESTIVALS: Array<[string, string]> = [
  ['2026-01-14', 'Makar Sankranti / Pongal'], ['2026-01-26', 'Republic Day sales'], ['2026-03-04', 'Holi'], ['2026-03-20', 'Eid al-Fitr'],
  ['2026-04-14', 'Tamil New Year / Vishu / Baisakhi'], ['2026-04-20', 'Akshaya Tritiya'], ['2026-05-27', 'Eid al-Adha'], ['2026-06-01', 'School reopening season'],
  ['2026-08-15', 'Independence Day sales'], ['2026-08-26', 'Onam'], ['2026-08-28', 'Raksha Bandhan'], ['2026-09-04', 'Janmashtami'], ['2026-09-14', 'Ganesh Chaturthi'],
  ['2026-10-11', 'Navratri begins'], ['2026-10-20', 'Dussehra'], ['2026-11-06', 'Dhanteras'], ['2026-11-08', 'Deepavali'], ['2026-12-25', 'Christmas'], ['2026-12-31', 'New Year'],
  ['2027-01-14', 'Makar Sankranti / Pongal'], ['2027-01-26', 'Republic Day sales'], ['2027-03-10', 'Eid al-Fitr'], ['2027-03-22', 'Holi'], ['2027-04-14', 'Tamil New Year / Vishu / Baisakhi'],
  ['2027-05-17', 'Eid al-Adha'], ['2027-06-01', 'School reopening season'], ['2027-08-15', 'Independence Day sales'], ['2027-08-17', 'Raksha Bandhan'],
  ['2027-09-04', 'Ganesh Chaturthi'], ['2027-10-09', 'Dussehra'], ['2027-10-29', 'Deepavali'], ['2027-12-25', 'Christmas'],
];
const festivalLine = () => {
  const f = upcomingFestivals(todayISO());
  return f.length ? ` Coming up (use these dates, don't guess others): ${f.map((x) => `${x.name} ${x.date}`).join(', ')}.` : '';
};
const upcomingFestivals = (today: string) => {
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + 45 * 864e5).toISOString().slice(0, 10);
  return FESTIVALS.filter(([d]) => d >= today && d <= end).map(([date, name]) => ({ date, name }));
};

const StockAdvice = z.object({
  headline: z.string().describe('One sentence: the single most important stock action this week'),
  actions: z.array(z.object({
    priority: z.enum(['high', 'medium', 'low']),
    title: z.string().describe('Short imperative, e.g. "Reorder 40 pcs of Logitech M331 from Redington"'),
    detail: z.string().describe('One or two plain sentences with the numbers behind it'),
    kind: z.enum(['reorder', 'clearance', 'expiry', 'pricing', 'season', 'other']),
  })).max(8),
  seasonal: z.string().nullable().describe('From the listed upcoming festivals only: which one changes demand for this shop and what to stock up on or promote; null if none is listed or relevant'),
});
export type StockAdvice = z.infer<typeof StockAdvice>;

export async function stockAdvice(ins: StockInsights, shop: { name: string; state: string }, canCost: boolean): Promise<StockAdvice> {
  const data = {
    today: todayISO(), leadDays: ins.leadDays, coverDays: ins.coverDays,
    reorder: ins.reorder.slice(0, 30).map((r) => ({ name: r.name, category: r.category, stock: r.stock, unit: r.unit, perDay: r.perDay, daysLeft: r.daysLeft, suggestQty: r.suggestQty, vendor: r.vendorName, urgency: r.urgency, trendPct: r.trend })),
    dead: ins.dead.slice(0, 15).map((d) => ({ name: d.name, stock: d.stock, daysIdle: d.daysIdle, ...(canCost ? { value: d.value } : {}) })),
    slow: ins.slow.slice(0, 10).map((d) => ({ name: d.name, stock: d.stock, daysOfStock: d.daysLeft })),
    expiring: ins.expiring.slice(0, 15).map((e) => ({ name: e.name, batch: e.batchNo, expires: e.expiryDate, qty: e.qty })),
    topMovers: ins.topMovers,
    upcomingFestivals: upcomingFestivals(todayISO()),
  };
  const response = await ai().beta.messages.parse({
    model: config.ai.model,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: zodOutputFormat(StockAdvice) },
    system: `You are a stock-planning adviser for a small Indian shop (${shop.name}${shop.state ? `, ${shop.state}` : ''}). You get its computed stock figures. Turn them into a short, prioritised to-do list in plain words.
- Use only the numbers given; never invent items or figures. Quantities keep their units. Money as ₹ with Indian grouping.
- Reorder first (out of stock, then running out soonest), then expiring batches (sell first, discount, or return to supplier), then dead stock (bundle, discount, return), then pricing or trend notes.
- For seasons, use only upcomingFestivals (dates are given); if it is empty, set seasonal to null. Never say a festival has passed or is coming unless its date is listed.
- Keep each detail to one or two sentences. At most 8 actions.`,
    messages: [{ role: 'user', content: JSON.stringify(data) }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) throw new HttpError(422, 'Couldn’t prepare stock advice right now.', 'ai_no_answer');
  return response.parsed_output;
}

/* ---------- Type or speak a bill ---------- */

export interface ParsedBill {
  customer: { id: string; name: string } | null;
  customerText: string | null;
  lines: Array<{ itemId: string; name: string; qty: number; rate: number | null; discount: number }>;
  unmatched: string[];
  billDiscount: { kind: 'percent' | 'amount'; value: number } | null;
  paymentMode: 'Cash' | 'UPI' | 'Card' | null;
  pricesIncludeTax: boolean | null;
  notes: string | null;
}

/**
 * Turns "3 Logitech mouse and a Dell monitor for Nila Textiles, 5% off, paid by UPI" into bill lines. The model looks up
 * the shop's real items and customers through read-only tools and finishes by calling fill_bill; every id it returns is
 * checked against the database before the form sees it.
 */
export async function parseBill(c: UserCtx, text: string, context: 'invoice' | 'pos'): Promise<ParsedBill> {
  const q = <R>(fn: (db: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<R>) => withTenant(c.shopId, fn);
  let result: ParsedBill | null = null;
  const tools = [
    betaZodTool({
      name: 'search_items',
      description: 'Find the shop\'s items by words from the name, brand, SKU or barcode. Returns up to 8 matches with id, name, unit, price and stock. Search once per product mentioned; try a shorter query if nothing matches.',
      inputSchema: z.object({ query: z.string().min(1) }),
      run: async ({ query }) => q(async (db) => {
        const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 5);
        const rows = await many(db, `SELECT i.id, i.name, i.sku, i.unit, i.sp1, i.mrp, coalesce((SELECT sum(qty) FROM item_stock s WHERE s.item_id = i.id), 0) AS stock
            FROM items i WHERE i.shop_id = $1 AND NOT i.archived AND NOT i.is_group
              AND (i.barcode = $2 OR lower(i.sku) = $2 OR (SELECT bool_and(lower(i.name || ' ' || i.brand || ' ' || i.sku || ' ' || i.category) LIKE '%' || w || '%') FROM unnest($3::text[]) w))
            ORDER BY length(i.name) LIMIT 8`, [c.shopId, query.trim().toLowerCase(), words.length ? words : [query.toLowerCase()]]);
        return JSON.stringify(rows.map((r) => ({ id: r.id, name: r.name, sku: r.sku, unit: r.unit, price: Number(r.sp1), mrp: r.mrp === null ? null : Number(r.mrp), stock: Number(r.stock) })));
      }),
    }),
    betaZodTool({
      name: 'search_customers',
      description: 'Find customers by name, company or phone. Returns up to 6 matches with id.',
      inputSchema: z.object({ query: z.string().min(1) }),
      run: async ({ query }) => q(async (db) => JSON.stringify(await many(db,
        `SELECT id, name, company_name, phone FROM customers WHERE shop_id = $1 AND (name ILIKE '%' || $2 || '%' OR company_name ILIKE '%' || $2 || '%' OR phone LIKE '%' || $2 || '%') ORDER BY company_name, name LIMIT 6`, [c.shopId, query.trim()]))),
    }),
    betaZodTool({
      name: 'fill_bill',
      description: 'Call this once at the end with the bill to fill in. Use only ids returned by the searches.',
      inputSchema: z.object({
        customerId: z.string().nullable().describe('id from search_customers, or null for walk-in / not found'),
        customerText: z.string().nullable().describe('the customer as the user said it, if any'),
        lines: z.array(z.object({ itemId: z.string(), qty: z.number().positive(), rate: z.number().min(0).nullable().describe('only if the user said a price'), discount: z.number().min(0).max(100).nullable().describe('line discount % if said for this item') })),
        unmatched: z.array(z.string()).describe('products the user mentioned that no search found'),
        billDiscount: z.object({ kind: z.enum(['percent', 'amount']), value: z.number().min(0) }).nullable().describe('discount on the whole bill, e.g. "5% off" or "₹100 off"'),
        paymentMode: z.enum(['Cash', 'UPI', 'Card']).nullable(),
        pricesIncludeTax: z.boolean().nullable().describe('true if the user said MRP / inclusive prices'),
        notes: z.string().nullable(),
      }),
      run: async (b) => {
        const ids = [...new Set(b.lines.map((l) => l.itemId))];
        const found = await q((db) => many(db, 'SELECT id, name FROM items WHERE shop_id = $1 AND id::text = ANY($2::text[]) AND NOT archived AND NOT is_group', [c.shopId, ids]));
        const names = new Map(found.map((f) => [f.id, f.name]));
        const cust = b.customerId ? await q((db) => one(db, 'SELECT id, coalesce(nullif(company_name, \'\'), name) AS name FROM customers WHERE shop_id = $1 AND id::text = $2', [c.shopId, b.customerId])) : null;
        result = {
          customer: cust ? { id: cust.id, name: cust.name } : null, customerText: b.customerText,
          lines: b.lines.filter((l) => names.has(l.itemId)).map((l) => ({ itemId: l.itemId, name: names.get(l.itemId)!, qty: l.qty, rate: l.rate, discount: l.discount ?? 0 })),
          unmatched: b.unmatched, billDiscount: b.billDiscount && b.billDiscount.value > 0 ? b.billDiscount : null, paymentMode: b.paymentMode, pricesIncludeTax: b.pricesIncludeTax, notes: b.notes,
        };
        return 'Filled. Reply with one short sentence summarising the bill.';
      },
    }),
  ];
  await ai().beta.messages.toolRunner({
    model: config.ai.model,
    max_tokens: 8000,
    max_iterations: 10,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: `You fill in a ${context === 'pos' ? 'counter (POS) bill' : 'sales invoice'} for an Indian shop from what the cashier typed or said (English, Hinglish or a mix; numbers may be words: "do" = 2, "teen" = 3, "ek" = 1, "dozen" = 12).
Search for every product mentioned and pick the closest match; if two are equally likely, prefer the one in stock. Search the customer if one is named.
Never invent ids. Then call fill_bill exactly once.`,
    tools,
    messages: [{ role: 'user', content: text }],
  });
  if (!result) throw new HttpError(422, 'Couldn’t understand that bill. Try naming the items and quantities, e.g. “2 USB cable, 1 mouse”.', 'ai_no_answer');
  return result;
}

/* ---------- Payment reminder messages ---------- */

export async function draftReminder(inv: { number: string; date: string; dueDate: string; total: number; balance: number; customer: string; daysOverdue: number; payLink: string | null; upiId: string | null },
  shop: string, tone: 'friendly' | 'polite' | 'firm', language: string): Promise<string> {
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const daysToDue = Math.round((Date.parse(`${inv.dueDate}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 864e5);
  // The model gets the due status as words, so it never has to work out dates itself.
  const facts = {
    customer: inv.customer, invoice: inv.number, invoiceDate: fmt(inv.date), amountDue: `₹${inv.balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
    dueStatus: daysToDue > 0 ? `due on ${fmt(inv.dueDate)} (in ${daysToDue} day${daysToDue === 1 ? '' : 's'})` : daysToDue === 0 ? `due today, ${fmt(inv.dueDate)}` : `overdue by ${-daysToDue} day${daysToDue === -1 ? '' : 's'} (was due on ${fmt(inv.dueDate)})`,
    payLink: inv.payLink, upiId: inv.upiId,
  };
  const response = await ai().beta.messages.create({
    model: config.ai.model,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: `You write one WhatsApp payment reminder for an Indian shop, ${shop}, using only the facts given. Language: ${language}${language === 'English' || language === 'Hinglish' ? '' : ' in its own script; keep the invoice number, amount, link and UPI ID exactly as given'}.
Tone: ${tone === 'firm' ? 'firm but respectful; if overdue, ask for payment within 3 days' : tone === 'friendly' ? 'warm and casual, like a shopkeeper who knows the customer' : 'polite and professional'}.
Take the timing from dueStatus (translate it into the message language, keeping its dates and numbers). Include the amount due, the invoice number, and the payment link and UPI ID when given. Under 80 words, no subject line, no placeholders. You may end with 🙏.
Reply with the finished message only.`,
    messages: [{ role: 'user', content: JSON.stringify(facts) }],
  });
  if (response.stop_reason === 'refusal') throw new HttpError(422, 'Couldn’t write this reminder.', 'ai_no_answer');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) throw new HttpError(502, 'The AI returned an empty message. Try again.', 'ai_failed');
  return text;
}

/* ---------- Column mapping for imports ---------- */

export async function mapColumns(kind: 'customers' | 'vendors' | 'items' | null, headers: string[], sample: Array<Record<string, string>>, fields: Record<string, Array<{ key: string; label: string }>>) {
  const Out = z.object({
    kind: z.enum(['customers', 'vendors', 'items']).describe('What the file lists'),
    mapping: z.array(z.object({ field: z.string().describe('our field key'), column: z.string().nullable().describe('exact header from the file, or null') })),
    note: z.string().nullable().describe('One short sentence if something needs the user’s attention, e.g. prices include GST, or quantities are in boxes'),
  });
  const response = await ai().beta.messages.parse({
    model: config.ai.model,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: zodOutputFormat(Out) },
    system: 'You map spreadsheet columns exported from Indian billing software (Tally, Vyapar, Busy, Marg, Zoho, Excel) to an app\'s import fields. Use the header names and the sample values. Each column maps to at most one field. Use exact header text. Leave a field null when no column fits. Currency symbols, commas, "/-" and formats like "GST@18%" are cleaned automatically, so never mention them in the note.',
    messages: [{ role: 'user', content: JSON.stringify({ expectedKind: kind, ourFields: fields, headers, sampleRows: sample.slice(0, 5) }) }],
  });
  if (!response.parsed_output) throw new HttpError(422, 'Couldn’t read the columns. Map them by hand.', 'ai_no_answer');
  const p = response.parsed_output;
  const valid = new Set(headers);
  return { kind: p.kind, mapping: Object.fromEntries(p.mapping.map((m) => [m.field, m.column && valid.has(m.column) ? m.column : null])), note: p.note };
}
