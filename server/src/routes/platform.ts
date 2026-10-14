import { Router } from 'express';
import { z } from 'zod';
import { randomToken, requireSuper, sha256, todayISO } from '../auth';
import { audit } from '../audit';
import { config } from '../config';
import { many, one, query, tx } from '../db';
import { badRequest, conflict, h, notFound, parse } from '../http';
import { sendMail } from '../mailer';
import { listBackups, runBackup } from '../services/backup';
import { provisionShop } from '../services/provision';
import { EMAIL_RE } from '../../../shared/gst';
import { isStrongPassword, PASSWORD_RULE } from '../../../shared/permissions';

/**
 * Super Admin API. Reads/writes only platform tables (shops, plans, config, tax slabs,
 * subscription payments, platform audit). It never touches tenant tables — those are
 * RLS-protected and this router never sets app.shop_id.
 */
export const platformRouter = Router();
platformRouter.use(requireSuper);

const serializeShop = (s: any) => ({
  id: s.id,
  shopName: s.name,
  ownerName: s.owner_name,
  email: s.email,
  phone: s.phone,
  city: s.city,
  planId: s.plan_id,
  planName: s.plan_name,
  licenseStart: s.license_start,
  licenseEnd: s.license_end,
  active: s.active,
  revenue: Number(s.revenue ?? 0),
  users: Number(s.users ?? 0),
  createdAt: s.created_at,
});

const SHOPS_SQL = `
  SELECT s.*, p.name AS plan_name,
         (SELECT coalesce(sum(amount),0) FROM subscription_payments sp WHERE sp.shop_id = s.id AND sp.status = 'paid') AS revenue,
         (SELECT count(*) FROM users u WHERE u.shop_id = s.id) AS users
    FROM shops s JOIN plans p ON p.id = s.plan_id`;

platformRouter.get(
  '/overview',
  h(async (_req, res) => {
    const shops = (await query(`${SHOPS_SQL} ORDER BY s.created_at DESC`)).map(serializeShop);
    const [rev] = await query("SELECT coalesce(sum(amount),0) AS total FROM subscription_payments WHERE status = 'paid'");
    const monthly = await query(
      `SELECT to_char(m, 'YYYY-MM') AS month, coalesce(sum(sp.amount), 0) AS revenue
         FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
         LEFT JOIN subscription_payments sp ON sp.status = 'paid' AND date_trunc('month', coalesce(sp.paid_at, sp.created_at)) = m
        GROUP BY m ORDER BY m`,
    );
    res.json({ shops, totalRevenue: Number(rev.total), monthly: monthly.map((m) => ({ month: m.month, revenue: Number(m.revenue) })) });
  }),
);

const createShopBody = z.object({
  shopName: z.string().trim().min(1, 'Shop name is required').max(120),
  ownerName: z.string().trim().min(1, 'Owner name is required').max(120),
  email: z.string().trim().regex(EMAIL_RE, 'Enter a valid email'),
  phone: z.string().trim().refine((v) => v.replace(/\D/g, '').length >= 10, 'Enter a valid phone number'),
  city: z.string().trim().max(80).default(''),
  planId: z.string(),
  years: z.number().int().min(1).max(5).default(1),
  password: z.string().refine(isStrongPassword, PASSWORD_RULE),
  paymentReference: z.string().max(100).default(''),
});

platformRouter.post(
  '/shops',
  h(async (req, res) => {
    const b = parse(createShopBody, req.body);
    const [dup] = await query('SELECT 1 FROM users WHERE lower(email) = lower($1) UNION SELECT 1 FROM super_admins WHERE lower(email) = lower($1)', [b.email]);
    if (dup) throw conflict('This email is already registered');
    const shop = await provisionShop(req, { ...b, licenseStart: todayISO(), mustChangePassword: true });
    const plan = (await query('SELECT * FROM plans WHERE id = $1', [b.planId]))[0];
    if (Number(plan.price_per_year) > 0) {
      await query("INSERT INTO subscription_payments (shop_id, plan_id, years, amount, method, reference, status, paid_at) VALUES ($1,$2,$3,$4,'manual',$5,'paid',now())", [
        shop.id, b.planId, b.years, Number(plan.price_per_year) * b.years, b.paymentReference,
      ]);
    }
    await sendMail({
      to: b.email,
      subject: 'Your Ledgerly Books workspace is ready',
      text: `Hi ${b.ownerName},\n\nYour workspace "${b.shopName}" is ready.\nSign in at ${config.appUrl}/login with ${b.email} and the temporary password shared with you. You'll be asked to set a new password on first sign-in.`,
    });
    const [row] = await query(`${SHOPS_SQL} WHERE s.id = $1`, [shop.id]);
    res.status(201).json(serializeShop(row));
  }),
);

