import { Router } from 'express';
import { BUSINESS_TEMPLATES } from '../../../../shared/templates';
import { applyTemplate } from '../../services/templates';
import { aiEnabled } from '../../services/extract';
import { aiBalance } from '../../services/aiUsage';
import { z } from 'zod';
import { hashPassword, perm, todayISO } from '../../auth';
import { audit } from '../../audit';
import { many, one, query, tx, type Db } from '../../db';
import { loadEntitlements } from '../../services/features';
import { capacityOf } from '../../../../shared/features';
import { badRequest, conflict, HttpError, notFound, parse } from '../../http';
import { getOrg, planLimits, requireRow } from '../../services/common';
import { createOrder, razorpayEnabled, verifySignature } from '../../integrations/razorpay';
import { extendLicense } from '../platform';
import { EMAIL_RE, GSTIN_RE, gstinMatchesState } from '../../../../shared/gst';
import { isStrongPassword, PASSWORD_RULE, STAFF_ROLES } from '../../../../shared/permissions';
import { BARCODE_FIELDS, INVOICE_FIELDS, LABEL_SIZES, MANDATORY_INVOICE_FIELDS, MAX_BARCODE_FIELDS, withPrintDefaults } from '../../../../shared/printSettings';
import { layoutProblems } from '../../../../shared/labelLayout';
import { T, allowed } from './ctx';
import { saveLead } from '../../services/salesLeads';
import { licenseAttention } from '../../services/licenses';
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
    pageWidth: z.enum(['roll', 'printable']).optional(),
  }),
  barcode: z
    .object({
      printer: z.enum(['a4', 'label']),
      labelSize: z.string().refine((id) => LABEL_SIZES.some((l) => l.id === id), 'Unknown label size'),
      barcodeHeight: z.number().int().min(20).max(80),
      fields: z.array(fieldSchema).max(BARCODE_FIELDS.length),
      /** Label studio layout. Left out by older clients: the saved one is kept; null goes back to the label size. */
      layout: z.object({
        stock: z.enum(['roll', 'a4']),
        w: z.number().finite(), h: z.number().finite(),
        across: z.number().int(), rows: z.number().int(),
        gapX: z.number().finite(), gapY: z.number().finite(), marginX: z.number().finite(), marginY: z.number().finite(),
        rollMm: z.number().finite().min(20).max(220),
        rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
        media: z.enum(['die-cut', 'black-mark', 'continuous']).optional(),
      }).nullable().optional(),
    })
    .superRefine((b, ctx) => {
      if (b.fields.filter((f) => f.enabled).length > MAX_BARCODE_FIELDS) ctx.addIssue({ code: 'custom', path: ['fields'], message: `Select up to ${MAX_BARCODE_FIELDS} columns` });
      if (new Set(b.fields.map((f) => f.key)).size !== b.fields.length) ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Each column can appear once' });
      const size = LABEL_SIZES.find((l) => l.id === b.labelSize);
      if (size && size.printer !== b.printer) ctx.addIssue({ code: 'custom', path: ['labelSize'], message: 'This label size is for a different printer type' });
      if (b.layout) for (const m of layoutProblems(b.layout)) ctx.addIssue({ code: 'custom', path: ['layout'], message: m });
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
      printAs: z.enum(['a4', 'a5', '2in', '3in']).optional(),
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
      ? { ...parsed.invoice, promo: parsed.invoice.promo ?? saved.promo, printAs: parsed.invoice.printAs ?? saved.printAs, fields: { ...saved.fields, ...parsed.invoice.fields, ...Object.fromEntries(MANDATORY_INVOICE_FIELDS.map((k) => [k, true])) } }
      : saved;
    const b = {
      ...parsed,
      thermal: { ...parsed.thermal, promo: parsed.thermal.promo ?? savedAll.thermal.promo, pageWidth: parsed.thermal.pageWidth ?? savedAll.thermal.pageWidth },
      barcode: { ...parsed.barcode, layout: parsed.barcode.layout === undefined ? savedAll.barcode.layout : parsed.barcode.layout ?? undefined },
      invoice,
    };
    await db.query('UPDATE organizations SET print_settings = $2 WHERE shop_id = $1', [c.shopId, JSON.stringify(b)]);
    await audit(db, req, c.shopId, 'update', 'print_settings', c.shopId, { theme: b.thermal.theme, paper: b.thermal.paper, label: b.barcode.labelSize, invoice: b.invoice.template });
    return withPrintDefaults(b);
  }),
);

