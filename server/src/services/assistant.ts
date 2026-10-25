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
    system: `${ASSISTANT_SYSTEM}\nShop: ${shop.name}${shop.state ? `, ${shop.state}` : ''}. User role: ${c.role}. Today is ${todayISO()}.`,
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
