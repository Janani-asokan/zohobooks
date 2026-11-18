/**
 * Customer support call-backs, shop side. The owner (or anyone with the admin permission) books a call-back in a slot
 * the system offers, sees their requests, and can cancel an upcoming one. Platform staff handle them in the Customer
 * care console (routes/platformSupport.ts).
 */
import { Router } from 'express';
import { z } from 'zod';
import { perm } from '../../auth';
import { audit } from '../../audit';
import { many, one, type Db } from '../../db';
import { HttpError, badRequest, notFound, parse } from '../../http';
import { SUPPORT_TOPICS, isSlot, supportSlots, MIN_NOTICE_MIN, istDate, type SupportSettings } from '../../../../shared/support';
import { HOWTO, STARTERS, itemWords, understand } from '../../../../shared/supportBot';
import { getOrg } from '../../services/common';
import { aiEnabled } from '../../services/extract';
import { aiAvailable } from '../../services/aiUsage';
import { askAssistant } from '../../services/assistant';
import { todayISO, type UserCtx } from '../../auth';
import { T } from './ctx';

export const supportRouter = Router();

/** Support hours and slot rules, from the platform settings. */
export async function supportSettings(db: Db): Promise<SupportSettings> {
  const c = await one(db, 'SELECT support_days, support_start, support_end, support_slot_minutes, support_slot_capacity, support_booking_days FROM platform_config WHERE id = 1');
  return { days: c.support_days, start: c.support_start, end: c.support_end, slotMinutes: c.support_slot_minutes, capacity: c.support_slot_capacity, bookingDays: c.support_booking_days };
}

/**
 * Scheduled call-backs per slot across ALL shops (a slot's places are shared). Row-level security shows a shop only
 * its own rows, so this one read switches on the platform policy and switches it off again straight after. The flag
 * is set by this server code only, never from a request, and only counts leave this function.
 */
export async function bookedPerSlot(db: Db): Promise<Map<string, number>> {
  await db.query("SELECT set_config('app.platform', 'on', true)");
  try {
    const rows = await many(db, "SELECT slot_start, count(*)::int AS n FROM support_callbacks WHERE status = 'scheduled' AND slot_start > now() GROUP BY slot_start");
    return new Map(rows.map((r) => [new Date(r.slot_start).toISOString(), r.n]));
  } finally {
    await db.query("SELECT set_config('app.platform', 'off', true)");
  }
}

export const serializeCallback = (r: any) => ({
  id: r.id, contactName: r.contact_name, phone: r.phone, topic: r.topic, message: r.message, slotStart: new Date(r.slot_start).toISOString(),
  status: r.status, staffNotes: r.staff_notes, completedAt: r.completed_at, createdAt: r.created_at, chat: r.chat ?? [], source: r.source ?? 'form',
  ...(r.assigned_name !== undefined ? { assignedTo: r.assigned_name ?? null } : {}),
});

supportRouter.get('/support/slots', perm('admin'), T(async (db) => {
  const s = await supportSettings(db);
  return { settings: s, days: supportSlots(s, await bookedPerSlot(db)) };
}));

supportRouter.get('/support/callbacks', perm('admin'), T(async (db, _req, c) =>
  (await many(db, `SELECT cb.*, sa.name AS assigned_name FROM support_callbacks cb LEFT JOIN super_admins sa ON sa.id = cb.assigned_to
                    WHERE cb.shop_id = $1 ORDER BY cb.slot_start DESC LIMIT 50`, [c.shopId])).map(serializeCallback)));