coreRouter.get('/tax-slabs', T(async (db) => (await many(db, 'SELECT * FROM tax_slabs ORDER BY rate')).map((s) => ({ id: s.id, name: s.name, rate: Number(s.rate), active: s.active }))));

/* ---------- Branches ---------- */
const serializeBranch = (b: any) => ({ id: b.id, kind: (b.kind ?? 'store') as 'store' | 'warehouse', name: b.name, address: b.address, phone: b.phone, isPrimary: b.is_primary, gstin: b.gstin ?? '', state: b.state ?? '', managerUserId: b.manager_user_id ?? null });
const branchBody = z.object({ name: z.string().trim().min(1, 'Branch name is required').max(100), address: z.string().max(300).default(''), phone: z.string().trim().max(30, VENDOR_PHONE_RULE).default('').refine(isValidVendorPhoneOrEmpty, VENDOR_PHONE_RULE).transform((v) => normalizeVendorPhone(v) ?? ''),
  /** A branch in another state has its own GST registration; transfers between different GSTINs are taxable supplies. */
  gstin: z.string().trim().toUpperCase().max(15).default('').refine((v) => v === '' || GSTIN_RE.test(v), 'Invalid GSTIN (e.g. 33AABCA1234F1Z5)'),
  state: z.string().trim().max(60).default(''),
  /** Gets the receipt code when stock is sent to this branch. */
  managerUserId: z.string().uuid().nullable().default(null),
  /** A store bills customers; a warehouse only holds stock (needs the "More warehouses" add-on). */
  kind: z.enum(['store', 'warehouse']).default('store') });

/**
 * Stores: the plan's branch limit plus the "More stores" add-on. Warehouses: the "More warehouses" add-on.
 * `excludeId` leaves out the branch being edited (changing its type).
 */
async function checkBranchRoom(db: Db, shopId: string, kind: 'store' | 'warehouse', excludeId: string | null = null) {
  const lim = await planLimits(db, shopId);
  const ent = await loadEntitlements(shopId, db);
  const n = (await one(db, 'SELECT count(*)::int AS n FROM branches WHERE shop_id = $1 AND kind = $2 AND id IS DISTINCT FROM $3', [shopId, kind, excludeId]))!.n;
  if (kind === 'store') {
    const max = lim.max_branches + capacityOf(ent, 'extra_stores');
    if (n >= max) throw new HttpError(402, `Your ${lim.name} plan allows ${max} store${max > 1 ? 's' : ''}. Add the “More stores” add-on (Settings → Features & add-ons) to open more.`, 'plan_limit');
  } else {
    const max = capacityOf(ent, 'extra_warehouses');
    if (n >= max) throw new HttpError(402, max ? `You have ${max} warehouse${max > 1 ? 's' : ''} in your add-on. Choose a bigger “More warehouses” pack to add more.` : 'Warehouses come with the “More warehouses” add-on (Settings → Features & add-ons).', 'plan_limit');
  }
}

/** The receiving manager must be an active login of this shop with an email. */
async function checkManager(db: Db, shopId: string, id: string | null) {
  if (!id) return;
  const u = await one(db, "SELECT email FROM users WHERE shop_id = $1 AND id = $2 AND active", [shopId, id]);
  if (!u?.email) throw badRequest('Pick an active staff member with an email', { managerUserId: 'Pick a staff member' });
}

