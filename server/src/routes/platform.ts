import { Router } from 'express';
import { z } from 'zod';
import { randomToken, requireSuper, sha256, todayISO } from '../auth';
import { audit } from '../audit';
import { config } from '../config';
import { many, one, query, tx } from '../db';
import { badRequest, conflict, h, notFound, parse } from '../http';
import { mailStatus, sendMail } from '../mailer';
import { listBackups, runBackup } from '../services/backup';
import { provisionShop } from '../services/provision';
import { activateFeature, endFeature, priceList, setPrice, shopFeatureHistory } from '../services/features';
import { aiBalance } from '../services/aiUsage';
import { FEATURES } from '../../../shared/features';
import { BUSINESS_TEMPLATES } from '../../../shared/templates';
import { EMAIL_RE } from '../../../shared/gst';
import { isStrongPassword, PASSWORD_RULE } from '../../../shared/permissions';
import { platformSupportRouter } from './platformSupport';
import { platformLogsRouter } from './platformLogs';
import { appsInfo, setAndroid } from '../services/appDownloads';
import { DEFAULT_VARS, sendBillSms, smsSettings, type SmsSettings } from '../services/sms';
import { fetchTaxpayer, forgetProvider, lookupProvider, type LookupProvider } from '../services/gstinLookup';
import { checkGstin } from '../../../shared/gst';
import { readKeyFile, resetGa, websiteTraffic, type GaSettings } from '../services/gaTraffic';

/**
 * Super Admin API. Reads/writes only platform tables (shops, plans, config, tax slabs,
 * subscription payments, platform audit). It never touches tenant tables — those are
 * RLS-protected and this router never sets app.shop_id.
 */
export const platformRouter = Router();
platformRouter.use(requireSuper);
// Customer care console: call-back requests from every shop.
platformRouter.use('/support', platformSupportRouter);
platformRouter.use('/logs', platformLogsRouter);

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
  /** Add-on features to turn on until the licence ends. Left out: a 14-day trial of every feature. */
  features: z.array(z.string()).max(50).optional(),
  /** Business template (shared/templates.ts): sets the shop up for its trade and trials that trade's add-ons. */
  businessType: z.string().max(40).optional(),
});

platformRouter.post(
  '/shops',
  h(async (req, res) => {
    const b = parse(createShopBody, req.body);
    const [dup] = await query('SELECT 1 FROM users WHERE lower(email) = lower($1) UNION SELECT 1 FROM super_admins WHERE lower(email) = lower($1)', [b.email]);
    if (dup) throw conflict('This email is already registered');
    const shop = await provisionShop(req, { ...b, licenseStart: todayISO(), mustChangePassword: true, features: b.features ?? 'trial', businessType: b.businessType || undefined });
    const plan = (await query('SELECT * FROM plans WHERE id = $1', [b.planId]))[0];
    if (Number(plan.price_per_year) > 0) {
      await query("INSERT INTO subscription_payments (shop_id, plan_id, years, amount, method, reference, status, paid_at) VALUES ($1,$2,$3,$4,'manual',$5,'paid',now())", [
        shop.id, b.planId, b.years, Number(plan.price_per_year) * b.years, b.paymentReference,
      ]);
    }
    await sendMail({
      kind: 'workspace_ready', shopId: shop.id,
      to: b.email,
      subject: 'Your Corpus360 workspace is ready',
      text: `Hi ${b.ownerName},\n\nYour workspace "${b.shopName}" is ready.\nSign in at ${config.appUrl}/login with ${b.email} and the temporary password shared with you. You'll be asked to set a new password on first sign-in.`,
    }).catch((e) => console.error(`[mail] Welcome email to ${b.email} failed: ${(e as Error).message}`));
    const [row] = await query(`${SHOPS_SQL} WHERE s.id = $1`, [shop.id]);
    res.status(201).json(serializeShop(row));
  }),
);

