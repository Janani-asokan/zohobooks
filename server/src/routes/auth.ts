import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { EMAIL_RE } from '../../../shared/gst';
import { loadEntitlements } from '../services/features';
import { burnPasswordCheck, permissionsFor, resolveUserCtx, clearSessionCookie, createSession, hashPassword, randomToken, rateLimit, sha256, todayISO, verifyPassword } from '../auth';
import { audit } from '../audit';
import { config } from '../config';
import { query, tx, withTenant } from '../db';
import { badRequest, h, HttpError, parse } from '../http';
import { otpSettings, sendLoginOtp, smsNumber, verifyLoginOtp } from '../services/sms';
import { mailConfigured, sendMail } from '../mailer';
import { provisionShop } from '../services/provision';
import { BUSINESS_TEMPLATES } from '../../../shared/templates';
import { SIGNUP_CODE } from '../../../shared/signupVerify';
import { maskEmail } from '../../../shared/transfers';
import { confirmsShopName, deletedEmail, recordsUntil, SHOP_RESTORE_DAYS } from '../../../shared/accountDeletion';
import { isStrongPassword, PASSWORD_RULE, type UserRole } from '../../../shared/permissions';

export const authRouter = Router();

const INVALID = 'Invalid email or password';

const password = z.string().refine(isStrongPassword, PASSWORD_RULE);

/** Shape returned by /login and /me — everything the client needs to route and gate UI. */
export async function mePayload(req: Request) {
  const ctx = req.ctx;
  if (!ctx) return null;
  if (ctx.kind === 'super') return { kind: 'super' as const, user: { id: ctx.id, name: ctx.name, email: ctx.email, mustChangePassword: ctx.mustChangePassword } };
  const [shop] = await query(
    `SELECT s.id, s.name, s.plan_id, p.name AS plan_name, s.license_start, s.license_end, s.active,
            p.max_users, p.max_branches, p.max_invoices_per_month
       FROM shops s JOIN plans p ON p.id = s.plan_id WHERE s.id = $1`,
    [ctx.shopId],
  );
  const [platform] = await query('SELECT customer_id_prefix, fy_start_month, auto_reset_invoice_numbering FROM platform_config WHERE id = 1');
  return {
    kind: 'user' as const,
    user: { id: ctx.id, name: ctx.name, email: ctx.email, role: ctx.role, branchId: ctx.branchId, mustChangePassword: ctx.mustChangePassword },
    permissions: ctx.permissions,
    orgCount: (await query('SELECT count(*)::int AS n FROM user_shops WHERE user_id = $1', [ctx.id]))[0].n + 1,
    shop: {
      id: shop.id,
      name: shop.name,
      planId: shop.plan_id,
      planName: shop.plan_name,
      licenseStart: shop.license_start,
      licenseEnd: shop.license_end,
      licenseExpired: shop.license_end < todayISO(),
      active: shop.active,
      limits: { users: shop.max_users, branches: shop.max_branches, invoicesPerMonth: shop.max_invoices_per_month },
      /** Add-on features this shop has: feature key → level. Core billing is not listed; every shop has it. */
      features: await loadEntitlements(ctx.shopId),
    },
    platform: {
      customerIdPrefix: platform.customer_id_prefix,
      fyStartMonth: platform.fy_start_month,
      autoResetInvoiceNumbering: platform.auto_reset_invoice_numbering,
    },
  };
}

type Principal = { type: 'super' | 'user'; row: any };

async function findPrincipal(email: string): Promise<Principal | null> {
  const e = email.trim().toLowerCase();
  const [a] = await query('SELECT * FROM super_admins WHERE lower(email) = $1', [e]);
  if (a) return { type: 'super', row: a };
  const [u] = await query('SELECT u.*, s.active AS shop_active, s.license_end FROM users u JOIN shops s ON s.id = u.shop_id WHERE lower(u.email) = $1', [e]);
  return u ? { type: 'user', row: u } : null;
}

const table = (t: Principal['type']) => (t === 'super' ? 'super_admins' : 'users');

