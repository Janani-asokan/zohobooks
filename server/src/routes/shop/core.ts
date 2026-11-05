import { Router } from 'express';
import { BUSINESS_TEMPLATES } from '../../../../shared/templates';
import { applyTemplate } from '../../services/templates';
import { aiEnabled } from '../../services/extract';
import { aiBalance } from '../../services/aiUsage';
import { z } from 'zod';
import { hashPassword, perm, todayISO } from '../../auth';
import { audit } from '../../audit';
import { many, one, query, tx } from '../../db';
import { badRequest, conflict, HttpError, notFound, parse } from '../../http';
import { getOrg, planLimits, requireRow } from '../../services/common';
import { createOrder, razorpayEnabled, verifySignature } from '../../integrations/razorpay';
import { extendLicense } from '../platform';
import { EMAIL_RE, GSTIN_RE, gstinMatchesState } from '../../../../shared/gst';
import { isStrongPassword, PASSWORD_RULE, STAFF_ROLES } from '../../../../shared/permissions';
import { BARCODE_FIELDS, INVOICE_FIELDS, LABEL_SIZES, MANDATORY_INVOICE_FIELDS, MAX_BARCODE_FIELDS, withPrintDefaults } from '../../../../shared/printSettings';
import { T, allowed } from './ctx';
import { bankErrors, bankFromIfsc, cleanAccountNo, cleanIfsc, composeBankDetails, parseBankDetails, type BankFields } from '../../../../shared/bank';
import { VENDOR_PHONE_RULE, isValidVendorPhoneOrEmpty, normalizeVendorPhone } from '../../../../shared/contact';

export const coreRouter = Router();

/* ---------- Organization ---------- */
const serializeOrg = (o: any) => ({
  companyName: o.company_name, legalName: o.legal_name, gstin: o.gstin, email: o.email, phone: o.phone, address: o.address, state: o.state,
  logo: o.logo, invoiceFooter: o.invoice_footer, upiId: o.upi_id, bankDetails: o.bank_details, invoiceTemplate: o.invoice_template,
  compositionScheme: o.composition_scheme, autoReminders: o.auto_reminders, reminderDays: o.reminder_days, lendingEnabled: !!o.lending_enabled,
  businessType: o.business_type ?? '', itemFields: o.item_fields ?? [], invoiceFields: o.invoice_fields ?? [], units: o.units ?? [], tradeDetails: o.trade_details ?? {},
  ...bankOf(o),
});
/** The bank fields; a shop that only has the old free-text box gets it split into them (saved on its next save). */
function bankOf(o: any): BankFields {
  const f: BankFields = { bankAccountName: o.bank_account_name ?? '', bankName: o.bank_name ?? '', bankAccountNo: o.bank_account_no ?? '', bankIfsc: o.bank_ifsc ?? '', bankBranch: o.bank_branch ?? '', bankNote: o.bank_note ?? '' };
  return Object.values(f).some(Boolean) || !o.bank_details ? f : parseBankDetails(o.bank_details);
}

coreRouter.get('/organization', T(async (db, _req, c) => serializeOrg(await getOrg(db, c.shopId))));

