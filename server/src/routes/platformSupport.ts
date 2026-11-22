/**
 * Customer care console (platform staff = super admins): every shop's call-back requests, a summary of the shop's
 * account to check before calling, the outcome of each call, and the support hours / slot rules.
 * Mounted under /api/platform/support, behind requireSuper.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { audit } from '../audit';
import { many, one, query, tx, withTenant, type Db } from '../db';
import { HttpError, badRequest, h, notFound, parse } from '../http';
import { bookedPerSlot, expireWaiting, serializeCallback, serializeChat, serializeMsg, supportSettings } from './shop/support';
import { isSlot, supportSlots, waDigits } from '../../../shared/support';
import { config } from '../config';
import { fetchMedia, markRead, sendTemplate, sendText, waEnabled, windowOpen } from '../services/whatsappCloud';

export const platformSupportRouter = Router();

/** A transaction where the platform policy on support_callbacks applies (every shop's rows). */
const platformTx = <T>(fn: (db: Db) => Promise<T>) => tx(async (db) => { await db.query("SELECT set_config('app.platform', 'on', true)"); return fn(db); });
const staffId = (req: Request) => (req.ctx?.kind === 'super' ? req.ctx.id : null);

const LIST_SQL = `SELECT cb.*, sa.name AS assigned_name, s.name AS shop_name, s.owner_name, s.email AS shop_email, s.phone AS shop_phone,
                         s.city, s.plan_id, s.license_end, s.active AS shop_active
                    FROM support_callbacks cb JOIN shops s ON s.id = cb.shop_id LEFT JOIN super_admins sa ON sa.id = cb.assigned_to`;
const withShop = (r: any) => ({
  ...serializeCallback(r), shopId: r.shop_id,
  shop: { name: r.shop_name, ownerName: r.owner_name, email: r.shop_email, phone: r.shop_phone, city: r.city, planId: r.plan_id, licenseEnd: r.license_end, active: r.shop_active },
});

platformSupportRouter.get('/callbacks', h(async (req, res) => {
  const view = String(req.query.view ?? 'upcoming');
  const where = view === 'today' ? "cb.slot_start::date = (now() AT TIME ZONE 'Asia/Kolkata')::date"
    : view === 'upcoming' ? "cb.status = 'scheduled'"
    : view === 'done' ? "cb.status IN ('completed', 'missed', 'cancelled')"
    : 'true';
  const order = view === 'done' || view === 'all' ? 'cb.slot_start DESC' : 'cb.slot_start ASC';
  const rows = await platformTx((db) => many(db, `${LIST_SQL} WHERE ${where} ORDER BY ${order} LIMIT 300`));
  const counts = await platformTx((db) => one(db, `SELECT count(*) FILTER (WHERE status = 'scheduled')::int AS upcoming,
      count(*) FILTER (WHERE status = 'scheduled' AND slot_start < now())::int AS overdue,
      count(*) FILTER (WHERE slot_start::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today FROM support_callbacks`));
  res.json({ callbacks: rows.map(withShop), counts });
}));