authRouter.post(
  '/login',
  rateLimit('login', 20, 60_000),
  h(async (req, res) => {
    const body = parse(z.object({ email: z.string().email('Enter a valid email address'), password: z.string().min(1), remember: z.boolean().optional() }), req.body);
    const p = await findPrincipal(body.email);
    if (!p) {
      await burnPasswordCheck(body.password);
      throw new HttpError(401, INVALID, 'invalid_credentials');
    }
    const r = p.row;
    if (r.locked_until && new Date(r.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(r.locked_until).getTime() - Date.now()) / 60000);
      throw new HttpError(423, `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`, 'locked');
    }
    if (!(await verifyPassword(body.password, r.password_hash))) {
      const attempts = r.failed_attempts + 1;
      const lock = attempts >= config.lockout.maxAttempts;
      await query(`UPDATE ${table(p.type)} SET failed_attempts = $2, locked_until = $3 WHERE id = $1`, [
        r.id,
        lock ? 0 : attempts,
        lock ? new Date(Date.now() + config.lockout.minutes * 60000) : null,
      ]);
      if (lock) throw new HttpError(423, `Too many failed attempts. Your account is locked for ${config.lockout.minutes} minutes.`, 'locked');
      const left = config.lockout.maxAttempts - attempts;
      throw new HttpError(401, left <= 2 ? `${INVALID}. ${left} attempt${left > 1 ? 's' : ''} left before lock-out.` : INVALID, 'invalid_credentials');
    }
    await finishLogin(req, res, p, body.remember ?? true);
  }),
);