coreRouter.put(
  '/organization',
  perm('admin'),
  T(async (db, req, c) => {
    const b = parse(
      z
        .object({
          companyName: z.string().trim().min(1, 'Company name is required').max(150),
          legalName: z.string().trim().max(150).default(''),
          gstin: z.string().trim().toUpperCase().default(''),
          // Phone and email are checked below when they change, so an older saved value never blocks saving the logo.
          email: z.string().trim().max(120).default(''),
          phone: z.string().trim().max(30, VENDOR_PHONE_RULE).default(''),
          address: z.string().max(500).default(''),
          state: z.string().trim().min(1),
          // ~300 KB cap on the data-URL logo
          logo: z.string().max(400_000).refine((v) => !v || v.startsWith('data:image/'), 'Logo must be an image').default(''),
          invoiceFooter: z.string().max(300).default(''),
          upiId: z.string().trim().refine((v) => !v || /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v), 'Enter a valid UPI ID (e.g. shop@okhdfcbank)').default(''),
          bankDetails: z.string().max(500).optional(), // the old single box; only used when no bank fields are sent
          bankAccountName: z.string().trim().max(120).default(''),
          bankName: z.string().trim().max(80).default(''),
          bankAccountNo: z.string().max(30).default('').transform(cleanAccountNo),
          bankIfsc: z.string().max(20).default('').transform(cleanIfsc),
          bankBranch: z.string().trim().max(80).default(''),
          bankNote: z.string().trim().max(300).default(''),
          invoiceTemplate: z.enum(['classic', 'modern', 'compact']).default('classic'),
          compositionScheme: z.boolean().default(false),
          autoReminders: z.boolean().default(false),
          reminderDays: z.number().int().min(1).max(60).default(3),
          // Trade registrations (drug licence, BIS number, …); left out = unchanged.
          tradeDetails: z.record(z.string().trim().max(120)).refine((v) => Object.keys(v).length <= 12, 'Too many details').optional(),
        })
        .superRefine((v, ctx) => {
          if (v.gstin && !GSTIN_RE.test(v.gstin)) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'Invalid GSTIN' });
          else if (v.gstin && !gstinMatchesState(v.gstin, v.state)) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GSTIN state code doesn’t match your state' });
          // The holder's name is required when an account number is entered or changed (checked below).
          for (const [path, message] of Object.entries(bankErrors(v, undefined, { requireName: false }))) ctx.addIssue({ code: 'custom', path: [path], message });
        }),
      req.body,
    );
    const cur = await getOrg(db, c.shopId);
    if (b.phone !== (cur.phone ?? '')) {
      // A 10-digit mobile or a landline with STD code (shared/contact.ts), saved tidied; nothing longer or shorter.
      const ph = normalizeVendorPhone(b.phone);
      if (ph === null) throw badRequest(VENDOR_PHONE_RULE, { phone: VENDOR_PHONE_RULE });
      b.phone = ph;
    }
    if (b.email !== (cur.email ?? '') && b.email && !EMAIL_RE.test(b.email)) throw badRequest('Enter a valid email address', { email: 'Enter a valid email address' });
    const curBank = bankOf(cur);
    if (b.bankAccountNo && b.bankAccountNo !== curBank.bankAccountNo && !b.bankAccountName) {
      const m = 'Enter the name on the account (customers check it before paying)';
      throw badRequest(m, { bankAccountName: m });
    }
    // The printed "Pay to" text is built from the fields; a caller that still sends only the old box keeps it.
    const bankFields: BankFields = { bankAccountName: b.bankAccountName, bankName: b.bankName || bankFromIfsc(b.bankIfsc), bankAccountNo: b.bankAccountNo, bankIfsc: b.bankIfsc, bankBranch: b.bankBranch, bankNote: b.bankNote };
    // Callers that send the bank fields (the profile screen) get the text built from them, even when all are cleared;
    // an older caller that sends only the single box keeps it.
    const sentFields = ['bankAccountNo', 'bankIfsc', 'bankAccountName', 'bankName', 'bankBranch', 'bankNote'].some((k) => k in (req.body ?? {}));
    const bankText = sentFields ? composeBankDetails(bankFields) : b.bankDetails ?? '';
    await db.query(
      `UPDATE organizations SET company_name=$2, legal_name=$3, gstin=$4, email=$5, phone=$6, address=$7, state=$8, logo=$9, invoice_footer=$10,
         upi_id=$11, bank_details=$12, invoice_template=$13, composition_scheme=$14, auto_reminders=$15, reminder_days=$16,
         bank_account_name=$17, bank_name=$18, bank_account_no=$19, bank_ifsc=$20, bank_branch=$21, bank_note=$22 WHERE shop_id=$1`,
      [c.shopId, b.companyName, b.legalName, b.gstin, b.email, b.phone, b.address, b.state, b.logo, b.invoiceFooter, b.upiId, bankText, b.invoiceTemplate, b.compositionScheme, b.autoReminders, b.reminderDays,
        bankFields.bankAccountName, bankFields.bankName, bankFields.bankAccountNo, bankFields.bankIfsc, bankFields.bankBranch, bankFields.bankNote],
    );
    if (b.tradeDetails) await db.query('UPDATE organizations SET trade_details = $2 WHERE shop_id = $1', [c.shopId, JSON.stringify(Object.fromEntries(Object.entries(b.tradeDetails).filter(([, v]) => v)))]);
    await audit(db, req, c.shopId, 'update', 'organization', c.shopId, { gstin: b.gstin, composition: b.compositionScheme, template: b.invoiceTemplate });
    return serializeOrg(await getOrg(db, c.shopId));
  }),
);