platformRouter.patch(
  '/shops/:id',
  h(async (req, res) => {
    const b = parse(z.object({ active: z.boolean() }), req.body);
    await tx(async (db) => {
      const s = await one(db, `UPDATE shops SET active = $2,
         deletion_requested_at = CASE WHEN $2 AND personal_data_erased_at IS NULL THEN NULL ELSE deletion_requested_at END
       WHERE id = $1 RETURNING id, name`, [req.params.id, b.active]);
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
    let emailed = false; let emailError: string | undefined;
    try { emailed = await sendMail({ kind: 'password_reset_admin', shopId: req.params.id, to: owner.email, subject: 'Reset your Corpus360 password', text: `Hi ${owner.name},\n\nYour service provider sent you a password reset link (valid 24 hours):\n${url}` }); }
    catch (e) { emailError = (e as Error).message; }
    await tx((db) => audit(db, req, null, 'send_owner_reset', 'shop', req.params.id, { emailed }));
    // When email can't go out, the super admin gets the link to pass on by phone or WhatsApp.
    res.json({ ok: true, sentTo: owner.email, emailed, ...(emailError ? { emailError } : {}), ...(config.exposeDevResetLinks || !emailed ? { devResetUrl: url } : {}) });
  }),
);

/** Email setup check for the Configuration page: which provider is set, and a test send that reports the provider's error. */
platformRouter.get('/mail', h(async (_req, res) => res.json(mailStatus())));

/**
 * GST number lookup (Validate next to a GSTIN fills the company name and address): any provider, set here. Header
 * values (API keys) are never sent back to the browser, only their names; leave a value empty to keep the saved one.
 */
const maskProvider = async () => {
  const [row] = await query('SELECT gst_lookup FROM platform_config WHERE id = 1');
  const p = row?.gst_lookup as LookupProvider | null;
  const env = !p?.url && !!config.gstLookup;
  const set = !!(p?.url || p?.kind === 'sandbox');
  return { source: set ? 'settings' : env ? 'env' : null, kind: p?.kind === 'sandbox' ? 'sandbox' : 'custom', url: p?.url ?? '', method: p?.method ?? 'GET', headerNames: Object.keys(p?.headers ?? {}), body: p?.body ?? '',
    sandbox: p?.sandbox ? { env: p.sandbox.env, keyEnd: p.sandbox.apiKey.slice(-4), hasSecret: !!p.sandbox.apiSecret } : null };
};
platformRouter.get('/gst-lookup', h(async (_req, res) => res.json(await maskProvider())));
platformRouter.put('/gst-lookup', h(async (req, res) => {
  const b = parse(z.object({
    clear: z.boolean().optional(),
    kind: z.enum(['custom', 'sandbox']).default('custom'),
    sandbox: z.object({ apiKey: z.string().trim().max(200).default(''), apiSecret: z.string().trim().max(300).default(''), env: z.enum(['live', 'test']).default('live') }).optional(),
    url: z.string().trim().max(500).default(''), method: z.enum(['GET', 'POST']).default('GET'), body: z.string().max(2000).default(''),
    headers: z.array(z.object({ name: z.string().trim().regex(/^[A-Za-z0-9-]{1,60}$/, 'Header names use letters, numbers and dashes'), value: z.string().max(500).default('') })).max(6).default([]),
  }), req.body);
  if (b.clear) await query('UPDATE platform_config SET gst_lookup = NULL WHERE id = 1');
  else if (b.kind === 'sandbox') {
    // Sandbox (sandbox.co.in): key and secret; an empty field keeps the saved one.
    const [row] = await query('SELECT gst_lookup FROM platform_config WHERE id = 1');
    const old = (row?.gst_lookup?.kind === 'sandbox' ? row.gst_lookup.sandbox : null) as { apiKey: string; apiSecret: string } | null;
    const apiKey = b.sandbox?.apiKey || old?.apiKey || ''; const apiSecret = b.sandbox?.apiSecret || old?.apiSecret || '';
    if (!apiKey || !apiSecret) throw badRequest('Enter the Sandbox API key and API secret (Sandbox dashboard → API keys)');
    await query('UPDATE platform_config SET gst_lookup = $1 WHERE id = 1', [JSON.stringify({ kind: 'sandbox', url: '', method: 'POST', headers: {}, body: '', sandbox: { apiKey, apiSecret, env: b.sandbox?.env ?? 'live' } })]);
  } else {
    if (!/^https:\/\/[^\s]+$/.test(b.url)) throw badRequest('Enter the provider’s https:// address');
    if (!b.url.includes('{gstin}') && !b.body.includes('{gstin}')) throw badRequest('Put {gstin} where the GST number goes, in the address or the body');
    const [row] = await query('SELECT gst_lookup FROM platform_config WHERE id = 1');
    const old = (row?.gst_lookup?.headers ?? {}) as Record<string, string>;
    const headers = Object.fromEntries(b.headers.map((x) => [x.name, x.value || old[x.name] || '']).filter(([, v]) => v));
    await query('UPDATE platform_config SET gst_lookup = $1 WHERE id = 1', [JSON.stringify({ url: b.url, method: b.method, headers, body: b.body })]);
  }
  forgetProvider();
  await tx((db) => audit(db, req, null, 'update', 'gst_lookup', 'settings', { cleared: !!b.clear, kind: b.kind, url: b.clear ? '' : b.url.replace(/[?#].*/, '') }));
  res.json(await maskProvider());
}));
platformRouter.post('/gst-lookup/test', h(async (req, res) => {
  const { gstin } = parse(z.object({ gstin: z.string().trim().toUpperCase().length(15, 'A GSTIN has 15 characters') }), req.body);
  if (checkGstin(gstin).status !== 'ok') throw badRequest('That GSTIN has a typo (its check digit doesn’t match). Test with a real one.');
  const p = await lookupProvider();
  if (!p) throw badRequest('Save the provider first');
  try {
    const r = await fetchTaxpayer(gstin, p);
    res.json({ ok: !!r.taxpayer, status: r.status, taxpayer: r.taxpayer, reply: JSON.stringify(r.raw)?.slice(0, 1500) ?? '' });
  } catch (e) { res.json({ ok: false, error: (e as Error).message }); }
}));

/**
 * Bills by SMS (MSG91): auth key, the DLT-approved template's ID in MSG91, which MSG91 variable holds which value,
 * on/off and the daily limit per shop. The key is never sent back to the browser.
 */
const smsView = async () => {
  const [row] = await query('SELECT sms FROM platform_config WHERE id = 1');
  const s = row?.sms as (SmsSettings | null);
  return { configured: !!(s?.authKey && s.templateId), keyEnd: s?.authKey ? s.authKey.slice(-4) : '', templateId: s?.templateId ?? '', enabled: !!s?.enabled,
    dailyPerShop: s?.dailyPerShop ?? 200, vars: { ...DEFAULT_VARS, ...(s?.vars ?? {}) } };
};
platformRouter.get('/sms', h(async (_req, res) => res.json(await smsView())));
platformRouter.put('/sms', h(async (req, res) => {
  const name = z.string().trim().regex(/^[A-Za-z0-9_]{1,40}$/, 'Use the variable name from the MSG91 template (letters, numbers, _)');
  const b = parse(z.object({
    authKey: z.string().trim().max(200).default(''), templateId: z.string().trim().max(100).default(''), enabled: z.boolean().default(false),
    dailyPerShop: z.number().int().min(1).max(10000).default(200),
    vars: z.object({ name, shop: name, bill: name, amount: name, code: name }).default(DEFAULT_VARS),
  }), req.body);
  const [row] = await query('SELECT sms FROM platform_config WHERE id = 1');
  const authKey = b.authKey || (row?.sms?.authKey ?? '');
  if (!authKey || !b.templateId) throw badRequest('Enter the MSG91 auth key and the template ID');
  if (new Set(Object.values(b.vars)).size !== 5) throw badRequest('Each value needs its own MSG91 variable');
  await query('UPDATE platform_config SET sms = $1 WHERE id = 1', [JSON.stringify({ authKey, templateId: b.templateId, enabled: b.enabled, dailyPerShop: b.dailyPerShop, vars: b.vars })]);
  await tx((db) => audit(db, req, null, 'update', 'sms_settings', 'msg91', { enabled: b.enabled, templateId: b.templateId, dailyPerShop: b.dailyPerShop }));
  res.json(await smsView());
}));
platformRouter.post('/sms/test', h(async (req, res) => {
  const { phone } = parse(z.object({ phone: z.string().trim().max(20) }), req.body);
  const s = await smsSettings();
  if (!s) throw badRequest('Save the MSG91 settings first');
  try {
    const r = await sendBillSms({ phone, customer: 'Ravi Kumar', shop: 'Corpus360 test', bill: 'TEST-0001', amount: 707, linkToken: '0'.repeat(36) }, s, { test: true });
    res.json({ ok: true, to: r.to, requestId: r.requestId });
  } catch (e) { res.json({ ok: false, error: (e as Error).message }); }
}));

/**
 * Website traffic (Google Analytics Data API): the GA4 property ID and a service account's JSON key. Only the
 * service account's email goes back to the browser, never the key.
 */
const gaView = async () => {
  const [row] = await query('SELECT ga FROM platform_config WHERE id = 1');
  const g = row?.ga as (GaSettings | null);
  return { configured: !!(g?.propertyId && g.clientEmail && g.privateKey), propertyId: g?.propertyId ?? '', clientEmail: g?.clientEmail ?? '' };
};
platformRouter.get('/ga', h(async (_req, res) => res.json(await gaView())));
platformRouter.put('/ga', h(async (req, res) => {
  const b = parse(z.object({
    propertyId: z.string().trim().regex(/^\d{5,15}$/, 'The property ID is a number, like 512345678 (Analytics → Admin → Property details), not the G-… ID'),
    keyJson: z.string().trim().max(20_000).optional(),
  }), req.body);
  const [row] = await query('SELECT ga FROM platform_config WHERE id = 1');
  const old = row?.ga as (GaSettings | null);
  const key = b.keyJson ? readKeyFile(b.keyJson) : old?.privateKey ? { clientEmail: old.clientEmail, privateKey: old.privateKey } : null;
  if (!key) throw badRequest('Add the service account’s JSON key file');
  await query('UPDATE platform_config SET ga = $1 WHERE id = 1', [JSON.stringify({ propertyId: b.propertyId, ...key })]);
  resetGa();
  await tx((db) => audit(db, req, null, 'update', 'ga_settings', 'google_analytics', { propertyId: b.propertyId, clientEmail: key.clientEmail }));
  res.json(await gaView());
}));
platformRouter.delete('/ga', h(async (req, res) => {
  await query('UPDATE platform_config SET ga = NULL WHERE id = 1');
  resetGa();
  await tx((db) => audit(db, req, null, 'delete', 'ga_settings', 'google_analytics', {}));
  res.json(await gaView());
}));
/** The dashboard card's numbers; { configured: false } until it's set up, { error } when Google says no. */
platformRouter.get('/ga/traffic', h(async (req, res) => {
  if (!(await gaView()).configured) return res.json({ configured: false });
  try { res.json({ configured: true, ...(await websiteTraffic({ fresh: req.query.fresh === '1' })) }); }
  catch (e) { res.json({ configured: true, error: (e as Error).message }); }
}));

/** Apps on the website: upload the Android APK and/or set its Play Store link. */
platformRouter.get('/app-downloads', h(async (_req, res) => res.json(await appsInfo())));
platformRouter.put('/app-downloads/android', h(async (req, res) => {
  const b = parse(z.object({
    fileBase64: z.string().max(60_000_000).optional(), fileName: z.string().trim().max(120).optional(), version: z.string().trim().max(20).optional(),
    playUrl: z.string().trim().max(300).optional(), removeFile: z.boolean().optional(),
  }), req.body);
  const r = await setAndroid(req.ctx?.kind === 'super' ? req.ctx.id : null, b);
  await tx((db) => audit(db, req, null, 'update', 'app_download', 'android', { version: r.android.apk?.version ?? '', playUrl: r.android.playUrl, removed: !!b.removeFile }));
  res.json(r);
}));

platformRouter.post(
  '/mail/test',
  h(async (req, res) => {
    const b = parse(z.object({ to: z.string().regex(EMAIL_RE, 'Enter a valid email address') }), req.body);
    const status = mailStatus();
    if (!status.configured) return res.json({ ...status, sent: false, error: 'No email provider is set on the server. Add BREVO_API_KEY (or RESEND_API_KEY, or SMTP_HOST) and MAIL_FROM in the hosting environment, then redeploy.' });
    try {
      await sendMail({ kind: 'test_email', to: b.to, subject: 'Corpus360 test email', text: `This is a test email from Corpus360 (${config.appUrl}).\n\nIf you can read this, password-reset and invoice emails will be delivered.` });
      res.json({ ...status, sent: true });
    } catch (e) {
      res.json({ ...status, sent: false, error: (e as Error).message });
    }
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

/* ---------------- Features and prices ---------------- */

/** The catalogue with prices, and every open request from shops, for the Features & prices screen. */
platformRouter.get(
  '/features',
  h(async (_req, res) => {
    const prices = await priceList();
    const requests = await query(`SELECT f.id, f.shop_id, s.name AS shop_name, f.feature_key, f.level, f.monthly_price, f.note, f.requested_by, f.created_at
      FROM shop_features f JOIN shops s ON s.id = f.shop_id WHERE f.status = 'requested' ORDER BY f.created_at`);
    const counts = await query(`SELECT feature_key, count(*)::int AS n FROM shop_features
      WHERE status = 'active' AND starts_on <= current_date AND (ends_on IS NULL OR ends_on >= current_date) GROUP BY 1`);
    res.json({
      features: FEATURES.map((f) => ({
        key: f.key, name: f.name, group: f.group, summary: f.summary, available: f.available,
        shops: counts.find((c) => c.feature_key === f.key)?.n ?? 0,
        levels: f.levels.map((l) => ({ ...l, ...prices.find((p) => p.feature === f.key && p.level === l.key)! })),
      })),
      requests: requests.map((r) => ({ id: r.id, shopId: r.shop_id, shopName: r.shop_name, feature: r.feature_key, level: r.level, monthlyPrice: r.monthly_price == null ? null : Number(r.monthly_price), note: r.note, requestedBy: r.requested_by, createdAt: r.created_at })),
    });
  }),
);

platformRouter.put(
  '/features/prices',
  h(async (req, res) => {
    const b = parse(z.object({ prices: z.array(z.object({ feature: z.string(), level: z.string(), monthly: z.number().min(0).max(1_000_000), includedCredits: z.number().int().min(0).max(10_000_000).optional() })).min(1).max(100) }), req.body);
    const by = req.ctx?.kind === 'super' ? req.ctx.email : '';
    for (const p of b.prices) await setPrice(p.feature, p.level, p.monthly, by, p.includedCredits);
    await tx((db) => audit(db, req, null, 'set_feature_prices', 'feature', '00000000-0000-0000-0000-000000000000', { prices: b.prices }));
    res.json(await priceList());
  }),
);

platformRouter.get(
  '/shops/:id/features',
  h(async (req, res) => {
    const [shop] = await query('SELECT id, name, license_end FROM shops WHERE id = $1', [req.params.id]);
    if (!shop) throw notFound('Shop');
    res.json({ shop: { id: shop.id, name: shop.name, licenseEnd: shop.license_end }, history: await shopFeatureHistory(shop.id) });
  }),
);

/** Turns a feature on for a shop (approving its request if there is one), or changes its level or end date. */
platformRouter.post(
  '/shops/:id/features/:key',
  h(async (req, res) => {
    const b = parse(z.object({
      level: z.string().min(1),
      source: z.enum(['paid', 'trial', 'complimentary']),
      endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      monthlyPrice: z.number().min(0).nullable().optional(),
      note: z.string().trim().max(300).default(''),
    }), req.body);
    const by = req.ctx?.kind === 'super' ? req.ctx.email : '';
    await tx(async (db) => {
      const s = await one(db, 'SELECT id, name FROM shops WHERE id = $1', [req.params.id]);
      if (!s) throw notFound('Shop');
      await activateFeature(db, s.id, req.params.key!, b, by);
      await audit(db, req, null, 'turn_on_feature', 'shop', s.id, { shop: s.name, feature: req.params.key, ...b });
    });
    res.json(await shopFeatureHistory(req.params.id!));
  }),
);

/** Turns a feature off for a shop from today. The shop's data is kept and comes back when it is turned on again. */
platformRouter.delete(
  '/shops/:id/features/:key',
  h(async (req, res) => {
    const note = parse(z.object({ note: z.string().trim().max(300).default('') }), req.body ?? {}).note;
    const by = req.ctx?.kind === 'super' ? req.ctx.email : '';
    await tx(async (db) => {
      const s = await one(db, 'SELECT id, name FROM shops WHERE id = $1', [req.params.id]);
      if (!s) throw notFound('Shop');
      await endFeature(db, s.id, req.params.key!, by, note);
      await audit(db, req, null, 'turn_off_feature', 'shop', s.id, { shop: s.name, feature: req.params.key, note });
    });
    res.json(await shopFeatureHistory(req.params.id!));
  }),
);

/** Declines a shop's open request. Only the request is closed: a feature the shop already has stays on. */
platformRouter.post(
  '/shops/:id/features/:key/decline',
  h(async (req, res) => {
    const note = parse(z.object({ note: z.string().trim().max(300).default('') }), req.body ?? {}).note;
    const by = req.ctx?.kind === 'super' ? req.ctx.email : '';
    await tx(async (db) => {
      const r = await one(db, `UPDATE shop_features SET status = 'ended', decided_by = $3, note = trim(note || ' Declined. ' || $4), updated_at = now()
        WHERE shop_id = $1 AND feature_key = $2 AND status = 'requested' RETURNING id`, [req.params.id, req.params.key, by, note]);
      if (!r) throw notFound('Request');
      await audit(db, req, null, 'decline_feature_request', 'shop', req.params.id!, { feature: req.params.key, note });
    });
    res.json(await shopFeatureHistory(req.params.id!));
  }),
);

/* ---------------- AI credits ---------------- */

/** Every shop's AI use this month (credits and real cost), open top-up requests, and the pack on offer. */
platformRouter.get(
  '/ai',
  h(async (_req, res) => {
    const rows = await query(`SELECT s.id, s.name, coalesce(sum(a.credits), 0) AS credits, coalesce(sum(a.cost_usd), 0) AS cost_usd, count(a.id)::int AS calls
      FROM shops s LEFT JOIN ai_usage a ON a.shop_id = s.id AND a.created_at >= date_trunc('month', current_date)
      GROUP BY s.id ORDER BY 3 DESC, s.name`);
    const shops = [];
    for (const r of rows) {
      const b = await aiBalance(r.id);
      shops.push({ id: r.id, name: r.name, level: b.level, allowance: b.allowance, used: b.used, pct: b.pct, calls: r.calls, costUsd: Math.round(Number(r.cost_usd) * 100) / 100 });
    }
    const requests = await query(`SELECT t.id, t.shop_id, s.name AS shop_name, t.credits, t.price, t.requested_by, t.created_at FROM ai_topups t
      JOIN shops s ON s.id = t.shop_id WHERE t.status = 'requested' ORDER BY t.created_at`);
    const [pack] = await query('SELECT ai_topup_credits AS credits, ai_topup_price AS price FROM platform_config WHERE id = 1');
    res.json({
      shops, totalCostUsd: Math.round(shops.reduce((s, x) => s + x.costUsd, 0) * 100) / 100,
      requests: requests.map((r) => ({ id: r.id, shopId: r.shop_id, shopName: r.shop_name, credits: r.credits, price: Number(r.price), requestedBy: r.requested_by, createdAt: r.created_at })),
      pack: { credits: pack.credits, price: Number(pack.price) },
    });
  }),
);

platformRouter.put(
  '/ai/pack',
  h(async (req, res) => {
    const b = parse(z.object({ credits: z.number().int().min(1).max(1_000_000), price: z.number().min(0).max(1_000_000) }), req.body);
    await tx(async (db) => {
      await db.query('UPDATE platform_config SET ai_topup_credits = $1, ai_topup_price = $2, updated_at = now() WHERE id = 1', [b.credits, b.price]);
      await audit(db, req, null, 'set_ai_pack', 'feature', '00000000-0000-0000-0000-000000000000', b);
    });
    res.json(b);
  }),
);

/** Grants extra credits for this month (approving the shop's open request, if any). */
platformRouter.post(
  '/shops/:id/ai/topups',
  h(async (req, res) => {
    const b = parse(z.object({ credits: z.number().int().min(1).max(1_000_000).optional(), price: z.number().min(0).optional(), note: z.string().trim().max(300).default('') }), req.body ?? {});
    const by = req.ctx?.kind === 'super' ? req.ctx.email : '';
    await tx(async (db) => {
      const s = await one(db, 'SELECT id, name FROM shops WHERE id = $1', [req.params.id]);
      if (!s) throw notFound('Shop');
      const [pack] = (await db.query('SELECT ai_topup_credits AS credits, ai_topup_price AS price FROM platform_config WHERE id = 1')).rows;
      const open = await one(db, "SELECT id, credits, price FROM ai_topups WHERE shop_id = $1 AND status = 'requested' FOR UPDATE", [s.id]);
      const credits = b.credits ?? open?.credits ?? pack.credits;
      const price = b.price ?? (open ? Number(open.price) : Number(pack.price));
      if (open) await db.query(`UPDATE ai_topups SET status = 'granted', month = date_trunc('month', current_date)::date, credits = $2, price = $3, note = $4, decided_by = $5, decided_at = now() WHERE id = $1`, [open.id, credits, price, b.note, by]);
      else await db.query(`INSERT INTO ai_topups (shop_id, month, credits, price, status, note, decided_by, decided_at) VALUES ($1, date_trunc('month', current_date)::date, $2, $3, 'granted', $4, $5, now())`, [s.id, credits, price, b.note, by]);
      await audit(db, req, null, 'grant_ai_topup', 'shop', s.id, { shop: s.name, credits, price, note: b.note });
    });
    res.json(await aiBalance(req.params.id!));
  }),
);

platformRouter.post(
  '/shops/:id/ai/topups/decline',
  h(async (req, res) => {
    const by = req.ctx?.kind === 'super' ? req.ctx.email : '';
    await tx(async (db) => {
      const r = await one(db, "UPDATE ai_topups SET status = 'declined', decided_by = $2, decided_at = now() WHERE shop_id = $1 AND status = 'requested' RETURNING id", [req.params.id, by]);
      if (!r) throw notFound('Request');
      await audit(db, req, null, 'decline_ai_topup', 'shop', req.params.id!, {});
    });
    res.json({ ok: true });
  }),
);

/** Business types for the new-shop form. */
platformRouter.get('/business-templates', h(async (_req, res) => {
  res.json(BUSINESS_TEMPLATES.map((t) => ({ key: t.key, name: t.name, summary: t.summary, features: t.features })));
}));