/** Who may sign in (active login, active workspace, licence), then the session and the /me answer. */
function canSignIn(p: Principal) {
  const r = p.row;
  if (p.type === 'user') {
    if (!r.active) throw new HttpError(403, 'Your account has been suspended. Contact your shop owner.', 'user_inactive');
    if (!r.shop_active) throw new HttpError(403, 'This workspace has been deactivated. Contact your service provider.', 'workspace_inactive');
    // The owner may still sign in after expiry so they can renew; staff cannot.
    if (r.license_end < todayISO() && r.role !== 'Owner') throw new HttpError(402, 'This workspace’s license has expired. Ask the shop owner to renew.', 'license_expired');
  }
}
async function finishLogin(req: Request, res: import('express').Response, p: Principal, remember: boolean, method: 'password' | 'otp' = 'password') {
  const r = p.row;
  canSignIn(p);
  await query(`UPDATE ${table(p.type)} SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [r.id]);
  const token = await createSession(res, req, p.type, r.id, remember);
  req.ctx =
    p.type === 'super'
      ? { kind: 'super', id: r.id, name: r.name, email: r.email, mustChangePassword: !!r.must_change_password }
      : {
          kind: 'user', id: r.id, name: r.name, email: r.email, role: r.role as UserRole, shopId: r.shop_id, branchId: r.branch_id, mustChangePassword: r.must_change_password,
          permissions: await permissionsFor(r.shop_id, r.role as UserRole), homeShopId: r.shop_id,
        };
  const how = method === 'otp' ? { method: 'mobile OTP' } : undefined;
  if (p.type === 'user') await withTenant(r.shop_id, (db) => audit(db, req, r.shop_id, 'login', 'user', r.id, how));
  else await tx((db) => audit(db, req, null, 'login', 'super_admin', r.id, how));
  // The CorpusLite phone app keeps the session as a bearer token (it can't rely on cookies).
  res.json({ ...(await mePayload(req)), ...(req.headers['x-client'] === 'corpuslite' ? { token } : {}) });
}

/* ---------- Sign in with a mobile OTP (shop logins only; super admins use their password) ---------- */

const OTP_SENDS_PER_HOUR = 5;
const OTP_TRIES = 5;
const OTP_GAP_S = 30;
const mobile10 = (v: string) => { const n = smsNumber(v); return n ? n.slice(2) : null; };
const OTP_SENT = 'If this number is on a Corpus360 login, an OTP is on its way. It’s valid for 10 minutes.';

/** The sign-in page shows "Sign in with mobile OTP" only when the super admin has switched it on. */
authRouter.get('/otp', h(async (_req, res) => res.json({ on: !!(await otpSettings())?.enabled })));

authRouter.post(
  '/otp/send',
  rateLimit('otp-send', 10, 15 * 60_000),
  h(async (req, res) => {
    const { phone } = parse(z.object({ phone: z.string().trim().max(20) }), req.body);
    const set = await otpSettings();
    if (!set?.enabled) throw new HttpError(404, 'Sign-in by OTP isn’t available. Sign in with your email.', 'otp_off');
    const m = mobile10(phone);
    if (!m) throw badRequest('Enter your 10-digit mobile number.', { phone: 'Enter a 10-digit mobile number' });
    const users = await query("SELECT id FROM users WHERE phone = $1 AND active AND email NOT LIKE '%@deleted.invalid'", [m]);
    if (users.length > 1) throw new HttpError(409, 'This mobile number is on more than one login. Sign in with your email and password.', 'otp_ambiguous');
    // Same answer whether or not the number is on a login, so the form can't be used to find out who uses Corpus360.
    if (users.length === 0) return res.json({ sent: true, message: OTP_SENT, wait: OTP_GAP_S });
    const [row] = await query(
      `INSERT INTO login_otps (mobile) VALUES ($1)
       ON CONFLICT (mobile) DO UPDATE SET sends = CASE WHEN login_otps.window_start < now() - interval '1 hour' THEN 0 ELSE login_otps.sends END,
              window_start = CASE WHEN login_otps.window_start < now() - interval '1 hour' THEN now() ELSE login_otps.window_start END
       RETURNING sends, extract(epoch FROM now() - sent_at)::int AS ago, (xmax = 0) AS fresh`, [m]);
    if (!row.fresh && row.ago < OTP_GAP_S) throw new HttpError(429, `Wait ${OTP_GAP_S - row.ago} seconds before asking for another OTP.`, 'rate_limited');
    if (row.sends >= OTP_SENDS_PER_HOUR) throw new HttpError(429, 'Too many OTPs for this number. Try again in an hour, or sign in with your email.', 'rate_limited');
    await sendLoginOtp(m, set);
    await query('UPDATE login_otps SET sends = sends + 1, tries = 0, sent_at = now() WHERE mobile = $1', [m]);
    res.json({ sent: true, message: OTP_SENT, wait: OTP_GAP_S });
  }),
);

authRouter.post(
  '/otp/verify',
  rateLimit('otp-verify', 20, 15 * 60_000),
  h(async (req, res) => {
    const b = parse(z.object({ phone: z.string().trim().max(20), otp: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from the SMS'), remember: z.boolean().optional() }), req.body);
    const set = await otpSettings();
    if (!set?.enabled) throw new HttpError(404, 'Sign-in by OTP isn’t available. Sign in with your email.', 'otp_off');
    const m = mobile10(b.phone);
    if (!m) throw badRequest('Enter your 10-digit mobile number.');
    const WRONG = new HttpError(401, 'That code isn’t right or has expired. Check the SMS, or tap Resend.', 'invalid_otp');
    const [o] = await query('SELECT tries, sent_at > now() - interval \'10 minutes\' AS live FROM login_otps WHERE mobile = $1', [m]);
    if (!o || !o.live) throw WRONG;
    if (o.tries >= OTP_TRIES) throw new HttpError(429, 'Too many wrong codes. Tap Resend for a new OTP.', 'rate_limited');
    await query('UPDATE login_otps SET tries = tries + 1 WHERE mobile = $1', [m]);
    const users = await query("SELECT u.*, s.active AS shop_active, s.license_end FROM users u JOIN shops s ON s.id = u.shop_id WHERE u.phone = $1 AND u.active AND u.email NOT LIKE '%@deleted.invalid'", [m]);
    if (users.length !== 1) throw WRONG;
    const r = users[0];
    if (r.locked_until && new Date(r.locked_until) > new Date()) throw new HttpError(423, 'This login is locked after too many failed attempts. Try again later.', 'locked');
    if (!(await verifyLoginOtp(m, b.otp, set))) throw WRONG;
    await query('DELETE FROM login_otps WHERE mobile = $1', [m]);
    await finishLogin(req, res, { type: 'user', row: r }, b.remember ?? true, 'otp');
  }),
);

/* ---------- Self-service signup (landing page) ---------- */
authRouter.get('/signup', h(async (_req, res) => {
  res.json({ enabled: config.publicSignup, verifyEmail: signupVerifyOn(), businessTypes: BUSINESS_TEMPLATES.map((t) => ({ key: t.key, name: t.name })) });
}));

const signupBody = z.object({
  shopName: z.string().trim().min(2, 'Enter your business name').max(120),
  ownerName: z.string().trim().min(2, 'Enter your name').max(120),
  email: z.string().trim().email('Enter a valid email address').max(160),
  phone: z.string().trim().refine((v) => v.replace(/\D/g, '').length >= 10, 'Enter a valid 10-digit mobile number'),
  city: z.string().trim().max(80).default(''),
  businessType: z.string().max(40).optional(),
  password: z.string().refine(isStrongPassword, PASSWORD_RULE),
  /** Hidden field people never see: bots fill it in. */
  website: z.string().max(200).optional(),
});

/**
 * A business owner creates their own shop on the free trial plan and is signed in straight away. The same
 * provisioning as a shop the super admin creates (branch, cash account, trial of every add-on), with the password the
 * owner chose, so no forced change. Limited to a few sign-ups per address per hour; PUBLIC_SIGNUP=0 turns it off.
 */
interface SignupForm { shopName: string; ownerName: string; email: string; phone: string; city: string; businessType?: string; passwordHash: string }

/** Creates the shop from a checked sign-up form, signs the owner in and sends the welcome email. */
async function completeSignup(req: Request, res: import('express').Response, f: SignupForm) {
  const shop = await provisionShop(req, {
    shopName: f.shopName, ownerName: f.ownerName, email: f.email, phone: f.phone, city: f.city, planId: 'trial', years: 1,
    password: '', passwordHash: f.passwordHash, mustChangePassword: false, licenseStart: todayISO(), features: 'trial', businessType: f.businessType || undefined,
  });
  const [u] = await query("SELECT id, name, email, role, branch_id FROM users WHERE shop_id = $1 AND role = 'Owner' LIMIT 1", [shop.id]);
  const token = await createSession(res, req, 'user', u.id, true);
  req.ctx = {
    kind: 'user', id: u.id, name: u.name, email: u.email, role: u.role as UserRole, shopId: shop.id, branchId: u.branch_id, mustChangePassword: false,
    permissions: await permissionsFor(shop.id, u.role as UserRole), homeShopId: shop.id,
  };
  await withTenant(shop.id, (db) => audit(db, req, shop.id, 'signup', 'shop', shop.id, { email: f.email }));
  sendMail({
    kind: 'welcome', shopId: shop.id,
    to: f.email,
    subject: 'Welcome to Corpus360',
    text: `Hi ${f.ownerName},\n\nYour workspace "${f.shopName}" is ready, with a free trial of every feature.\nSign in any time at ${config.appUrl}/login with ${f.email}.`,
  }).catch((e) => console.error(`[mail] Welcome email to ${f.email} failed: ${(e as Error).message}`));
  res.status(201).json({ ...(await mePayload(req)), ...(req.headers['x-client'] === 'corpuslite' ? { token } : {}) });
}

const emailTaken = async (email: string) =>
  (await query('SELECT 1 FROM users WHERE lower(email) = $1 UNION SELECT 1 FROM super_admins WHERE lower(email) = $1', [email])).length > 0;

/** Whether new shops must confirm their email with a code ('auto': only once an email provider is set up). */
export const signupVerifyOn = () => config.signupVerify === 'on' || (config.signupVerify === 'auto' && mailConfigured());

const codeHash = (salt: string, id: string, code: string) =>
  crypto.createHash('sha256').update(`${salt}:${id}:${code}:${process.env.OTP_PEPPER ?? ''}`).digest('hex');

/** Makes a new code for a pending sign-up (the old one stops working), stores its hash and emails it. */
async function sendSignupCode(id: string, email: string, ownerName: string) {
  const code = String(crypto.randomInt(0, 10 ** SIGNUP_CODE.digits)).padStart(SIGNUP_CODE.digits, '0');
  const salt = crypto.randomBytes(8).toString('hex');
  await query(`UPDATE signup_verifications SET code_hash = $2, attempts = 0, last_sent_at = now(), expires_at = now() + make_interval(mins => $3) WHERE id = $1`,
    [id, `${salt}:${codeHash(salt, id, code)}`, SIGNUP_CODE.ttlMinutes]);
  await sendMail({
    kind: 'signup_code',
    to: email,
    // The code is only in the body: subjects show on lock screens and in server logs.
    subject: 'Confirm your email for Corpus360',
    text: `Hi ${ownerName},\n\nEnter this code to finish creating your shop:\n\n    ${code}\n\n`
      + `It works for ${SIGNUP_CODE.ttlMinutes} minutes. If you didn't try to sign up, ignore this email: no account is created without the code.`,
  });
}