/* ---------- Business type (templates) ---------- */
coreRouter.get('/business-templates', T(async () => BUSINESS_TEMPLATES));

/** Sets up the shop for a business type. Only adds fields, units and items; nothing the shop has is changed or removed. */
coreRouter.post(
  '/organization/business-type',
  perm('admin'),
  T(async (db, req, c) => {
    const b = parse(z.object({ key: z.string().min(1).max(40), samples: z.boolean().default(true), printLayout: z.boolean().default(false) }), req.body);
    const result = await applyTemplate(db, c.shopId, b.key, { samples: b.samples, printLayout: b.printLayout });
    await audit(db, req, c.shopId, 'apply_business_type', 'organization', c.shopId, { ...result });
    return { result, organization: serializeOrg(await getOrg(db, c.shopId)) };
  }),
);

/* ---------- Print settings (thermal receipts & barcode labels) ---------- */
const fieldSchema = z.object({ key: z.enum(BARCODE_FIELDS), enabled: z.boolean(), size: z.number().int().min(8).max(40), bold: z.boolean() });
const printSchema = z.object({
  thermal: z.object({
    theme: z.enum(['compact', 'advanced', 'simple', 'classic']),
    paper: z.enum(['2in', '3in']),
    showLogo: z.boolean(), showPartyBalance: z.boolean(), showItemDescription: z.boolean(), showTime: z.boolean(),
    showGstin: z.boolean(), showHsn: z.boolean(), showTaxBreakup: z.boolean(), showSavings: z.boolean(), showUpiQr: z.boolean(),
    footer: z.string().max(200),
    /** Left out by older clients: the saved line is kept. */
    promo: z.string().trim().max(140).optional(),
  }),
  barcode: z
    .object({
      printer: z.enum(['a4', 'label']),
      labelSize: z.string().refine((id) => LABEL_SIZES.some((l) => l.id === id), 'Unknown label size'),
      barcodeHeight: z.number().int().min(20).max(80),
      fields: z.array(fieldSchema).max(BARCODE_FIELDS.length),
    })
    .superRefine((b, ctx) => {
      if (b.fields.filter((f) => f.enabled).length > MAX_BARCODE_FIELDS) ctx.addIssue({ code: 'custom', path: ['fields'], message: `Select up to ${MAX_BARCODE_FIELDS} columns` });
      if (new Set(b.fields.map((f) => f.key)).size !== b.fields.length) ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Each column can appear once' });
      const size = LABEL_SIZES.find((l) => l.id === b.labelSize);
      if (size && size.printer !== b.printer) ctx.addIssue({ code: 'custom', path: ['labelSize'], message: 'This label size is for a different printer type' });
    }),
  invoice: z
    .object({
      template: z.enum(['standard', 'modern', 'compact']),
      paper: z.enum(['a4', 'a5']),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour'),
      fields: z.object(Object.fromEntries(INVOICE_FIELDS.map((k) => [k, z.boolean()])) as Record<(typeof INVOICE_FIELDS)[number], z.ZodBoolean>).partial(),
      terms: z.string().max(1500),
      signatoryLabel: z.string().trim().min(1).max(60),
      signatureImage: z.string().max(400_000).refine((v) => v === '' || /^data:image\/(png|jpeg|webp);base64,/.test(v), 'Upload a PNG, JPG or WebP image'),
      promo: z.string().trim().max(140).optional(),
    })
    .optional(),
});