/** What staff check before calling: the shop's account, plan, usage and earlier call-backs. */
platformSupportRouter.get('/shops/:shopId', h(async (req, res) => {
  const shopId = req.params.shopId!;
  const [s] = await query('SELECT s.*, p.name AS plan_name FROM shops s JOIN plans p ON p.id = s.plan_id WHERE s.id = $1', [shopId]);
  if (!s) throw notFound('Shop');
  const users = await query("SELECT name, email, role, active, last_login_at FROM users WHERE shop_id = $1 ORDER BY role = 'Owner' DESC, last_login_at DESC NULLS LAST", [shopId]);
  const features = await query("SELECT feature_key, level, source, ends_on FROM shop_features WHERE shop_id = $1 AND status = 'active' ORDER BY feature_key", [shopId]);
  const usage = await withTenant(shopId, (db) => one(db, `SELECT
      (SELECT count(*)::int FROM invoices WHERE status = 'Issued') AS invoices,
      (SELECT count(*)::int FROM invoices WHERE status = 'Issued' AND date >= date_trunc('month', current_date)) AS invoices_month,
      (SELECT coalesce(sum(total), 0)::float FROM invoices WHERE status = 'Issued' AND date >= date_trunc('month', current_date)) AS sales_month,
      (SELECT max(date) FROM invoices WHERE status = 'Issued') AS last_invoice,
      (SELECT count(*)::int FROM items WHERE NOT archived) AS items,
      (SELECT count(*)::int FROM customers) AS customers`));
  const history = await platformTx((db) => many(db, `${LIST_SQL} WHERE cb.shop_id = $1 ORDER BY cb.slot_start DESC LIMIT 10`, [shopId]));
  res.json({
    shop: { id: s.id, name: s.name, ownerName: s.owner_name, email: s.email, phone: s.phone, city: s.city, plan: s.plan_name, planId: s.plan_id,
      licenseStart: s.license_start, licenseEnd: s.license_end, active: s.active, createdAt: s.created_at },
    users: users.map((u) => ({ name: u.name, email: u.email, role: u.role, active: u.active, lastLoginAt: u.last_login_at })),
    features: features.map((f) => ({ key: f.feature_key, level: f.level, source: f.source, endsOn: f.ends_on })),
    usage: { invoices: usage.invoices, invoicesThisMonth: usage.invoices_month, salesThisMonth: usage.sales_month, lastInvoice: usage.last_invoice, items: usage.items, customers: usage.customers },
    history: history.map(withShop),
  });
}));

/** Take a call, record the outcome, add notes, or move it to another slot. */
platformSupportRouter.patch('/callbacks/:id', h(async (req, res) => {
  const b = parse(z.object({
    status: z.enum(['scheduled', 'completed', 'missed', 'cancelled']).optional(),
    staffNotes: z.string().max(4000).optional(),
    assignToMe: z.boolean().optional(),
    slotStart: z.string().datetime({ offset: true }).optional(),
  }), req.body);
  const row = await platformTx(async (db) => {
    const cur = await one(db, 'SELECT * FROM support_callbacks WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!cur) throw notFound('Call-back');
    let slot: Date | null = null;
    if (b.slotStart) {
      slot = new Date(b.slotStart);
      const s = await supportSettings(db);
      if (!isSlot(s, slot)) throw badRequest('That time is not one of the call-back slots.');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`support-slot:${slot.toISOString()}`]);
      const taken = (await bookedPerSlot(db)).get(slot.toISOString()) ?? 0;
      await db.query("SELECT set_config('app.platform', 'on', true)"); // bookedPerSlot switched it off again
      if (taken >= s.capacity && new Date(cur.slot_start).getTime() !== slot.getTime()) throw new HttpError(409, 'That slot is full.', 'slot_full');
    }
    const status = slot ? 'scheduled' : b.status;
    const r = await one(db, `UPDATE support_callbacks SET
        status = coalesce($2, status), staff_notes = coalesce($3, staff_notes), slot_start = coalesce($4, slot_start),
        assigned_to = CASE WHEN $5::boolean THEN $6::uuid ELSE assigned_to END,
        completed_at = CASE WHEN coalesce($2, status) IN ('completed', 'missed') THEN coalesce(completed_at, now()) ELSE NULL END,
        updated_at = now()
      WHERE id = $1 RETURNING *`, [cur.id, status ?? null, b.staffNotes ?? null, slot, !!b.assignToMe || (!!b.status && b.status !== 'scheduled' && !cur.assigned_to), staffId(req)]);
    await audit(db, req, cur.shop_id, 'update', 'support_callback', cur.id, { status: status ?? cur.status, ...(slot ? { slot: slot.toISOString() } : {}) });
    return one(db, `${LIST_SQL} WHERE cb.id = $1`, [r.id]);
  });
  res.json(withShop(row));
}));