const pendingPublic = (r: { id: string; email: string; last_sent_at: Date }) => ({
  verify: true, signupId: r.id, email: maskEmail(r.email), expiresInMinutes: SIGNUP_CODE.ttlMinutes,
  resendInSeconds: Math.max(0, SIGNUP_CODE.resendSeconds - Math.floor((Date.now() - new Date(r.last_sent_at).getTime()) / 1000)),
});

/**
 * A business owner creates their own shop on the free trial plan. With the email check on, the form is held until
 * the emailed code is entered (/signup/verify); otherwise the shop is created and the owner signed in straight away.
 * Limited to a few sign-ups per address per hour; PUBLIC_SIGNUP=0 turns sign-up off.
 */
authRouter.post(
  '/signup',
  rateLimit('signup', 5, 60 * 60_000),
  h(async (req, res) => {
    if (!config.publicSignup) throw new HttpError(403, 'Sign-up is closed. Contact us to get an account.', 'signup_closed');
    const b = parse(signupBody, req.body);
    if (b.website) throw new HttpError(400, 'Could not create the account', 'rejected');
    const email = b.email.toLowerCase();
    if (await emailTaken(email)) throw new HttpError(409, 'An account with this email already exists. Sign in, or use “Forgot password”.', 'email_taken');
    if (b.businessType && !BUSINESS_TEMPLATES.some((t) => t.key === b.businessType)) throw new HttpError(400, 'Choose a business type from the list', 'bad_request');
    const form: SignupForm = { shopName: b.shopName, ownerName: b.ownerName, email, phone: b.phone, city: b.city, businessType: b.businessType, passwordHash: await hashPassword(b.password) };
    if (!signupVerifyOn()) return completeSignup(req, res, form);

    const [{ n }] = await query(`SELECT coalesce(sum(sends), 0)::int AS n FROM signup_verifications WHERE lower(email) = $1 AND created_at > now() - interval '24 hours'`, [email]);
    if (n >= SIGNUP_CODE.perDay) throw new HttpError(429, 'Too many codes sent to this email today. Try again tomorrow.', 'too_many_codes');
    const [row] = await query(`INSERT INTO signup_verifications (email, form, code_hash, expires_at, ip) VALUES ($1, $2, '', now(), $3) RETURNING id, email, last_sent_at`,
      [email, JSON.stringify(form), req.ip ?? '']);
    try { await sendSignupCode(row.id, email, form.ownerName); }
    catch (e) {
      console.error(`[mail] Sign-up code to ${email} failed: ${(e as Error).message}`);
      throw new HttpError(503, 'We couldn’t send the code to that email just now. Check the address and try again in a minute.', 'mail_failed');
    }
    res.status(202).json(pendingPublic(row));
  }),
);

