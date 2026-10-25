import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { parse as parseCookie, serialize } from 'cookie';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { query } from './db';
import { forbidden, HttpError } from './http';
import { rolePermissions, type Permission, type UserRole } from '../../shared/permissions';

export const SESSION_COOKIE = 'lb_session';

export type SuperCtx = { kind: 'super'; id: string; name: string; email: string };
export type UserCtx = {
  kind: 'user';
  id: string;
  name: string;
  email: string;
  role: UserRole;
  shopId: string;
  branchId: string | null;
  mustChangePassword: boolean;
  /** What this user may do in the active shop (role defaults or the shop's own matrix). */
  permissions: Permission[];
  /** The shop the login belongs to; shopId differs when the user switched organisation. */
  homeShopId: string;
};
export type Ctx = SuperCtx | UserCtx;

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: Ctx;
    sessionHash?: string;
  }
}

export const hashPassword = (p: string) => bcrypt.hash(p, 11);
export const verifyPassword = (p: string, h: string) => bcrypt.compare(p, h);
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// A fixed hash so unknown emails cost the same bcrypt time as real ones (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', 11);
export const burnPasswordCheck = (p: string) => bcrypt.compare(p, DUMMY_HASH);

export async function createSession(res: Response, req: Request, principalType: 'super' | 'user', principalId: string, remember: boolean) {
  const token = randomToken();
  const days = remember ? config.sessionDays : 1;
  const expires = new Date(Date.now() + days * 86400000);
  await query('INSERT INTO sessions (token_hash, principal_type, principal_id, expires_at, user_agent, ip) VALUES ($1,$2,$3,$4,$5,$6)', [
    sha256(token),
    principalType,
    principalId,
    expires,
    String(req.headers['user-agent'] ?? '').slice(0, 300),
    req.ip ?? '',
  ]);
  res.setHeader(
    'Set-Cookie',
    serialize(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      ...(remember ? { expires } : {}), // session cookie when not remembered
    }),
  );
}

export function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', serialize(SESSION_COOKIE, '', { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge: 0 }));
}

/** A role's permissions in one shop, honouring the shop's own roles matrix. */
export async function permissionsFor(shopId: string, role: UserRole): Promise<Permission[]> {
  if (role === 'Owner') return rolePermissions(role);
  const [rp] = await query('SELECT permissions FROM role_permissions WHERE shop_id = $1 AND role = $2', [shopId, role]);
  return rolePermissions(role, rp?.permissions ?? null);
}

/** The signed-in user as seen from the organisation they are working in (their own or one shared with them). */
export async function resolveUserCtx(userId: string, activeShopId: string | null): Promise<UserCtx | null> {
  const [u] = await query('SELECT id, name, email, role, shop_id, branch_id, active, must_change_password FROM users WHERE id = $1', [userId]);
  if (!u?.active) return null;
  let shopId: string = u.shop_id, role: UserRole = u.role, branchId: string | null = u.branch_id;
  if (activeShopId && activeShopId !== u.shop_id) {
    const [m] = await query('SELECT role FROM user_shops WHERE user_id = $1 AND shop_id = $2', [u.id, activeShopId]);
    if (m) { shopId = activeShopId; role = m.role; branchId = null; }
  }
  return {
    kind: 'user', id: u.id, name: u.name, email: u.email, role, shopId, branchId, mustChangePassword: u.must_change_password,
    permissions: await permissionsFor(shopId, role), homeShopId: u.shop_id,
  };
}

/** Resolves the session cookie into req.ctx (or leaves it undefined). */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = parseCookie(req.headers.cookie ?? '')[SESSION_COOKIE];
    if (!token) return next();
    const hash = sha256(token);
    const [s] = await query('SELECT principal_type, principal_id, active_shop_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [hash]);
    if (!s) return next();
    req.sessionHash = hash;
    if (s.principal_type === 'super') {
      const [a] = await query('SELECT id, name, email FROM super_admins WHERE id = $1', [s.principal_id]);
      if (a) req.ctx = { kind: 'super', id: a.id, name: a.name, email: a.email };
    } else {
      const u = await resolveUserCtx(s.principal_id, s.active_shop_id);
      if (u) req.ctx = u;
    }
    next();
  } catch (e) {
    next(e);
  }
}

/** Blocks cross-site form posts: mutating requests must carry our custom header (browsers won't add it cross-origin without CORS). */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'ledgerly') return next(new HttpError(403, 'Missing CSRF header', 'csrf'));
  const origin = req.headers.origin;
  if (origin && !config.allowedOrigins.includes(origin)) return next(new HttpError(403, 'Origin not allowed', 'csrf'));
  next();
}

export function requireSuper(req: Request, _res: Response, next: NextFunction) {
  if (req.ctx?.kind !== 'super') return next(new HttpError(401, 'Please sign in as a Super Admin', 'unauthenticated'));
  next();
}

/**
 * Shop users only; also enforces workspace active + license validity + first-login password change.
 * allowExpired lets the owner reach license renewal after expiry.
 */
export const requireShopUser =
  (opts: { allowExpired?: boolean } = {}) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx;
      if (ctx?.kind !== 'user') throw new HttpError(401, 'Please sign in', 'unauthenticated');
      const [shop] = await query('SELECT active, license_end FROM shops WHERE id = $1', [ctx.shopId]);
      if (!shop?.active) throw new HttpError(403, 'This workspace has been deactivated. Contact your service provider.', 'workspace_inactive');
      if (!opts.allowExpired && shop.license_end < todayISO()) throw new HttpError(402, 'Your software license has expired. Please renew to continue.', 'license_expired');
      if (ctx.mustChangePassword) throw new HttpError(403, 'Please set a new password to continue', 'password_change_required');
      next();
    } catch (e) {
      next(e);
    }
  };

export const userCtx = (req: Request) => req.ctx as UserCtx;

export const perm =
  (p: Permission) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.ctx;
    if (ctx?.kind !== 'user' || !ctx.permissions.includes(p)) return next(forbidden());
    next();
  };

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Tiny in-memory fixed-window rate limiter (per IP + key). Good enough for a single instance. */
const buckets = new Map<string, { count: number; reset: number }>();
export const rateLimit =
  (key: string, max: number, windowMs: number) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (config.env === 'test' && !process.env.TEST_RATE_LIMIT) return next();
    const k = `${key}:${req.ip}`;
    const now = Date.now();
    const b = buckets.get(k);
    if (!b || b.reset < now) buckets.set(k, { count: 1, reset: now + windowMs });
    else if (++b.count > max) return next(new HttpError(429, 'Too many attempts. Please wait a minute and try again.', 'rate_limited'));
    next();
  };