/** Open slots for rescheduling (same rules shops see). */
platformSupportRouter.get('/slots', h(async (_req, res) => {
  res.json(await tx(async (db) => { const s = await supportSettings(db); return { settings: s, days: supportSlots(s, await bookedPerSlot(db)) }; }));
}));

const contact = async (db: Db) => {
  const c = await one(db, 'SELECT support_phone, support_email, support_whatsapp, sales_phone, sales_email, sales_whatsapp FROM platform_config WHERE id = 1');
  return { phone: c?.support_phone ?? '', email: c?.support_email ?? '', whatsapp: c?.support_whatsapp ?? '', salesPhone: c?.sales_phone ?? '', salesEmail: c?.sales_email ?? '', salesWhatsapp: c?.sales_whatsapp ?? '' };
};
platformSupportRouter.get('/settings', h(async (_req, res) => { res.json(await tx(async (db) => ({ ...(await supportSettings(db)), ...(await contact(db)) }))); }));
platformSupportRouter.put('/settings', h(async (req, res) => {
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 10:00');
  const b = parse(z.object({
    days: z.array(z.number().int().min(1).max(7)).min(1, 'Pick at least one day').max(7),
    start: hhmm, end: hhmm,
    slotMinutes: z.union([z.literal(15), z.literal(20), z.literal(30), z.literal(45), z.literal(60)]),
    capacity: z.number().int().min(1).max(50),
    bookingDays: z.number().int().min(1).max(60),
    /** Shown in the shops' help chat when the bot can't help. */
    phone: z.string().trim().max(30).default(''),
    email: z.string().trim().max(120).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email').default(''),
    /** The team's WhatsApp number: shops' "WhatsApp us" opens a chat with it. */
    whatsapp: z.string().trim().max(30).refine((v) => v === '' || waDigits(v) !== '', 'Enter a WhatsApp number with country code, e.g. +91 98400 12345').default(''),
    /** The sales team, for visitors and shops that haven't paid yet. Empty: the support contact is used. */
    salesPhone: z.string().trim().max(30).default(''),
    salesEmail: z.string().trim().max(120).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email').default(''),
    salesWhatsapp: z.string().trim().max(30).refine((v) => v === '' || waDigits(v) !== '', 'Enter a WhatsApp number with country code, e.g. +91 98400 12345').default(''),
  }), req.body);
  if (b.start >= b.end) throw badRequest('Support must end after it starts');
  await tx(async (db) => {
    await db.query(`UPDATE platform_config SET support_days = $1, support_start = $2, support_end = $3, support_slot_minutes = $4,
                    support_slot_capacity = $5, support_booking_days = $6, support_phone = $7, support_email = $8, support_whatsapp = $9,
                    sales_phone = $10, sales_email = $11, sales_whatsapp = $12, updated_at = now() WHERE id = 1`,
    [[...new Set(b.days)].sort(), b.start, b.end, b.slotMinutes, b.capacity, b.bookingDays, b.phone, b.email, b.whatsapp, b.salesPhone, b.salesEmail, b.salesWhatsapp]);
    await audit(db, req, null, 'update', 'support_settings', undefined, b);
  });
  res.json(await tx(async (db) => ({ ...(await supportSettings(db)), ...(await contact(db)) })));
}));

/* ======================= WhatsApp contacts ======================= */

const WA_SQL = `SELECT w.*, s.name AS shop_name, s.owner_name, s.phone AS shop_phone, s.city, u.email AS user_email, sa.name AS handled_name
                  FROM support_whatsapp w JOIN shops s ON s.id = w.shop_id LEFT JOIN users u ON u.id = w.user_id LEFT JOIN super_admins sa ON sa.id = w.handled_by`;