platformRouter.patch(
  '/shops/:id',
  h(async (req, res) => {
    const b = parse(z.object({ active: z.boolean() }), req.body);
    await tx(async (db) => {
      const s = await one(db, 'UPDATE shops SET active = $2 WHERE id = $1 RETURNING id, name', [req.params.id, b.active]);
      if (!s) throw notFound('Shop');
      if (!b.active) await db.query("DELETE FROM sessions WHERE principal_type = 'user' AND principal_id IN (SELECT id FROM users WHERE shop_id = $1)", [s.id]);
      await audit(db, req, null, b.active ? 'activate_shop' : 'deactivate_shop', 'shop', s.id, { name: s.name });
    });
    const [row] = await query(`${SHOPS_SQL} WHERE s.id = $1`, [req.params.id]);
    res.json(serializeShop(row));
  }),
);

/** Extends a license from its current end (or today if already expired) and records the payment. */
export async function extendLicense(db: any, shopId: string, planId: string, years: number) {
  const plan = await one(db, 'SELECT * FROM plans WHERE id = $1', [planId]);
  if (!plan || plan.id === 'trial') throw badRequest('Choose a paid plan');
  const s = await one(
    db,
    `UPDATE shops SET plan_id = $2, license_end = GREATEST(license_end, current_date) + ($3::int * 365), last_expiry_reminder = NULL
      WHERE id = $1 RETURNING *`,
    [shopId, planId, years],
  );
  if (!s) throw notFound('Shop');
  return { shop: s, amount: Number(plan.price_per_year) * years };
}

platformRouter.post(
  '/shops/:id/renew',
  h(async (req, res) => {
    const b = parse(z.object({ planId: z.string(), years: z.number().int().min(1).max(5), reference: z.string().max(100).default('') }), req.body);
    await tx(async (db) => {
      const { shop, amount } = await extendLicense(db, req.params.id, b.planId, b.years);
      await db.query("INSERT INTO subscription_payments (shop_id, plan_id, years, amount, method, reference, status, paid_at) VALUES ($1,$2,$3,$4,'manual',$5,'paid',now())", [
        shop.id, b.planId, b.years, amount, b.reference,
      ]);
      await audit(db, req, null, 'renew_license', 'shop', shop.id, { plan: b.planId, years: b.years, amount, licenseEnd: shop.license_end });
    });
    const [row] = await query(`${SHOPS_SQL} WHERE s.id = $1`, [req.params.id]);
    res.json(serializeShop(row));
  }),
);

/** Sends the owner a password-reset link (the super admin never sees or sets shop passwords after creation). */
platformRouter.post(
  '/shops/:id/reset-owner-password',
  h(async (req, res) => {
    const [owner] = await query("SELECT u.id, u.name, u.email FROM users u WHERE u.shop_id = $1 AND u.role = 'Owner' LIMIT 1", [req.params.id]);
    if (!owner) throw notFound('Shop owner');
    const token = randomToken();
    await query("INSERT INTO password_resets (token_hash, principal_type, principal_id, expires_at) VALUES ($1,'user',$2, now() + interval '24 hours')", [sha256(token), owner.id]);
    const url = `${config.appUrl}/reset-password?token=${token}`;
    await sendMail({ to: owner.email, subject: 'Reset your Ledgerly Books password', text: `Hi ${owner.name},\n\nYour service provider sent you a password reset link (valid 24 hours):\n${url}` });
    await tx((db) => audit(db, req, null, 'send_owner_reset', 'shop', req.params.id));
    res.json({ ok: true, sentTo: owner.email, ...(config.exposeDevResetLinks ? { devResetUrl: url } : {}) });
  }),
);

platformRouter.get(
  '/payments',
  h(async (_req, res) => {
    const rows = await query(
      `SELECT sp.*, s.name AS shop_name, p.name AS plan_name FROM subscription_payments sp
         JOIN shops s ON s.id = sp.shop_id JOIN plans p ON p.id = sp.plan_id ORDER BY sp.created_at DESC LIMIT 200`,
    );
    res.json(rows.map((r) => ({ id: r.id, shopId: r.shop_id, shopName: r.shop_name, planName: r.plan_name, years: r.years, amount: Number(r.amount), method: r.method, reference: r.reference, status: r.status, paidAt: r.paid_at, createdAt: r.created_at })));
  }),
);

/* ---------- Plans ---------- */
const serializePlan = (p: any) => ({ id: p.id, name: p.name, pricePerYear: Number(p.price_per_year), trialDays: p.trial_days, maxUsers: p.max_users, maxBranches: p.max_branches, maxInvoicesPerMonth: p.max_invoices_per_month });

platformRouter.get('/plans', h(async (_req, res) => res.json((await query('SELECT * FROM plans ORDER BY sort')).map(serializePlan))));

platformRouter.put(
  '/plans/:id',
  h(async (req, res) => {
    const b = parse(
      z.object({ pricePerYear: z.number().min(0), maxUsers: z.number().int().min(1), maxBranches: z.number().int().min(1), maxInvoicesPerMonth: z.number().int().min(1).nullable() }),
      req.body,
    );
    const p = await tx(async (db) => {
      const row = await one(db, 'UPDATE plans SET price_per_year=$2, max_users=$3, max_branches=$4, max_invoices_per_month=$5 WHERE id=$1 RETURNING *', [
        req.params.id, b.pricePerYear, b.maxUsers, b.maxBranches, b.maxInvoicesPerMonth,
      ]);
      if (!row) throw notFound('Plan');
      await audit(db, req, null, 'update_plan', 'plan', row.id, b);
      return row;
    });
    res.json(serializePlan(p));
  }),
);