const pendingRow = async (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [r] = await query('SELECT * FROM signup_verifications WHERE id = $1', [id]);
  return r as undefined | { id: string; email: string; form: SignupForm; code_hash: string; attempts: number; sends: number; last_sent_at: Date; expires_at: Date; verified_at: Date | null };
};

authRouter.post(
  '/signup/verify',
  rateLimit('signup-verify', 30, 15 * 60_000),
  h(async (req, res) => {
    const b = parse(z.object({ signupId: z.string().max(40), code: z.string().trim().max(12) }), req.body);
    const r = await pendingRow(b.signupId);
    if (!r || r.verified_at) throw new HttpError(404, 'This sign-up has expired. Fill in the form again.', 'signup_expired');
    if (r.attempts >= SIGNUP_CODE.maxAttempts) throw new HttpError(400, 'Too many wrong codes. Tap “Send a new code”.', 'code_locked', { code: 'Send a new code' });
    if (new Date(r.expires_at) < new Date()) throw new HttpError(400, 'This code has expired. Tap “Send a new code”.', 'code_expired', { code: 'Code expired' });
    const [salt, want] = r.code_hash.split(':');
    const got = codeHash(salt ?? '', r.id, b.code.replace(/\D/g, ''));
    const ok = !!want && want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
    if (!ok) {
      // Saved before replying (not thrown inside a transaction), so wrong tries always count.
      await query('UPDATE signup_verifications SET attempts = attempts + 1 WHERE id = $1', [r.id]);
      const left = SIGNUP_CODE.maxAttempts - r.attempts - 1;
      return res.status(400).json({ error: left > 0 ? `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Tap “Send a new code”.',
        code: left > 0 ? 'code_wrong' : 'code_locked', details: { code: 'Wrong code' } });
    }
    // Only one request can use the code, even if it is sent twice at once.
    const [claimed] = await query('UPDATE signup_verifications SET verified_at = now() WHERE id = $1 AND verified_at IS NULL RETURNING id', [r.id]);
    if (!claimed) throw new HttpError(409, 'This sign-up is already finished. Sign in instead.', 'signup_done');
    if (await emailTaken(r.email)) throw new HttpError(409, 'An account with this email already exists. Sign in, or use “Forgot password”.', 'email_taken');
    await completeSignup(req, res, r.form);
  }),
);

authRouter.post(
  '/signup/resend',
  rateLimit('signup-resend', 10, 15 * 60_000),
  h(async (req, res) => {
    const b = parse(z.object({ signupId: z.string().max(40) }), req.body);
    const r = await pendingRow(b.signupId);
    if (!r || r.verified_at || new Date(r.expires_at).getTime() < Date.now() - 24 * 3600_000) throw new HttpError(404, 'This sign-up has expired. Fill in the form again.', 'signup_expired');
    const wait = SIGNUP_CODE.resendSeconds - Math.floor((Date.now() - new Date(r.last_sent_at).getTime()) / 1000);
    if (wait > 0) throw new HttpError(429, `Wait ${wait} seconds before asking for a new code.`, 'resend_wait', { resendInSeconds: wait });
    const [{ n }] = await query(`SELECT coalesce(sum(sends), 0)::int AS n FROM signup_verifications WHERE lower(email) = $1 AND created_at > now() - interval '24 hours'`, [r.email]);
    if (n >= SIGNUP_CODE.perDay) throw new HttpError(429, 'Too many codes sent to this email today. Try again tomorrow.', 'too_many_codes');
    await query('UPDATE signup_verifications SET sends = sends + 1 WHERE id = $1', [r.id]);
    try { await sendSignupCode(r.id, r.email, r.form.ownerName); }
    catch (e) {
      console.error(`[mail] Sign-up code to ${r.email} failed: ${(e as Error).message}`);
      throw new HttpError(503, 'We couldn’t send the code just now. Try again in a minute.', 'mail_failed');
    }
    const [fresh] = await query('SELECT id, email, last_sent_at FROM signup_verifications WHERE id = $1', [r.id]);
    res.json(pendingPublic(fresh));
  }),
);

authRouter.post(
  '/logout',
  h(async (req, res) => {
    if (req.sessionHash) await query('DELETE FROM sessions WHERE token_hash = $1', [req.sessionHash]);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

/** Demo mode only: the public demo logins, so the login page can offer them. */
authRouter.get(
  '/demo',
  h(async (_req, res) => {
    // Hidden unless DEMO_SHOW_LOGINS=1: a public login page should not hand out passwords.
    if (!config.demoSimplePasswords || !config.demoShowLogins) return res.json({ enabled: false, accounts: [] });
    const { DEMO_ACCOUNTS } = await import('../seed');
    res.json({ enabled: true, accounts: DEMO_ACCOUNTS.filter((a) => a.kind !== 'super' || config.demoSuperAdmin).map(({ label, email, password }) => ({ label, email, password })) });
  }),
);

authRouter.get(
  '/me',
  h(async (req, res) => {
    const me = await mePayload(req);
    if (!me) throw new HttpError(401, 'Not signed in', 'unauthenticated');
    res.json(me);
  }),
);

/** Organisations this login can work in: its own and any it created or was given. */
async function orgList(userId: string, homeShopId: string, activeShopId: string) {
  const rows = await query(
    `SELECT s.id, s.name, s.active, s.license_end, x.role
       FROM (SELECT $2::uuid AS shop_id, (SELECT role FROM users WHERE id = $1) AS role UNION SELECT shop_id, role FROM user_shops WHERE user_id = $1) x
       JOIN shops s ON s.id = x.shop_id`,
    [userId, homeShopId],
  );
  // Organisation profiles are tenant rows, so each is read inside its own shop scope.
  const list = await Promise.all(rows.map(async (r) => {
    const o = await withTenant(r.id, async (db) => (await db.query('SELECT company_name, gstin, state FROM organizations WHERE shop_id = $1', [r.id])).rows[0]);
    return { id: r.id, name: o?.company_name || r.name, role: r.role, gstin: o?.gstin ?? '', state: o?.state ?? '', active: r.active, licenseExpired: r.license_end < todayISO(), current: r.id === activeShopId, home: r.id === homeShopId };
  }));
  return list.sort((a, b) => Number(b.home) - Number(a.home) || a.name.localeCompare(b.name));
}

authRouter.get(
  '/orgs',
  h(async (req, res) => {
    const ctx = req.ctx;
    if (ctx?.kind !== 'user') throw new HttpError(401, 'Please sign in', 'unauthenticated');
    res.json(await orgList(ctx.id, ctx.homeShopId, ctx.shopId));
  }),
);

authRouter.post(
  '/switch',
  h(async (req, res) => {
    const ctx = req.ctx;
    if (ctx?.kind !== 'user' || !req.sessionHash) throw new HttpError(401, 'Please sign in', 'unauthenticated');
    const { shopId } = parse(z.object({ shopId: z.string().uuid() }), req.body);
    const org = (await orgList(ctx.id, ctx.homeShopId, ctx.shopId)).find((o) => o.id === shopId);
    if (!org) throw new HttpError(403, 'You don’t have access to that organisation', 'forbidden');
    if (!org.active) throw new HttpError(403, 'That organisation has been deactivated', 'workspace_inactive');
    await query('UPDATE sessions SET active_shop_id = $2 WHERE token_hash = $1', [req.sessionHash, shopId === ctx.homeShopId ? null : shopId]);
    const next = await resolveUserCtx(ctx.id, shopId);
    if (!next) throw new HttpError(401, 'Please sign in', 'unauthenticated');
    req.ctx = next;
    await withTenant(shopId, (db) => audit(db, req, shopId, 'switch_organization', 'user', ctx.id, { from: ctx.shopId }));
    res.json(await mePayload(req));
  }),
);

authRouter.post(
  '/forgot',
  rateLimit('forgot', 5, 60_000),
  h(async (req, res) => {
    const { email } = parse(z.object({ email: z.string().email('Enter a valid email address') }), req.body);
    const p = await findPrincipal(email);
    let devResetUrl: string | undefined;
    if (p) {
      const token = randomToken();
      await query('INSERT INTO password_resets (token_hash, principal_type, principal_id, expires_at) VALUES ($1,$2,$3, now() + interval \'30 minutes\')', [sha256(token), p.type, p.row.id]);
      const url = `${config.appUrl}/reset-password?token=${token}`;
      // A failed send is logged, not shown: the reply must look the same whether or not the account exists.
      await sendMail({
        kind: 'password_reset', shopId: p.type === 'user' ? p.row.shop_id : null,
        to: p.row.email,
        subject: 'Reset your Corpus360 password',
        text: `Hi ${p.row.name},\n\nUse this link to set a new password (valid for 30 minutes):\n${url}\n\nIf you didn't request this, you can ignore this email.`,
      }).catch((e) => console.error(`[mail] Password reset email to ${p.row.email} failed: ${(e as Error).message}`));
      if (config.exposeDevResetLinks) devResetUrl = url;
    }
    // Same response whether or not the account exists (no account enumeration).
    res.json({ ok: true, ...(devResetUrl ? { devResetUrl } : {}) });
  }),
);