coreRouter.get('/print-settings', T(async (db, _req, c) => withPrintDefaults((await one(db, 'SELECT print_settings FROM organizations WHERE shop_id = $1', [c.shopId]))?.print_settings)));
coreRouter.put(
  '/print-settings',
  perm('admin'),
  T(async (db, req, c) => {
    const parsed = parse(printSchema, req.body);
    // Older clients send only thermal + barcode; keep the saved invoice layout in that case.
    const savedAll = withPrintDefaults((await one(db, 'SELECT print_settings FROM organizations WHERE shop_id = $1', [c.shopId]))?.print_settings);
    const saved = savedAll.invoice;
    // Fields GST law requires stay on whatever is sent (CMP-14); fields a client doesn't know yet keep their saved value.
    const invoice = parsed.invoice
      ? { ...parsed.invoice, promo: parsed.invoice.promo ?? saved.promo, fields: { ...saved.fields, ...parsed.invoice.fields, ...Object.fromEntries(MANDATORY_INVOICE_FIELDS.map((k) => [k, true])) } }
      : saved;
    const b = { ...parsed, thermal: { ...parsed.thermal, promo: parsed.thermal.promo ?? savedAll.thermal.promo }, invoice };
    await db.query('UPDATE organizations SET print_settings = $2 WHERE shop_id = $1', [c.shopId, JSON.stringify(b)]);
    await audit(db, req, c.shopId, 'update', 'print_settings', c.shopId, { theme: b.thermal.theme, paper: b.thermal.paper, label: b.barcode.labelSize, invoice: b.invoice.template });
    return withPrintDefaults(b);
  }),
);

coreRouter.get('/tax-slabs', T(async (db) => (await many(db, 'SELECT * FROM tax_slabs ORDER BY rate')).map((s) => ({ id: s.id, name: s.name, rate: Number(s.rate), active: s.active }))));

/* ---------- Branches ---------- */
const serializeBranch = (b: any) => ({ id: b.id, name: b.name, address: b.address, phone: b.phone, isPrimary: b.is_primary });
const branchBody = z.object({ name: z.string().trim().min(1, 'Branch name is required').max(100), address: z.string().max(300).default(''), phone: z.string().trim().max(30, VENDOR_PHONE_RULE).default('').refine(isValidVendorPhoneOrEmpty, VENDOR_PHONE_RULE).transform((v) => normalizeVendorPhone(v) ?? '') });

coreRouter.get('/branches', T(async (db, _req, c) => (await many(db, 'SELECT * FROM branches WHERE shop_id = $1 ORDER BY is_primary DESC, created_at', [c.shopId])).map(serializeBranch)));
coreRouter.post(
  '/branches',
  perm('admin'),
  T(async (db, req, c) => {
    const b = parse(branchBody, req.body);
    const lim = await planLimits(db, c.shopId);
    const n = await one(db, 'SELECT count(*)::int AS n FROM branches WHERE shop_id = $1', [c.shopId]);
    if (n.n >= lim.max_branches) throw new HttpError(402, `Your ${lim.name} plan allows ${lim.max_branches} branch${lim.max_branches > 1 ? 'es' : ''}. Upgrade to add more.`, 'plan_limit');
    const row = await one(db, 'INSERT INTO branches (shop_id, name, address, phone) VALUES ($1,$2,$3,$4) RETURNING *', [c.shopId, b.name, b.address, b.phone]);
    await audit(db, req, c.shopId, 'create', 'branch', row.id, { name: b.name });
    return serializeBranch(row);
  }),
);
coreRouter.put(
  '/branches/:id',
  perm('admin'),
  T(async (db, req, c) => {
    const cur = await requireRow(db, 'branches', c.shopId, req.params.id!, 'Branch');
    const b = parse(branchBody.extend({ isPrimary: z.boolean().optional() }), req.body);
    if (b.isPrimary) await db.query('UPDATE branches SET is_primary = false WHERE shop_id = $1', [c.shopId]);
    const row = await one(db, 'UPDATE branches SET name=$3, address=$4, phone=$5, is_primary = coalesce($6, is_primary) WHERE shop_id=$1 AND id=$2 RETURNING *', [c.shopId, cur.id, b.name, b.address, b.phone, b.isPrimary ?? null]);
    await audit(db, req, c.shopId, 'update', 'branch', cur.id, b);
    return serializeBranch(row);
  }),
);