/* ---------- Platform configuration ---------- */
platformRouter.get(
  '/config',
  h(async (_req, res) => {
    const [c] = await query('SELECT * FROM platform_config WHERE id = 1');
    const slabs = await query('SELECT * FROM tax_slabs ORDER BY rate');
    res.json({
      customerIdPrefix: c.customer_id_prefix,
      fyStartMonth: c.fy_start_month,
      autoResetInvoiceNumbering: c.auto_reset_invoice_numbering,
      taxSlabs: slabs.map((s) => ({ id: s.id, name: s.name, rate: Number(s.rate), active: s.active })),
    });
  }),
);
platformRouter.put(
  '/config',
  h(async (req, res) => {
    const b = parse(z.object({ customerIdPrefix: z.string().regex(/^[A-Z]{2,5}$/, 'Use 2–5 uppercase letters').optional(), autoResetInvoiceNumbering: z.boolean().optional() }), req.body);
    await tx(async (db) => {
      if (b.customerIdPrefix !== undefined) await db.query('UPDATE platform_config SET customer_id_prefix = $1, updated_at = now() WHERE id = 1', [b.customerIdPrefix]);
      if (b.autoResetInvoiceNumbering !== undefined) await db.query('UPDATE platform_config SET auto_reset_invoice_numbering = $1, updated_at = now() WHERE id = 1', [b.autoResetInvoiceNumbering]);
      await audit(db, req, null, 'update_config', 'platform_config', 1, b);
    });
    res.json({ ok: true });
  }),
);

platformRouter.put(
  '/tax-slabs',
  h(async (req, res) => {
    const b = parse(
      z.object({ slabs: z.array(z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(60), rate: z.number().min(0).max(100), active: z.boolean() })).min(1) }),
      req.body,
    );
    const rates = b.slabs.map((s) => s.rate);
    if (new Set(rates).size !== rates.length) throw badRequest('Each slab must have a different rate');
    await tx(async (db) => {
      const existing = await many(db, 'SELECT id FROM tax_slabs');
      const keep = new Set(b.slabs.filter((s) => s.id).map((s) => s.id));
      for (const e of existing) {
        if (keep.has(e.id)) continue;
        // Referenced slabs can't be deleted (FK) — deactivate them instead.
        await db.query('SAVEPOINT del');
        try {
          await db.query('DELETE FROM tax_slabs WHERE id = $1', [e.id]);
          await db.query('RELEASE SAVEPOINT del');
        } catch {
          await db.query('ROLLBACK TO SAVEPOINT del');
          await db.query('UPDATE tax_slabs SET active = false WHERE id = $1', [e.id]);
        }
      }
      // Two-phase rate update avoids transient unique-rate collisions when slabs swap rates.
      for (const s of b.slabs.filter((x) => x.id)) await db.query('UPDATE tax_slabs SET rate = -1 - rate WHERE id = $1', [s.id]);
      for (const s of b.slabs) {
        if (s.id && existing.some((e) => e.id === s.id)) await db.query('UPDATE tax_slabs SET name=$2, rate=$3, active=$4 WHERE id=$1', [s.id, s.name, s.rate, s.active]);
        else await db.query('INSERT INTO tax_slabs (id, name, rate, active) VALUES ($1,$2,$3,$4)', [`tax_${String(s.rate).replace('.', '_')}_${randomToken(3)}`, s.name, s.rate, s.active]);
      }
      await audit(db, req, null, 'update_tax_slabs', 'tax_slabs', '', { count: b.slabs.length });
    });
    const slabs = await query('SELECT * FROM tax_slabs ORDER BY rate');
    res.json(slabs.map((s) => ({ id: s.id, name: s.name, rate: Number(s.rate), active: s.active })));
  }),
);

/* ---------- Audit & backups ---------- */
platformRouter.get(
  '/audit',
  h(async (_req, res) => {
    const rows = await query('SELECT * FROM audit_log WHERE shop_id IS NULL ORDER BY at DESC LIMIT 200');
    res.json(rows.map((r) => ({ id: r.id, actor: r.actor_name, action: r.action, entity: r.entity, entityId: r.entity_id, details: r.details, ip: r.ip, at: r.at })));
  }),
);

/** Backups contain every shop's data, so they're listed/triggered here but can only be downloaded by server operators. */
platformRouter.get('/backups', h(async (_req, res) => res.json({ enabled: config.backups.enabled, keep: config.backups.keep, files: listBackups() })));
platformRouter.post(
  '/backups',
  h(async (req, res) => {
    const out = await runBackup();
    await tx((db) => audit(db, req, null, 'backup', 'database', out.file, { bytes: out.bytes }));
    res.status(201).json(out);
  }),
);