const serializeWa = (r: any) => ({
  id: r.id, shopId: r.shop_id, shop: { name: r.shop_name, ownerName: r.owner_name, phone: r.shop_phone, city: r.city },
  contactName: r.contact_name, userEmail: r.user_email ?? '', question: r.question, chat: r.chat, status: r.status,
  handledBy: r.handled_name ?? null, staffNotes: r.staff_notes, createdAt: r.created_at, doneAt: r.done_at,
  /** Opens the shop's own number in WhatsApp, to reply from the team's phone or WhatsApp Web. */
  shopWhatsapp: waDigits(r.shop_phone ?? ''),
});

/** Shops that tapped "WhatsApp us": open ones first (newest first), or the handled ones. */
platformSupportRouter.get('/whatsapp', h(async (req, res) => {
  const done = req.query.view === 'done';
  const rows = await platformTx((db) => many(db, `${WA_SQL} WHERE w.status = $1 ORDER BY w.created_at DESC LIMIT 300`, [done ? 'done' : 'open']));
  const counts = await platformTx((db) => one(db, "SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE created_at::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today FROM support_whatsapp"));
  res.json({ contacts: rows.map(serializeWa), counts });
}));

platformSupportRouter.patch('/whatsapp/:id', h(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['open', 'done']).optional(), staffNotes: z.string().max(2000).optional() }), req.body);
  const row = await platformTx(async (db) => {
    const cur = await one(db, 'SELECT * FROM support_whatsapp WHERE id = $1', [req.params.id]);
    if (!cur) throw notFound('WhatsApp contact');
    const status = b.status ?? cur.status;
    await db.query(`UPDATE support_whatsapp SET status = $2, staff_notes = $3, handled_by = $4, done_at = CASE WHEN $2 = 'done' THEN coalesce(done_at, now()) ELSE NULL END WHERE id = $1`,
      [cur.id, status, b.staffNotes ?? cur.staff_notes, staffId(req) ?? cur.handled_by]);
    await audit(db, req, cur.shop_id, 'update', 'support_whatsapp', cur.id, { status });
    return one(db, `${WA_SQL} WHERE w.id = $1`, [cur.id]);
  });
  res.json(serializeWa(row));
}));

/* ======================= Sales leads ======================= */

const LEAD_SQL = `SELECT l.*, s.name AS shop_name, s.plan_id, sa.name AS handled_name FROM sales_leads l
                    LEFT JOIN shops s ON s.id = l.shop_id LEFT JOIN super_admins sa ON sa.id = l.handled_by`;
const serializeLead = (r: any) => ({
  id: r.id, name: r.name, phone: r.phone, email: r.email, business: r.business, city: r.city, message: r.message,
  source: r.source, page: r.page, shopId: r.shop_id, shopName: r.shop_name ?? null, planId: r.plan_id ?? null,
  status: r.status, staffNotes: r.staff_notes, handledBy: r.handled_name ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  whatsapp: waDigits(r.phone ?? ''),
});

/** "Talk to sales" requests: new ones first, or those already contacted, won or lost. */
platformSupportRouter.get('/leads', h(async (req, res) => {
  const view = ['new', 'contacted', 'won', 'lost'].includes(String(req.query.view)) ? String(req.query.view) : 'new';
  const rows = await platformTx((db) => many(db, `${LEAD_SQL} WHERE l.status = $1 ORDER BY l.created_at DESC LIMIT 300`, [view]));
  const counts = await platformTx((db) => one(db, `SELECT count(*) FILTER (WHERE status = 'new')::int AS new,
      count(*) FILTER (WHERE created_at::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS today,
      count(*) FILTER (WHERE status = 'won')::int AS won FROM sales_leads`));
  res.json({ leads: rows.map(serializeLead), counts });
}));