coreRouter.get('/branches', T(async (db, _req, c) => (await many(db, 'SELECT * FROM branches WHERE shop_id = $1 ORDER BY is_primary DESC, created_at', [c.shopId])).map(serializeBranch)));
coreRouter.post(
  '/branches',
  perm('admin'),
  T(async (db, req, c) => {
    const b = parse(branchBody, req.body);
    await checkBranchRoom(db, c.shopId, b.kind);
    await checkManager(db, c.shopId, b.managerUserId);
    const row = await one(db, 'INSERT INTO branches (shop_id, name, address, phone, gstin, state, manager_user_id, kind) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [c.shopId, b.name, b.address, b.phone, b.gstin, b.state, b.managerUserId, b.kind]);
    await audit(db, req, c.shopId, 'create', 'branch', row.id, { name: b.name });
    return serializeBranch(row);
  }),
);
coreRouter.put(
  '/branches/:id',
  perm('admin'),
  T(async (db, req, c) => {
    const cur = await requireRow(db, 'branches', c.shopId, req.params.id!, 'Branch');
    // Fields left out keep their value (older screens don't send GSTIN, state or manager).
    const b = parse(branchBody.extend({ isPrimary: z.boolean().optional() }), { gstin: cur.gstin, state: cur.state, managerUserId: cur.manager_user_id, kind: cur.kind, ...req.body });
    if (b.kind !== cur.kind) {
      if (cur.is_primary || b.isPrimary) throw new HttpError(400, 'The main branch must be a store.', 'bad_request');
      await checkBranchRoom(db, c.shopId, b.kind, cur.id);
    }
    if (b.isPrimary) await db.query('UPDATE branches SET is_primary = false WHERE shop_id = $1', [c.shopId]);
    await checkManager(db, c.shopId, b.managerUserId);
    const row = await one(db, 'UPDATE branches SET name=$3, address=$4, phone=$5, is_primary = coalesce($6, is_primary), gstin=$7, state=$8, manager_user_id=$9, kind=$10 WHERE shop_id=$1 AND id=$2 RETURNING *',
      [c.shopId, cur.id, b.name, b.address, b.phone, b.isPrimary ?? null, b.gstin, b.state, b.managerUserId, b.kind]);
    await audit(db, req, c.shopId, 'update', 'branch', cur.id, b);
    return serializeBranch(row);
  }),
);

/* ---------- Staff (logins with roles) ---------- */
const serializeUser = (u: any) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone ?? '', role: u.role, branchId: u.branch_id, active: u.active, mustChangePassword: u.must_change_password, lastLoginAt: u.last_login_at });

/** A login's mobile for OTP sign-in: empty, or a 10-digit Indian mobile (stored as 10 digits). */
const loginPhone = z.string().trim().max(20).default('').transform((v, ctx) => {
  if (!v) return '';
  const d = v.replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  if (!/^[6-9]\d{9}$/.test(ten)) { ctx.addIssue({ code: 'custom', message: 'Enter a 10-digit mobile number' }); return z.NEVER; }
  return ten;
});
/** One mobile, one login: OTP sign-in has to know whose account it opens. */
async function phoneFree(phone: string, exceptId?: string) {
  if (!phone) return;
  const [dup] = await query("SELECT 1 FROM users WHERE phone = $1 AND active AND id <> coalesce($2::uuid, '00000000-0000-0000-0000-000000000000')", [phone, exceptId ?? null]);
  if (dup) throw new HttpError(409, 'This mobile number is already on another login', 'conflict', { phone: 'Already on another login' });
}

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
        phone: loginPhone,
      }),
      req.body,
    );
    await phoneFree(b.phone);
    const lim = await planLimits(db, c.shopId);
    const n = await one(db, 'SELECT count(*)::int AS n FROM users WHERE shop_id = $1 AND active', [c.shopId]);
    if (n.n >= lim.max_users) throw new HttpError(402, `Your ${lim.name} plan allows ${lim.max_users} users. Upgrade to add more staff.`, 'plan_limit');
    const [dup] = await query('SELECT 1 FROM users WHERE lower(email) = lower($1) UNION SELECT 1 FROM super_admins WHERE lower(email) = lower($1)', [b.email]);
    if (dup) throw conflict('This email is already registered');
    if (b.branchId) await requireRow(db, 'branches', c.shopId, b.branchId, 'Branch');
    const u = await one(
      db,
      'INSERT INTO users (shop_id, name, email, password_hash, role, branch_id, must_change_password, phone) VALUES ($1,$2,lower($3),$4,$5,$6,true,$7) RETURNING *',
      [c.shopId, b.name, b.email, await hashPassword(b.password), b.role, b.branchId, b.phone],
    );
    await audit(db, req, c.shopId, 'invite', 'user', u.id, { email: b.email, role: b.role });
    return serializeUser(u);
  }),
);