/* ---------- Staff (logins with roles) ---------- */
const serializeUser = (u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, branchId: u.branch_id, active: u.active, mustChangePassword: u.must_change_password, lastLoginAt: u.last_login_at });

coreRouter.get('/staff', perm('admin'), T(async (db, _req, c) => {
  const own = (await many(db, 'SELECT * FROM users WHERE shop_id = $1 ORDER BY (role = \'Owner\') DESC, created_at', [c.shopId])).map(serializeUser);
  // Owners of other organisations who also manage this one.
  const linked = (await query('SELECT u.*, us.role AS linked_role FROM user_shops us JOIN users u ON u.id = us.user_id WHERE us.shop_id = $1', [c.shopId]))
    .map((u) => ({ ...serializeUser({ ...u, role: u.linked_role, branch_id: null }), linked: true }));
  return [...linked, ...own];
}));

coreRouter.post(
  '/staff',
  perm('admin'),
  T(async (db, req, c) => {
    const b = parse(
      z.object({
        name: z.string().trim().min(1, 'Name is required').max(120),
        email: z.string().trim().regex(EMAIL_RE, 'Valid email required'),
        role: z.enum(STAFF_ROLES),
        branchId: z.string().uuid().nullable(),
        password: z.string().refine(isStrongPassword, PASSWORD_RULE),
      }),
      req.body,
    );
    const lim = await planLimits(db, c.shopId);
    const n = await one(db, 'SELECT count(*)::int AS n FROM users WHERE shop_id = $1 AND active', [c.shopId]);
    if (n.n >= lim.max_users) throw new HttpError(402, `Your ${lim.name} plan allows ${lim.max_users} users. Upgrade to add more staff.`, 'plan_limit');
    const [dup] = await query('SELECT 1 FROM users WHERE lower(email) = lower($1) UNION SELECT 1 FROM super_admins WHERE lower(email) = lower($1)', [b.email]);
    if (dup) throw conflict('This email is already registered');
    if (b.branchId) await requireRow(db, 'branches', c.shopId, b.branchId, 'Branch');
    const u = await one(
      db,
      'INSERT INTO users (shop_id, name, email, password_hash, role, branch_id, must_change_password) VALUES ($1,$2,lower($3),$4,$5,$6,true) RETURNING *',
      [c.shopId, b.name, b.email, await hashPassword(b.password), b.role, b.branchId],
    );
    await audit(db, req, c.shopId, 'invite', 'user', u.id, { email: b.email, role: b.role });
    return serializeUser(u);
  }),
);