authRouter.post(
  '/reset',
  rateLimit('reset', 10, 60_000),
  h(async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10), password }), req.body);
    const [r] = await query('SELECT * FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [sha256(body.token)]);
    if (!r) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.', 'invalid_token');
    const hash = await hashPassword(body.password);
    await query(`UPDATE ${table(r.principal_type)} SET password_hash = $2, failed_attempts = 0, locked_until = NULL , must_change_password = false WHERE id = $1`, [r.principal_id, hash]);
    await query('UPDATE password_resets SET used_at = now() WHERE token_hash = $1', [r.token_hash]);
    // Sign out everywhere after a reset.
    await query('DELETE FROM sessions WHERE principal_type = $1 AND principal_id = $2', [r.principal_type, r.principal_id]);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/change-password',
  h(async (req, res) => {
    const ctx = req.ctx;
    if (!ctx) throw new HttpError(401, 'Not signed in', 'unauthenticated');
    const body = parse(z.object({ current: z.string().min(1), next: password }), req.body);
    const t = ctx.kind === 'super' ? 'super_admins' : 'users';
    const [row] = await query(`SELECT password_hash FROM ${t} WHERE id = $1`, [ctx.id]);
    if (!(await verifyPassword(body.current, row.password_hash))) throw new HttpError(400, 'Current password is incorrect', 'bad_request', { current: 'Current password is incorrect' });
    if (body.current === body.next) throw new HttpError(400, 'Choose a password you haven’t used here', 'bad_request', { next: 'Must differ from the current password' });
    await query(`UPDATE ${t} SET password_hash = $2, must_change_password = false WHERE id = $1`, [ctx.id, await hashPassword(body.next)]);
    // Keep this session, drop all others.
    await query('DELETE FROM sessions WHERE principal_id = $1 AND token_hash <> $2', [ctx.id, req.sessionHash ?? '']);
    ctx.mustChangePassword = false;
    if (ctx.kind === 'user') {
      await withTenant(ctx.shopId, (db) => audit(db, req, ctx.shopId, 'change_password', 'user', ctx.id));
    }
    res.json(await mePayload(req));
  }),
);