platformSupportRouter.patch('/leads/:id', h(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['new', 'contacted', 'won', 'lost']).optional(), staffNotes: z.string().max(2000).optional() }), req.body);
  const row = await platformTx(async (db) => {
    const cur = await one(db, 'SELECT * FROM sales_leads WHERE id = $1', [req.params.id]);
    if (!cur) throw notFound('Sales lead');
    await db.query('UPDATE sales_leads SET status = $2, staff_notes = $3, handled_by = $4, updated_at = now() WHERE id = $1',
      [cur.id, b.status ?? cur.status, b.staffNotes ?? cur.staff_notes, staffId(req) ?? cur.handled_by]);
    await audit(db, req, cur.shop_id, 'update', 'sales_lead', cur.id, { status: b.status ?? cur.status });
    return one(db, `${LEAD_SQL} WHERE l.id = $1`, [cur.id]);
  });
  res.json(serializeLead(row));
}));

/* ======================= WhatsApp Business API inbox ======================= */

const waConv = (r: any) => ({
  id: r.id, waId: r.wa_id, profileName: r.profile_name, shopId: r.shop_id, shopName: r.shop_name ?? null, status: r.status,
  unread: r.unread, lastInboundAt: r.last_inbound_at, lastMessageAt: r.last_message_at, preview: r.last_preview,
  assignedTo: r.assigned_name ?? null, windowOpen: windowOpen(r.last_inbound_at),
});
const waMsg = (r: any) => ({
  id: Number(r.id), direction: r.direction, kind: r.kind, body: r.body, hasMedia: !!r.media_id, mediaMime: r.media_mime, mediaName: r.media_name,
  status: r.status, error: r.error, sentBy: r.sent_by_name || null, at: r.created_at,
});
const CONV_SQL = `SELECT c.*, s.name AS shop_name, sa.name AS assigned_name FROM wa_conversations c
                  LEFT JOIN shops s ON s.id = c.shop_id LEFT JOIN super_admins sa ON sa.id = c.assigned_to`;

/** Whether the API is set up, when Meta last reached the webhook, and the conversations (open first). */
platformSupportRouter.get('/wa', h(async (req, res) => {
  const closed = req.query.view === 'closed';
  const rows = await query(`${CONV_SQL} WHERE c.status = $1 ORDER BY c.last_message_at DESC LIMIT 200`, [closed ? 'closed' : 'open']);
  const [cfg] = await query('SELECT wa_webhook_at FROM platform_config WHERE id = 1');
  const [{ unread }] = await query("SELECT coalesce(sum(unread), 0)::int AS unread FROM wa_conversations WHERE status = 'open'");
  res.json({
    configured: waEnabled(), webhookSecured: !!config.whatsapp?.appSecret && !!config.whatsapp?.verifyToken, templateSet: !!config.whatsapp?.template,
    webhookAt: cfg?.wa_webhook_at ?? null, unread, conversations: rows.map(waConv),
  });
}));

/** One conversation: its messages (after ?after= for polling). Opening it marks it read here and on the shop's phone. */
platformSupportRouter.get('/wa/:id', h(async (req, res) => {
  const [c] = await query(`${CONV_SQL} WHERE c.id = $1`, [req.params.id]);
  if (!c) throw notFound('Conversation');
  const after = Number(req.query.after ?? 0) || 0;
  const msgs = await query('SELECT * FROM wa_messages WHERE conversation_id = $1 AND id > $2 ORDER BY id LIMIT 500', [c.id, after]);
  if (c.unread > 0) {
    await query('UPDATE wa_conversations SET unread = 0 WHERE id = $1', [c.id]);
    const [last] = await query("SELECT wa_message_id FROM wa_messages WHERE conversation_id = $1 AND direction = 'in' ORDER BY id DESC LIMIT 1", [c.id]);
    if (last?.wa_message_id) void markRead(last.wa_message_id);
  }
  res.json({ conversation: { ...waConv(c), unread: 0 }, messages: msgs.map(waMsg) });
}));