coreRouter.patch(
  '/staff/:id',
  perm('admin'),
  T(async (db, req, c) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(120).optional(), role: z.enum(STAFF_ROLES).optional(), branchId: z.string().uuid().nullable().optional(), active: z.boolean().optional(), password: z.string().refine(isStrongPassword, PASSWORD_RULE).optional() }), req.body);
    const u = await one(db, 'SELECT * FROM users WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
    if (!u) throw notFound('Staff member');
    if (u.role === 'Owner') throw badRequest('The owner account can’t be changed here');
    if (b.branchId) await requireRow(db, 'branches', c.shopId, b.branchId, 'Branch');
    if (b.active) {
      const lim = await planLimits(db, c.shopId);
      const n = await one(db, 'SELECT count(*)::int AS n FROM users WHERE shop_id = $1 AND active', [c.shopId]);
      if (!u.active && n.n >= lim.max_users) throw new HttpError(402, `Your plan allows ${lim.max_users} active users.`, 'plan_limit');
    }
    const row = await one(
      db,
      `UPDATE users SET name = coalesce($3, name), role = coalesce($4, role), branch_id = CASE WHEN $5::boolean THEN $6::uuid ELSE branch_id END,
              active = coalesce($7, active), password_hash = coalesce($8, password_hash), must_change_password = (must_change_password OR $8 IS NOT NULL)
        WHERE shop_id = $1 AND id = $2 RETURNING *`,
      [c.shopId, u.id, b.name ?? null, b.role ?? null, b.branchId !== undefined, b.branchId ?? null, b.active ?? null, b.password ? await hashPassword(b.password) : null],
    );
    if (b.active === false || b.password || b.role) await query("DELETE FROM sessions WHERE principal_type = 'user' AND principal_id = $1", [u.id]);
    await audit(db, req, c.shopId, 'update', 'user', u.id, { role: b.role, active: b.active, passwordReset: !!b.password });
    return serializeUser(row);
  }),
);