/**
 * A super admin changes their sign-in email (the console's My account). Needs the current password; the new email
 * must not be any other sign-in (super admin or shop user). Other sessions are signed out.
 */
authRouter.post(
  '/change-email',
  rateLimit('change-email', 10, 15 * 60_000),
  h(async (req, res) => {
    const ctx = req.ctx;
    if (!ctx) throw new HttpError(401, 'Not signed in', 'unauthenticated');
    if (ctx.kind !== 'super') throw new HttpError(403, 'Shop logins change their email through the shop owner', 'forbidden');
    const body = parse(z.object({ password: z.string().min(1).max(200), email: z.string().trim().toLowerCase().max(160) }), req.body);
    if (!EMAIL_RE.test(body.email)) throw new HttpError(400, 'Enter a valid email', 'bad_request', { email: 'Enter a valid email' });
    const [row] = await query('SELECT password_hash, email FROM super_admins WHERE id = $1', [ctx.id]);
    if (!(await verifyPassword(body.password, row.password_hash))) throw new HttpError(400, 'Current password is incorrect', 'bad_request', { password: 'Current password is incorrect' });
    if (row.email.toLowerCase() === body.email) throw new HttpError(400, 'That is already your email', 'bad_request', { email: 'That is already your email' });
    const [taken] = await query('SELECT 1 FROM super_admins WHERE lower(email) = $1 AND id <> $2 UNION ALL SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1', [body.email, ctx.id]);
    if (taken) throw new HttpError(409, 'Another login already uses this email', 'conflict', { email: 'Another login already uses this email' });
    await query('UPDATE super_admins SET email = $2 WHERE id = $1', [ctx.id, body.email]);
    await query('DELETE FROM sessions WHERE principal_id = $1 AND token_hash <> $2', [ctx.id, req.sessionHash ?? '']);
    await query("INSERT INTO audit_log (shop_id, actor_type, actor_id, actor_name, action, entity, entity_id, details, ip) VALUES (NULL, 'super', $1::uuid, $2, 'change_email', 'super_admin', $1::text, $3, $4)",
      [ctx.id, ctx.name, JSON.stringify({ from: row.email, to: body.email }), req.ip ?? '']);
    ctx.email = body.email;
    res.json(await mePayload(req));
  }),
);