/** A text reply from an agent. WhatsApp only allows free text for 24 hours after the shop's last message. */
platformSupportRouter.post('/wa/:id/messages', h(async (req, res) => {
  const b = parse(z.object({ body: z.string().trim().min(1, 'Type a message').max(4000) }), req.body);
  const [c] = await query('SELECT * FROM wa_conversations WHERE id = $1', [req.params.id]);
  if (!c) throw notFound('Conversation');
  if (!windowOpen(c.last_inbound_at)) {
    throw new HttpError(409, config.whatsapp?.template
      ? 'More than 24 hours since the shop last wrote: WhatsApp only allows the approved template now. Send it, and reply once they answer.'
      : 'More than 24 hours since the shop last wrote: WhatsApp only allows an approved template message, and none is set (WHATSAPP_TEMPLATE). Call them instead.', 'window_closed');
  }
  const a = agent(req);
  const [row] = await query(`INSERT INTO wa_messages (conversation_id, direction, kind, body, status, sent_by, sent_by_name) VALUES ($1, 'out', 'text', $2, 'sending', $3, $4) RETURNING *`,
    [c.id, b.body, a?.id ?? null, a?.name ?? '']);
  try {
    const waId = await sendText(c.wa_id, b.body);
    const [sent] = await query("UPDATE wa_messages SET wa_message_id = $2, status = 'sent' WHERE id = $1 RETURNING *", [row.id, waId || null]);
    await query("UPDATE wa_conversations SET last_message_at = now(), last_preview = $2, assigned_to = coalesce(assigned_to, $3) WHERE id = $1", [c.id, b.body.slice(0, 140), a?.id ?? null]);
    res.json(waMsg(sent));
  } catch (e) {
    await query("UPDATE wa_messages SET status = 'failed', error = $2 WHERE id = $1", [row.id, (e as Error).message]);
    throw e;
  }
}));

/** The approved template, to reopen a conversation after the 24-hour window. */
platformSupportRouter.post('/wa/:id/template', h(async (req, res) => {
  if (!config.whatsapp?.template) throw badRequest('No approved template is set on the server (WHATSAPP_TEMPLATE).');
  const [c] = await query('SELECT * FROM wa_conversations WHERE id = $1', [req.params.id]);
  if (!c) throw notFound('Conversation');
  const a = agent(req);
  const body = `[Template: ${config.whatsapp.template}]`;
  const [row] = await query(`INSERT INTO wa_messages (conversation_id, direction, kind, body, status, sent_by, sent_by_name) VALUES ($1, 'out', 'template', $2, 'sending', $3, $4) RETURNING *`,
    [c.id, body, a?.id ?? null, a?.name ?? '']);
  try {
    const waId = await sendTemplate(c.wa_id);
    const [sent] = await query("UPDATE wa_messages SET wa_message_id = $2, status = 'sent' WHERE id = $1 RETURNING *", [row.id, waId || null]);
    await query('UPDATE wa_conversations SET last_message_at = now(), last_preview = $2 WHERE id = $1', [c.id, body]);
    res.json(waMsg(sent));
  } catch (e) {
    await query("UPDATE wa_messages SET status = 'failed', error = $2 WHERE id = $1", [row.id, (e as Error).message]);
    throw e;
  }
}));

/** Close or reopen a conversation, or link it to a shop when it wasn't matched automatically. */
platformSupportRouter.patch('/wa/:id', h(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['open', 'closed']).optional(), shopId: z.string().uuid().nullable().optional() }), req.body);
  const [c] = await query('SELECT * FROM wa_conversations WHERE id = $1', [req.params.id]);
  if (!c) throw notFound('Conversation');
  if (b.shopId) { const [s] = await query('SELECT 1 FROM shops WHERE id = $1', [b.shopId]); if (!s) throw notFound('Shop'); }
  await query('UPDATE wa_conversations SET status = $2, shop_id = $3 WHERE id = $1', [c.id, b.status ?? c.status, b.shopId === undefined ? c.shop_id : b.shopId]);
  await tx((db) => audit(db, req, b.shopId ?? c.shop_id ?? null, 'update', 'wa_conversation', c.id, { status: b.status ?? c.status }));
  const [row] = await query(`${CONV_SQL} WHERE c.id = $1`, [c.id]);
  res.json(waConv(row));
}));