supportRouter.post('/support/callbacks', perm('admin'), T(async (db, req, c, res) => {
  const b = parse(z.object({
    slotStart: z.string().datetime({ offset: true }),
    topic: z.enum(SUPPORT_TOPICS.map((t) => t.key) as [string, ...string[]]),
    message: z.string().trim().max(1000).default(''),
    /** The help chat that led to this call-back, for the support agent. */
    chat: z.array(z.object({ role: z.enum(['user', 'bot']), text: z.string().max(2000) })).max(60).default([]),
    contactName: z.string().trim().min(2, 'Enter who we should ask for').max(120),
    phone: z.string().trim().refine((v) => v.replace(/\D/g, '').length >= 10, 'Enter a valid 10-digit phone number').pipe(z.string().max(30)),
  }), req.body);
  const slot = new Date(b.slotStart);
  const s = await supportSettings(db);
  if (!isSlot(s, slot)) throw badRequest('That time is not one of the call-back slots. Pick a slot from the list.');
  if (slot.getTime() < Date.now() + MIN_NOTICE_MIN * 60_000) throw badRequest('That slot is too soon. Pick one at least an hour from now.');
  if (slot.getTime() > Date.now() + (s.bookingDays + 1) * 86_400_000) throw badRequest(`Slots can be booked up to ${s.bookingDays} days ahead.`);
  // One booking at a time per slot: two shops can't both take its last place.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`support-slot:${slot.toISOString()}`]);
  const open = await one(db, "SELECT slot_start FROM support_callbacks WHERE shop_id = $1 AND status = 'scheduled' AND slot_start > now()", [c.shopId]);
  if (open) throw new HttpError(409, 'You already have a call-back booked. Cancel it first to choose another time.', 'callback_exists');
  const taken = (await bookedPerSlot(db)).get(slot.toISOString()) ?? 0;
  if (taken >= s.capacity) throw new HttpError(409, 'That slot was just taken. Please pick another time.', 'slot_full');
  const r = await one(db, `INSERT INTO support_callbacks (shop_id, requested_by, contact_name, phone, topic, message, slot_start, chat, source)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [c.shopId, c.id, b.contactName, b.phone, b.topic, b.message, slot, JSON.stringify(b.chat), b.chat.length ? 'chat' : 'form']);
  await audit(db, req, c.shopId, 'create', 'support_callback', r.id, { slot: slot.toISOString(), topic: b.topic });
  res.status(201);
  return serializeCallback(r);
}));

supportRouter.post('/support/callbacks/:id/cancel', perm('admin'), T(async (db, req, c) => {
  const r = await one(db, `UPDATE support_callbacks SET status = 'cancelled', updated_at = now()
                           WHERE id = $1 AND shop_id = $2 AND status = 'scheduled' RETURNING *`, [req.params.id, c.shopId]);
  if (!r) throw notFound('Upcoming call-back');
  await audit(db, req, c.shopId, 'cancel', 'support_callback', r.id);
  return serializeCallback(r);
}));

/* ======================= Help chat ======================= */

/** The support team's details for the chat: phone, email, hours, whether they are open now, and the next free slot. */
supportRouter.get('/support/contact', T(async (db, _req, c) => {
  const s = await supportSettings(db);
  const cfg = await one(db, 'SELECT support_phone, support_email FROM platform_config WHERE id = 1');
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const dow = ((ist.getUTCDay() + 6) % 7) + 1;
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const openNow = s.days.includes(dow) && minutes >= toMin(s.start) && minutes < toMin(s.end);
  const next = supportSlots(s, await bookedPerSlot(db))[0]?.slots[0]?.start ?? null;
  return { phone: cfg?.support_phone ?? '', email: cfg?.support_email ?? '', days: s.days, start: s.start, end: s.end, openNow, nextSlot: next, today: istDate(now),
    canBook: c.permissions.includes('admin') };
}));

type Reply = { text: string; table?: { columns: string[]; rows: string[][] }; links?: Array<{ label: string; to: string }>; suggestions?: string[]; escalate?: boolean; by: 'bot' | 'ai' };
const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const canMoney = (c: UserCtx) => ['sales.write', 'reports.read', 'payments.write'].some((p) => c.permissions.includes(p as never));
const noAccess = (what: string): Reply => ({ text: `Your role can’t see ${what}. Ask the shop owner, or I can connect you to support.`, by: 'bot', escalate: true });

/**
 * One turn of the help chat. The rules (shared/supportBot.ts) answer stock, invoice, dues, overdue, low-stock and
 * today's-sales questions from the shop's own data (within the user's role), and common how-to questions. Anything
 * else goes to the AI assistant when the shop has AI, and otherwise the user is offered a person.
 */
supportRouter.post('/support/chat', T(async (db, req, c): Promise<Reply> => {
  const b = parse(z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(1000) })).min(1).max(30) }), req.body);
  const last = b.messages[b.messages.length - 1]!;
  if (last.role !== 'user') throw badRequest('The last message must be the question');
  const intent = understand(last.content);
  switch (intent.kind) {
    case 'human':
      return { text: 'Sure. You can call us now, or book a call-back at a time that suits you: this chat goes with it, so you won’t have to explain again.', escalate: true, by: 'bot' };
    case 'greeting':
      return { text: 'Hello! Ask me about stock, a bill, what a customer owes, or how to do something in Corpus360.', suggestions: STARTERS, by: 'bot' };
    case 'thanks':
      return { text: 'Glad that helped. Anything else?', suggestions: STARTERS.slice(0, 4), by: 'bot' };
    case 'howto': {
      const h = HOWTO.find((x) => x.id === intent.id)!;
      return { text: `${h.title}: ${h.answer}`, links: h.link ? [h.link] : [], suggestions: ['That solved it, thanks', 'Talk to a person'], by: 'bot' };
    }
    case 'stock': {
      const words = itemWords(intent.query);
      const rows = await many(db, `SELECT i.id, i.name, i.unit, i.reorder_level,
          coalesce((SELECT jsonb_object_agg(s.branch_id, s.qty) FROM item_stock s WHERE s.item_id = i.id), '{}') AS by_branch
        FROM items i WHERE i.shop_id = $1 AND i.type = 'Goods' AND NOT i.archived AND NOT i.is_group
          AND (i.name ILIKE ALL($2::text[]) OR upper(i.sku) = upper($3) OR i.barcode = $3) ORDER BY i.name LIMIT 7`,
      [c.shopId, words.map((w) => `%${w}%`), intent.query]);
      if (!rows.length) return { text: `I couldn’t find an item matching “${intent.query}”. Try a shorter part of its name, or its code.`, links: [{ label: 'Search items', to: '/app/items' }], by: 'bot' };
      if (rows.length > 6) return { text: `Many items match “${intent.query}”. Add a word or two to the name (brand, size, colour).`, links: [{ label: 'Search items', to: `/app/items` }], by: 'bot' };
      const branches = await many(db, 'SELECT id, name FROM branches WHERE shop_id = $1 ORDER BY is_primary DESC, name', [c.shopId]);
      const table = {
        columns: ['Item', ...branches.map((x) => x.name), 'Total'],
        rows: rows.map((r) => {
          const by = r.by_branch as Record<string, number>;
          const per = branches.map((x) => Number(by[x.id] ?? 0));
          return [r.name, ...per.map((q) => `${q}`), `${per.reduce((a, q) => a + q, 0)} ${r.unit}`];
        }),
      };
      const low = rows.filter((r) => Object.values(r.by_branch as Record<string, number>).reduce((a, q) => a + Number(q), 0) <= Number(r.reorder_level));
      return { text: rows.length === 1 ? `Stock of ${rows[0].name}:` : `${rows.length} items match:`, table,
        links: [{ label: 'Open in Items', to: rows.length === 1 ? `/app/items?open=${rows[0].id}` : '/app/items' }, ...(low.length ? [{ label: 'Reorder', to: '/app/inventory/reorder' }] : [])], by: 'bot' };
    }
    case 'low_stock': {
      const rows = await many(db, `SELECT i.name, i.unit, i.reorder_level, coalesce(sum(s.qty), 0) AS qty FROM items i LEFT JOIN item_stock s ON s.item_id = i.id
          WHERE i.shop_id = $1 AND i.type = 'Goods' AND NOT i.archived AND NOT i.is_group GROUP BY i.id HAVING coalesce(sum(s.qty), 0) <= max(i.reorder_level) ORDER BY 4 LIMIT 8`, [c.shopId]);
      if (!rows.length) return { text: 'Nothing is at or below its reorder level right now.', by: 'bot' };
      return { text: `${rows.length === 8 ? 'These are' : `${rows.length} item${rows.length > 1 ? 's are' : ' is'}`} at or below the reorder level:`,
        table: { columns: ['Item', 'In stock', 'Reorder at'], rows: rows.map((r) => [r.name, `${Number(r.qty)} ${r.unit}`, `${r.reorder_level}`]) },
        links: [{ label: 'Smart reorder', to: '/app/inventory/reorder' }], by: 'bot' };
    }
    case 'invoice': {
      if (!canMoney(c)) return noAccess('invoices');
      const rows = await many(db, `SELECT id, number, date, status, total, total - amount_paid - amount_credited AS balance, due_date, customer->>'name' AS cname, customer->>'companyName' AS company
          FROM invoices WHERE shop_id = $1 AND (upper(number) = $2 OR upper(number) LIKE '%' || $2) ORDER BY date DESC LIMIT 3`, [c.shopId, intent.number]);
      if (!rows.length) return { text: `I couldn’t find invoice ${intent.number}. Check the number on the bill.`, links: [{ label: 'Invoices', to: '/app/sales/invoices' }], by: 'bot' };
      const r = rows[0];
      const bal = Number(r.balance);
      const due = r.status === 'Issued' && bal > 0.005 ? (String(r.due_date instanceof Date ? r.due_date.toISOString() : r.due_date).slice(0, 10) < todayISO() ? ' and overdue' : '') : '';
      return { text: `${r.number} for ${r.company || r.cname}: ${inr(Number(r.total))}, ${r.status === 'Cancelled' ? 'cancelled' : r.status === 'Draft' ? 'a draft (not issued yet)' : bal > 0.005 ? `${inr(bal)} still to be paid${due}` : 'fully paid'}.`,
        links: [{ label: `Open ${r.number}`, to: `/app/sales/invoices/${r.id}` }], by: 'bot' };
    }
    case 'dues': {
      if (!canMoney(c)) return noAccess('customer balances');
      const words = itemWords(intent.who);
      if (!words.length) return { text: 'Which customer? For example: “How much does Nila Textiles owe?”', by: 'bot' };
      const rows = await many(db, `SELECT c.id, coalesce(nullif(c.company_name, ''), c.name) AS name,
          coalesce((SELECT sum(GREATEST(i.total - i.amount_paid - i.amount_credited, 0)) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'Issued'), 0) AS due,
          coalesce((SELECT sum(GREATEST(i.total - i.amount_paid - i.amount_credited, 0)) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'Issued' AND i.due_date < current_date), 0) AS overdue
        FROM customers c WHERE c.shop_id = $1 AND (coalesce(c.company_name, '') || ' ' || c.name) ILIKE ALL($2::text[]) ORDER BY 3 DESC LIMIT 5`, [c.shopId, words.map((w) => `%${w}%`)]);
      if (!rows.length) return { text: `I couldn’t find a customer called “${intent.who}”.`, links: [{ label: 'Customers', to: '/app/sales/customers' }], by: 'bot' };
      if (rows.length === 1) {
        const r = rows[0];
        return { text: Number(r.due) > 0.005 ? `${r.name} owes ${inr(Number(r.due))}${Number(r.overdue) > 0.005 ? `, of which ${inr(Number(r.overdue))} is overdue` : ''}.` : `${r.name} owes nothing right now.`,
          links: [{ label: 'Open customer', to: `/app/sales/customers?open=${r.id}` }], by: 'bot' };
      }
      return { text: 'A few customers match:', table: { columns: ['Customer', 'Owes', 'Overdue'], rows: rows.map((r) => [r.name, inr(Number(r.due)), inr(Number(r.overdue))]) }, by: 'bot' };
    }
    case 'overdue': {
      if (!canMoney(c)) return noAccess('invoices');
      const t = await one(db, `SELECT count(*)::int AS n, coalesce(sum(total - amount_paid - amount_credited), 0) AS amt FROM invoices
          WHERE shop_id = $1 AND status = 'Issued' AND due_date < current_date AND total - amount_paid - amount_credited > 0.005`, [c.shopId]);
      if (!t.n) return { text: 'No invoices are overdue. 🎉', by: 'bot' };
      const top = await many(db, `SELECT number, coalesce(nullif(customer->>'companyName', ''), customer->>'name') AS who, total - amount_paid - amount_credited AS bal, current_date - due_date AS days
          FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND due_date < current_date AND total - amount_paid - amount_credited > 0.005 ORDER BY 3 DESC LIMIT 5`, [c.shopId]);
      return { text: `${t.n} invoice${t.n > 1 ? 's are' : ' is'} overdue, ${inr(Number(t.amt))} in all. The largest:`,
        table: { columns: ['Invoice', 'Customer', 'Balance', 'Days late'], rows: top.map((r) => [r.number, r.who, inr(Number(r.bal)), `${r.days}`]) },
        links: [{ label: 'Overdue invoices', to: '/app/sales/invoices?status=Overdue' }], by: 'bot' };
    }
    case 'sales_today': {
      if (!['sales.write', 'reports.read'].some((p) => c.permissions.includes(p as never))) return noAccess('sales figures');
      const t = await one(db, "SELECT count(*)::int AS n, coalesce(sum(total), 0) AS amt FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND date = current_date", [c.shopId]);
      return { text: `Today: ${t.n} bill${t.n === 1 ? '' : 's'}, ${inr(Number(t.amt))} in sales.`, links: [{ label: 'Dashboard', to: '/app' }], by: 'bot' };
    }
    default: {
      // The AI assistant (shops with the AI add-on) for anything the rules don't cover.
      if (aiEnabled() && (await aiAvailable(c.shopId))) {
        try {
          const org = await getOrg(db, c.shopId);
          const text = await askAssistant(c, { name: org.company_name, state: org.state ?? '' }, b.messages.map((m) => ({ role: m.role, content: m.content })));
          return { text, suggestions: ['That solved it, thanks', 'Talk to a person'], by: 'ai' };
        } catch { /* fall through to the person */ }
      }
      return { text: 'I’m not sure about that one. Try asking another way, pick one of these, or talk to our support team.', suggestions: STARTERS, escalate: true, by: 'bot' };
    }
  }
}));