/**
 * Delete an account (Google Play's account-deletion rule). Needs the password again.
 * - scope "me": a staff member's own login is wiped at once (name, email, password) and every session ends.
 *   Bills they made stay, still showing who made them in the audit trail.
 * - scope "shop": the owner closes the whole shop. Everyone is signed out now; personal details are wiped after
 *   SHOP_RESTORE_DAYS by the hourly job (runAccountDeletions); bills and accounts are kept as GST law requires.
 */
authRouter.post(
  '/delete-account',
  rateLimit('delete-account', 5, 15 * 60_000),
  h(async (req, res) => {
    const ctx = req.ctx;
    if (!ctx) throw new HttpError(401, 'Not signed in', 'unauthenticated');
    if (ctx.kind !== 'user') throw new HttpError(403, 'Platform staff accounts are removed by another administrator', 'forbidden');
    const body = parse(z.object({
      scope: z.enum(['me', 'shop']),
      password: z.string().min(1).max(200),
      confirm: z.string().max(200).optional(),
      reason: z.string().trim().max(500).optional(),
    }), req.body);
    const [u] = await query('SELECT id, password_hash, role, shop_id FROM users WHERE id = $1 AND deleted_at IS NULL', [ctx.id]);
    if (!u) throw new HttpError(404, 'Account not found', 'not_found');
    if (!(await verifyPassword(body.password, u.password_hash))) throw new HttpError(400, 'Password is incorrect', 'bad_request', { password: 'Password is incorrect' });

    if (body.scope === 'me') {
      if (ctx.role === 'Owner') throw new HttpError(400, 'An owner can’t delete only their login: close the shop instead, or make someone else the owner first.', 'owner_must_close');
      await tx(async (db) => {
        await db.query(`UPDATE users SET name = 'Deleted user', email = $2, phone = '', password_hash = $3, active = false, deleted_at = now(),
                          must_change_password = false, failed_attempts = 0, locked_until = NULL WHERE id = $1`,
          [u.id, deletedEmail(u.id), await hashPassword(randomToken())]);
        await db.query("DELETE FROM sessions WHERE principal_type = 'user' AND principal_id = $1", [u.id]);
      });
      await withTenant(ctx.shopId, (db) => audit(db, req, ctx.shopId, 'delete_own_account', 'user', u.id, { reason: body.reason ?? '' }));
      clearSessionCookie(res);
      return res.json({ ok: true, scope: 'me' });
    }

    if (ctx.role !== 'Owner') throw new HttpError(403, 'Only the shop owner can close the shop', 'forbidden');
    const [shop] = await query('SELECT id, name, email, owner_name FROM shops WHERE id = $1', [ctx.shopId]);
    if (!confirmsShopName(body.confirm ?? '', shop.name)) throw new HttpError(400, `Type the shop name “${shop.name}” to confirm`, 'bad_request', { confirm: 'Shop name doesn’t match' });
    await tx(async (db) => {
      await db.query(`UPDATE shops SET active = false, deletion_requested_at = now(), deletion_reason = $2, records_until = $3 WHERE id = $1`,
        [shop.id, body.reason ?? '', recordsUntil(todayISO())]);
      await db.query(`DELETE FROM sessions WHERE principal_type = 'user'
                        AND (principal_id IN (SELECT id FROM users WHERE shop_id = $1) OR active_shop_id = $1)`, [shop.id]);
    });
    await withTenant(ctx.shopId, (db) => audit(db, req, ctx.shopId, 'close_shop', 'shop', shop.id, { reason: body.reason ?? '' }));
    void sendMail({
      kind: 'shop_closed', shopId: shop.id,
      to: shop.email,
      subject: 'Your Corpus360 shop has been closed',
      text: `Hi ${shop.owner_name},\n\n"${shop.name}" was closed on ${todayISO()} and everyone has been signed out.\n\n`
        + `Changed your mind? Reply to this email or contact support within ${SHOP_RESTORE_DAYS} days and we can restore it. `
        + `After that, the names, emails and passwords of the shop's logins are erased. Bills and accounts are kept until `
        + `${recordsUntil(todayISO())} because GST law requires it, and are then deleted.\n\nIf you didn't do this, contact support at once.`,
    }).catch(() => {});
    clearSessionCookie(res);
    res.json({ ok: true, scope: 'shop', restoreDays: SHOP_RESTORE_DAYS });
  }),
);