/** A photo or document the shop sent, fetched from WhatsApp on demand (never stored on our server). */
platformSupportRouter.get('/wa/media/:messageId', h(async (req, res) => {
  const [m] = await query("SELECT media_id, media_mime, media_name FROM wa_messages WHERE id = $1 AND media_id <> ''", [Number(req.params.messageId) || 0]);
  if (!m) throw notFound('File');
  const f = await fetchMedia(m.media_id);
  // Only formats a browser shows safely are opened inline; anything else (HTML, SVG, scripts…) is a plain download,
  // so a file from WhatsApp can never run in the console.
  const inline = /^(image\/(jpeg|png|webp|gif)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+)$/i.test(f.mime);
  const name = (m.media_name || 'whatsapp-file').replace(/[^\w.\- ]/g, '_');
  res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(f.data);
}));

/* ======================= Live chats ======================= */

const agent = (req: Request) => (req.ctx?.kind === 'super' ? { id: req.ctx.id, name: req.ctx.name } : null);

/** Open chats (waiting first, oldest first) and the last two hours of finished ones. Polling this marks the agent online. */
platformSupportRouter.get('/live', h(async (req, res) => {
  const me = agent(req)!;
  const out = await platformTx(async (db) => {
    await db.query('UPDATE super_admins SET support_seen_at = now() WHERE id = $1', [me.id]);
    await expireWaiting(db);
    const rows = await many(db, `SELECT ch.*, s.name AS shop_name, s.phone AS shop_phone,
        (SELECT body FROM support_chat_messages m WHERE m.chat_id = ch.id AND m.sender <> 'system' ORDER BY m.id DESC LIMIT 1) AS last_body,
        (SELECT count(*)::int FROM support_chat_messages m WHERE m.chat_id = ch.id AND m.sender = 'shop' AND m.created_at > coalesce(ch.agent_seen_at, 'epoch')) AS unread
      FROM support_chats ch JOIN shops s ON s.id = ch.shop_id
      WHERE ch.status IN ('waiting', 'active') OR ch.closed_at > now() - interval '2 hours'
      ORDER BY (ch.status = 'waiting') DESC, (ch.status = 'active') DESC, ch.created_at LIMIT 100`);
    const online = await many(db, "SELECT name FROM super_admins WHERE support_seen_at > now() - interval '2 minutes' ORDER BY name");
    return { rows, online };
  });
  res.json({
    chats: out.rows.map((r) => ({ ...serializeChat(r), shopId: r.shop_id, shopName: r.shop_name, shopPhone: r.shop_phone, lastMessage: r.last_body, unread: r.unread, mine: r.agent_id === me.id })),
    waiting: out.rows.filter((r) => r.status === 'waiting').length,
    agentsOnline: out.online.map((a) => a.name),
  });
}));

platformSupportRouter.get('/live/:id', h(async (req, res) => {
  const me = agent(req)!;
  const after = Number(req.query.after) || 0;
  const out = await platformTx(async (db) => {
    const r = await one(db, 'SELECT ch.*, s.name AS shop_name FROM support_chats ch JOIN shops s ON s.id = ch.shop_id WHERE ch.id = $1', [req.params.id]);
    if (!r) throw notFound('Chat');
    await db.query('UPDATE super_admins SET support_seen_at = now() WHERE id = $1', [me.id]);
    if (r.agent_id === me.id) await db.query('UPDATE support_chats SET agent_seen_at = now() WHERE id = $1', [r.id]);
    const msgs = await many(db, 'SELECT * FROM support_chat_messages WHERE chat_id = $1 AND id > $2 ORDER BY id LIMIT 200', [r.id, after]);
    return { chat: { ...serializeChat(r), shopId: r.shop_id, shopName: r.shop_name, mine: r.agent_id === me.id }, messages: msgs.map(serializeMsg) };
  });
  res.json(out);
}));