coreRouter.patch(
  '/staff/:id',
  perm('admin'),
  T(async (db, req, c) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(120).optional(), role: z.enum(STAFF_ROLES).optional(), branchId: z.string().uuid().nullable().optional(), active: z.boolean().optional(), password: z.string().refine(isStrongPassword, PASSWORD_RULE).optional(), phone: loginPhone.optional() }), req.body);
    const u = await one(db, 'SELECT * FROM users WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
    if (!u) throw notFound('Staff member');
    // The owner's mobile (for OTP sign-in) can be changed here; nothing else about the owner can.
    if (u.role === 'Owner' && Object.keys(b).some((k) => k !== 'phone' && (b as Record<string, unknown>)[k] !== undefined)) throw badRequest('The owner account can’t be changed here');
    if (b.phone !== undefined) await phoneFree(b.phone, u.id);
    if (b.branchId) await requireRow(db, 'branches', c.shopId, b.branchId, 'Branch');
    if (b.active) {
      const lim = await planLimits(db, c.shopId);
      const n = await one(db, 'SELECT count(*)::int AS n FROM users WHERE shop_id = $1 AND active', [c.shopId]);
      if (!u.active && n.n >= lim.max_users) throw new HttpError(402, `Your plan allows ${lim.max_users} active users.`, 'plan_limit');
    }
    const row = await one(
      db,
      `UPDATE users SET name = coalesce($3, name), role = coalesce($4, role), branch_id = CASE WHEN $5::boolean THEN $6::uuid ELSE branch_id END,
              active = coalesce($7, active), password_hash = coalesce($8, password_hash), must_change_password = (must_change_password OR $8 IS NOT NULL),
              phone = coalesce($9, phone)
        WHERE shop_id = $1 AND id = $2 RETURNING *`,
      [c.shopId, u.id, b.name ?? null, b.role ?? null, b.branchId !== undefined, b.branchId ?? null, b.active ?? null, b.password ? await hashPassword(b.password) : null, b.phone ?? null],
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
    if (allowed(c, 'licenses.read')) {
      const w = await licenseAttention(db, c.shopId);
      const bad = w.expired! + w.suspended!;
      if (bad) out.push({ kind: 'wh_license_blocked', tone: 'red', text: `${bad} warehouse licence${bad > 1 ? 's' : ''} expired or suspended · billing blocked`, link: '/app/licenses?status=expired' });
      if (w.grace) out.push({ kind: 'wh_license_grace', tone: 'red', text: `${w.grace} warehouse licence${w.grace > 1 ? 's' : ''} in grace period`, link: '/app/licenses?status=grace' });
      if (w.expiring_soon) out.push({ kind: 'wh_license_soon', tone: 'amber', text: `${w.expiring_soon} warehouse licence${w.expiring_soon > 1 ? 's' : ''} expiring within 30 days`, link: '/app/licenses?status=expiring_soon' });
    }
    if (allowed(c, 'items.write')) {
      // Stock sent to this user's branch (or any branch, for staff not tied to one) waiting for the receipt code.
      const tr = await one(db, `SELECT count(*)::int AS n FROM stock_transfers WHERE shop_id = $1 AND status = 'In transit' AND ($2::uuid IS NULL OR to_branch_id = $2) AND created_by IS DISTINCT FROM $3`,
        [c.shopId, c.branchId, c.id]);
      if (tr.n) out.push({ kind: 'transfers_in', tone: 'blue', text: `${tr.n} stock transfer${tr.n > 1 ? 's' : ''} to receive · enter the emailed code`, link: '/app/inventory/transfers?tab=receive' });
    }
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

/**
 * "Talk to sales" from inside the app, for a shop on the trial or whose license ran out (so it lives here, where an
 * expired shop can still reach): the sales team calls back. Any user of the shop may ask.
 */
billingRouter.post('/sales-lead', T(async (db, req, c, res) => {
  const b = parse(z.object({
    phone: z.string().trim().max(30).default(''),
    message: z.string().trim().max(1000).default(''),
    page: z.string().trim().max(200).default(''),
  }), req.body);
  const shop = await one(db, 'SELECT name, phone, city FROM shops WHERE id = $1', [c.shopId]);
  const lead = await saveLead({ name: c.name, phone: b.phone || shop?.phone || '', email: c.email, business: shop?.name ?? '', city: shop?.city ?? '', message: b.message, source: 'app', page: b.page, shopId: c.shopId, ip: req.ip ?? '' });
  await audit(db, req, c.shopId, 'create', 'sales_lead', lead.id, {});
  res.status(201);
  return { ok: true };
}));

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