/* ---------- Notifications (bell) ---------- */
coreRouter.get(
  '/notifications',
  T(async (db, _req, c) => {
    const overdue = await one(db, "SELECT count(*)::int AS n, coalesce(sum(GREATEST(total - amount_paid - amount_credited, 0)),0) AS amt FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND due_date < current_date AND total - amount_paid - amount_credited > 0", [c.shopId]);
    const low = await one(db, "SELECT count(*)::int AS n FROM (SELECT i.id FROM items i LEFT JOIN item_stock s ON s.item_id = i.id WHERE i.shop_id = $1 AND i.type = 'Goods' AND NOT i.archived GROUP BY i.id HAVING coalesce(sum(s.qty),0) <= max(i.reorder_level)) x", [c.shopId]);
    const exp = await one(db, 'SELECT count(*)::int AS n FROM item_batches WHERE shop_id = $1 AND qty > 0 AND expiry_date <= current_date + 30', [c.shopId]);
    const bills = await one(db, "SELECT count(*)::int AS n FROM bills WHERE shop_id = $1 AND status = 'Open' AND due_date <= current_date + 3", [c.shopId]);
    const [lic] = await query('SELECT license_end FROM shops WHERE id = $1', [c.shopId]);
    const daysLeft = Math.round((new Date(lic.license_end).getTime() - new Date(todayISO()).getTime()) / 86400000);
    const out: Array<{ kind: string; tone: 'red' | 'amber' | 'blue'; text: string; link: string }> = [];
    if (daysLeft <= 15) out.push({ kind: 'license', tone: daysLeft < 0 ? 'red' : 'amber', text: daysLeft < 0 ? 'Your license has expired' : `License expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, link: '/app/billing' });
    if (overdue.n) out.push({ kind: 'overdue', tone: 'red', text: `${overdue.n} overdue invoice${overdue.n > 1 ? 's' : ''} · ₹${Number(overdue.amt).toLocaleString('en-IN')}`, link: '/app/sales/invoices?status=Overdue' });
    if (low.n) out.push({ kind: 'stock', tone: 'amber', text: `${low.n} item${low.n > 1 ? 's' : ''} at or below reorder level`, link: '/app/items?stock=low' });
    if (exp.n) out.push({ kind: 'expiry', tone: 'amber', text: `${exp.n} batch${exp.n > 1 ? 'es' : ''} expiring within 30 days`, link: '/app/inventory' });
    if (bills.n) out.push({ kind: 'bills', tone: 'blue', text: `${bills.n} vendor bill${bills.n > 1 ? 's' : ''} due soon`, link: '/app/purchases' });
    if (allowed(c, 'admin') && aiEnabled()) {
      const ai = await aiBalance(c.shopId);
      if (ai.level && ai.allowance && ai.pct >= 80) out.push({ kind: 'ai', tone: ai.pct >= 100 ? 'red' : 'amber', text: ai.pct >= 100 ? 'AI credits for this month are used up' : `${ai.pct}% of this month’s AI credits used`, link: '/app/features?f=ai' });
    }
    return out;
  }),
);

/* ---------- License billing (owner) — allowed even after expiry ---------- */
export const billingRouter = Router();

billingRouter.get(
  '/',
  perm('admin'),
  T(async (_db, _req, c) => {
    const [shop] = await query('SELECT s.*, p.name AS plan_name FROM shops s JOIN plans p ON p.id = s.plan_id WHERE s.id = $1', [c.shopId]);
    const plans = await query("SELECT * FROM plans WHERE id <> 'trial' ORDER BY sort");
    const payments = await query('SELECT * FROM subscription_payments WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 20', [c.shopId]);
    return {
      planId: shop.plan_id,
      planName: shop.plan_name,
      licenseStart: shop.license_start,
      licenseEnd: shop.license_end,
      onlinePayments: razorpayEnabled(),
      plans: plans.map((p) => ({ id: p.id, name: p.name, pricePerYear: Number(p.price_per_year), maxUsers: p.max_users, maxBranches: p.max_branches, maxInvoicesPerMonth: p.max_invoices_per_month })),
      payments: payments.map((p) => ({ id: p.id, amount: Number(p.amount), years: p.years, planId: p.plan_id, method: p.method, status: p.status, paidAt: p.paid_at, createdAt: p.created_at })),
    };
  }),
);

billingRouter.post(
  '/razorpay/order',
  perm('admin'),
  T(async (_db, req, c) => {
    const b = parse(z.object({ planId: z.string(), years: z.number().int().min(1).max(3) }), req.body);
    const [plan] = await query("SELECT * FROM plans WHERE id = $1 AND id <> 'trial'", [b.planId]);
    if (!plan) throw badRequest('Choose a paid plan');
    const amount = Number(plan.price_per_year) * b.years;
    const order = await createOrder(amount, `lic_${c.shopId.slice(0, 8)}_${Date.now()}`, { shopId: c.shopId, planId: b.planId, years: String(b.years) });
    await query("INSERT INTO subscription_payments (shop_id, plan_id, years, amount, method, status, razorpay_order_id) VALUES ($1,$2,$3,$4,'razorpay','created',$5)", [c.shopId, b.planId, b.years, amount, order.orderId]);
    return { ...order, name: 'Corpus360', description: `${plan.name} · ${b.years} year${b.years > 1 ? 's' : ''}` };
  }),
);

billingRouter.post(
  '/razorpay/verify',
  perm('admin'),
  T(async (_db, req, c) => {
    const b = parse(z.object({ orderId: z.string(), paymentId: z.string(), signature: z.string() }), req.body);
    if (!verifySignature(b.orderId, b.paymentId, b.signature)) throw badRequest('Payment verification failed');
    await tx(async (pdb) => {
      const sp = await one(pdb, "SELECT * FROM subscription_payments WHERE razorpay_order_id = $1 AND shop_id = $2 FOR UPDATE", [b.orderId, c.shopId]);
      if (!sp) throw notFound('Payment');
      if (sp.status === 'paid') return;
      await extendLicense(pdb, c.shopId, sp.plan_id, sp.years);
      await pdb.query("UPDATE subscription_payments SET status = 'paid', reference = $2, paid_at = now() WHERE id = $1", [sp.id, b.paymentId]);
    });
    return { ok: true };
  }),
);