/** Pick up a waiting chat (or take over one, with takeOver). */
platformSupportRouter.post('/live/:id/pick', h(async (req, res) => {
  const me = agent(req)!;
  const b = parse(z.object({ takeOver: z.boolean().default(false) }), req.body ?? {});
  const out = await platformTx(async (db) => {
    const r = await one(db, 'SELECT * FROM support_chats WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!r) throw notFound('Chat');
    if (r.status !== 'waiting' && r.status !== 'active') throw new HttpError(409, 'This chat has ended', 'chat_closed');
    if (r.status === 'active' && r.agent_id !== me.id && !b.takeOver) throw new HttpError(409, `${r.agent_name} is already in this chat`, 'chat_taken');
    if (r.agent_id === me.id) return r;
    await db.query("UPDATE support_chats SET status = 'active', agent_id = $2, agent_name = $3, picked_at = coalesce(picked_at, now()), agent_seen_at = now() WHERE id = $1", [r.id, me.id, me.name]);
    await db.query(`INSERT INTO support_chat_messages (shop_id, chat_id, sender, sender_name, body) VALUES ($1,$2,'system','',$3)`, [r.shop_id, r.id, `${me.name} from Corpus360 support joined the chat.`]);
    await audit(db, req, r.shop_id, 'pick', 'support_chat', r.id);
    return one(db, 'SELECT * FROM support_chats WHERE id = $1', [r.id]);
  });
  res.json(serializeChat(out));
}));

platformSupportRouter.post('/live/:id/messages', h(async (req, res) => {
  const me = agent(req)!;
  const b = parse(z.object({ body: z.string().trim().min(1, 'Type a message').max(2000) }), req.body);
  const m = await platformTx(async (db) => {
    const r = await one(db, 'SELECT * FROM support_chats WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!r) throw notFound('Chat');
    if (r.status !== 'active' && r.status !== 'waiting') throw new HttpError(409, 'This chat has ended', 'chat_closed');
    if (r.status === 'waiting' || r.agent_id !== me.id) throw new HttpError(409, 'Pick up the chat first', 'chat_not_mine');
    const msg = await one(db, `INSERT INTO support_chat_messages (shop_id, chat_id, sender, sender_name, body) VALUES ($1,$2,'agent',$3,$4) RETURNING *`, [r.shop_id, r.id, me.name, b.body]);
    await db.query('UPDATE support_chats SET last_message_at = now(), agent_seen_at = now() WHERE id = $1', [r.id]);
    return msg;
  });
  res.status(201).json(serializeMsg(m));
}));

platformSupportRouter.post('/live/:id/close', h(async (req, res) => {
  const me = agent(req)!;
  const out = await platformTx(async (db) => {
    const r = await one(db, 'SELECT * FROM support_chats WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!r) throw notFound('Chat');
    if (r.status === 'waiting' || r.status === 'active') {
      await db.query("UPDATE support_chats SET status = 'closed', closed_at = now(), closed_by = 'agent' WHERE id = $1", [r.id]);
      await db.query(`INSERT INTO support_chat_messages (shop_id, chat_id, sender, sender_name, body) VALUES ($1,$2,'system','',$3)`, [r.shop_id, r.id, `${me.name} ended the chat. Thanks for contacting Corpus360 support.`]);
      await audit(db, req, r.shop_id, 'close', 'support_chat', r.id);
    }
    return one(db, 'SELECT * FROM support_chats WHERE id = $1', [r.id]);
  });
  res.json(serializeChat(out));
}));
