import { Router, type Request } from 'express';
import { z } from 'zod';
import { burnPasswordCheck, permissionsFor, resolveUserCtx, clearSessionCookie, createSession, hashPassword, randomToken, rateLimit, sha256, todayISO, verifyPassword } from '../auth';
import { audit } from '../audit';
import { config } from '../config';
import { query, tx, withTenant } from '../db';
import { h, HttpError, parse } from '../http';
import { sendMail } from '../mailer';
import { isStrongPassword, PASSWORD_RULE, type UserRole } from '../../../shared/permissions';

export const authRouter = Router();

const INVALID = 'Invalid email or password';

const password = z.string().refine(isStrongPassword, PASSWORD_RULE);

/** Shape returned by /login and /me — everything the client needs to route and gate UI. */
export async function mePayload(req: Request) {
  const ctx = req.ctx;
  if (!ctx) return null;
  if (ctx.kind === 'super') return { kind: 'super' as const, user: { id: ctx.id, name: ctx.name, email: ctx.email } };
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
    if (p.type === 'user') {
      if (!r.active) throw new HttpError(403, 'Your account has been suspended. Contact your shop owner.', 'user_inactive');
      if (!r.shop_active) throw new HttpError(403, 'This workspace has been deactivated. Contact your service provider.', 'workspace_inactive');
      // The owner may still sign in after expiry so they can renew; staff cannot.
      if (r.license_end < todayISO() && r.role !== 'Owner') throw new HttpError(402, 'This workspace’s license has expired. Ask the shop owner to renew.', 'license_expired');
    }
    await query(`UPDATE ${table(p.type)} SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [r.id]);
    await createSession(res, req, p.type, r.id, body.remember ?? true);
    req.ctx =
      p.type === 'super'
        ? { kind: 'super', id: r.id, name: r.name, email: r.email }
        : {
            kind: 'user', id: r.id, name: r.name, email: r.email, role: r.role as UserRole, shopId: r.shop_id, branchId: r.branch_id, mustChangePassword: r.must_change_password,
            permissions: await permissionsFor(r.shop_id, r.role as UserRole), homeShopId: r.shop_id,
          };
    if (p.type === 'user') await withTenant(r.shop_id, (db) => audit(db, req, r.shop_id, 'login', 'user', r.id));
    else await tx((db) => audit(db, req, null, 'login', 'super_admin', r.id));
    res.json(await mePayload(req));
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
    if (!config.demoSimplePasswords) return res.json({ enabled: false, accounts: [] });
    const { DEMO_ACCOUNTS } = await import('../seed');
    res.json({ enabled: true, accounts: DEMO_ACCOUNTS.map(({ label, email, password }) => ({ label, email, password })) });
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
      await sendMail({
        to: p.row.email,
        subject: 'Reset your Corpus360 password',
        text: `Hi ${p.row.name},\n\nUse this link to set a new password (valid for 30 minutes):\n${url}\n\nIf you didn't request this, you can ignore this email.`,
      });
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
    await query(`UPDATE ${table(r.principal_type)} SET password_hash = $2, failed_attempts = 0, locked_until = NULL ${r.principal_type === 'user' ? ', must_change_password = false' : ''} WHERE id = $1`, [r.principal_id, hash]);
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
    await query(`UPDATE ${t} SET password_hash = $2 ${t === 'users' ? ', must_change_password = false' : ''} WHERE id = $1`, [ctx.id, await hashPassword(body.next)]);
    // Keep this session, drop all others.
    await query('DELETE FROM sessions WHERE principal_id = $1 AND token_hash <> $2', [ctx.id, req.sessionHash ?? '']);
    if (ctx.kind === 'user') {
      ctx.mustChangePassword = false;
      await withTenant(ctx.shopId, (db) => audit(db, req, ctx.shopId, 'change_password', 'user', ctx.id));
    }
    res.json(await mePayload(req));
  }),
);
