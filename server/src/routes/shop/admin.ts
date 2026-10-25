import { Router } from 'express';
import { z } from 'zod';
import { perm } from '../../auth';
import { audit } from '../../audit';
import { many, one, query, tx } from '../../db';
import { badRequest, forbidden, parse } from '../../http';
import { GRANTABLE, ROLE_PERMISSIONS, STAFF_ROLES, rolePermissions, type StaffRole } from '../../../../shared/permissions';
import { T } from './ctx';

export const adminRouter = Router();

/* ======================= Roles & permissions ======================= */

adminRouter.get(
  '/roles',
  perm('admin'),
  T(async (db, _req, c) => {
    const custom = new Map((await query('SELECT role, permissions, updated_at FROM role_permissions WHERE shop_id = $1', [c.shopId])).map((r) => [r.role, r]));
    const counts = new Map((await many(db, 'SELECT role, count(*)::int AS n FROM users WHERE shop_id = $1 AND active GROUP BY role', [c.shopId])).map((r) => [r.role, r.n]));
    return STAFF_ROLES.map((role) => ({
      role,
      permissions: rolePermissions(role, custom.get(role)?.permissions ?? null),
      defaults: ROLE_PERMISSIONS[role],
      customized: custom.has(role),
      updatedAt: custom.get(role)?.updated_at ?? null,
      members: counts.get(role) ?? 0,
    }));
  }),
);

const roleParam = (r: string | undefined) => {
  if (!STAFF_ROLES.includes(r as StaffRole)) throw badRequest('Unknown role');
  return r as StaffRole;
};

adminRouter.put(
  '/roles/:role',
  perm('admin'),
  T(async (db, req, c) => {
    const role = roleParam(req.params.role);
    const b = parse(z.object({ permissions: z.array(z.string()).max(50) }), req.body);
    if (b.permissions.includes('admin')) throw badRequest('Administration stays with the owner');
    const perms = GRANTABLE.filter((p) => b.permissions.includes(p));
    if (perms.includes('purchases.write') && !perms.includes('purchases.read')) perms.push('purchases.read');
    if (perms.includes('banking.write') && !perms.includes('banking.read')) perms.push('banking.read');
    if (perms.includes('accounting.write') && !perms.includes('accounting.read')) perms.push('accounting.read');
    const before = await query('SELECT permissions FROM role_permissions WHERE shop_id = $1 AND role = $2', [c.shopId, role]);
    await query(`INSERT INTO role_permissions (shop_id, role, permissions) VALUES ($1,$2,$3)
      ON CONFLICT (shop_id, role) DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = now()`, [c.shopId, role, perms]);
    const old = before[0]?.permissions ?? ROLE_PERMISSIONS[role];
    await audit(db, req, c.shopId, 'update_permissions', 'role', role, { added: perms.filter((p) => !old.includes(p)), removed: old.filter((p: string) => !perms.includes(p as never)) });
    return { role, permissions: perms };
  }),
);

adminRouter.delete(
  '/roles/:role',
  perm('admin'),
  T(async (db, req, c) => {
    const role = roleParam(req.params.role);
    await query('DELETE FROM role_permissions WHERE shop_id = $1 AND role = $2', [c.shopId, role]);
    await audit(db, req, c.shopId, 'reset_permissions', 'role', role);
    return { role, permissions: ROLE_PERMISSIONS[role] };
  }),
);

/* ======================= Audit log ======================= */

adminRouter.get(
  '/audit',
  perm('audit.read'),
  T(async (db, req, c) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
    const where = ['shop_id = $1'];
    const args: unknown[] = [c.shopId];
    const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
    if (q.before && /^\d+$/.test(q.before)) add('id < ?', Number(q.before));
    if (q.entity) add('entity = ?', q.entity);
    if (q.actor) add('actor_name = ?', q.actor);
    if (q.action) add('action = ?', q.action);
    if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) add("at >= (?::date AT TIME ZONE 'Asia/Kolkata')", q.from);
    if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) add("at < ((?::date + 1) AT TIME ZONE 'Asia/Kolkata')", q.to);
    if (q.q?.trim()) add("(action || ' ' || entity || ' ' || entity_id || ' ' || actor_name || ' ' || details::text) ILIKE ?", `%${q.q.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    const rows = await many(db, `SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${limit + 1}`, args);
    const facets = q.before ? null : {
      entities: (await many(db, 'SELECT entity, count(*)::int AS n FROM audit_log WHERE shop_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 40', [c.shopId])).map((r) => ({ value: r.entity, count: r.n })),
      actors: (await many(db, 'SELECT actor_name, count(*)::int AS n FROM audit_log WHERE shop_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 40', [c.shopId])).map((r) => ({ value: r.actor_name, count: r.n })),
    };
    const page = rows.slice(0, limit);
    return {
      rows: page.map((r) => ({ id: Number(r.id), actor: r.actor_name, actorType: r.actor_type, action: r.action, entity: r.entity, entityId: r.entity_id, details: r.details, ip: r.ip, at: r.at })),
      nextCursor: rows.length > limit ? String(page[page.length - 1]!.id) : null,
      facets,
    };
  }),
);

/* ======================= Organisations ======================= */

/** Another business under the same login, on the same plan and license as this one. Owner only. */
adminRouter.post(
  '/organizations',
  perm('admin'),
  T(async (db, req, c) => {
    if (c.role !== 'Owner') throw forbidden();
    const b = parse(z.object({
      companyName: z.string().trim().min(2, 'Enter the business name').max(120),
      gstin: z.string().trim().toUpperCase().regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN').default(''),
      state: z.string().trim().min(2, 'Choose a state').max(60),
      address: z.string().trim().max(300).default(''),
      phone: z.string().trim().max(20).default(''),
    }), req.body);
    const home = await one(db, 'SELECT * FROM shops WHERE id = $1', [c.shopId]);
    const owned = await query("SELECT count(*)::int AS n FROM user_shops WHERE user_id = $1 AND role = 'Owner'", [c.id]);
    if (owned[0].n >= 9) throw badRequest('You can manage up to 10 organisations from one login');
    const shop = await tx(async (t) => {
      const s = await one(t, `INSERT INTO shops (name, owner_name, email, phone, city, plan_id, license_start, license_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [
        b.companyName, home.owner_name, home.email, b.phone || home.phone, b.state, home.plan_id, home.license_start, home.license_end,
      ]);
      await t.query("SELECT set_config('app.shop_id', $1, true)", [s!.id]);
      await t.query('INSERT INTO organizations (shop_id, company_name, legal_name, gstin, email, phone, address, state) VALUES ($1,$2,$2,$3,$4,$5,$6,$7)', [s!.id, b.companyName, b.gstin, home.email, b.phone, b.address, b.state]);
      await t.query("INSERT INTO branches (shop_id, name, address, phone, is_primary) VALUES ($1,'Head Office',$2,$3,true)", [s!.id, b.address || b.state, b.phone]);
      await t.query("INSERT INTO bank_accounts (shop_id, name, bank, account_no, type) VALUES ($1,'Petty Cash','Cash in hand','—','Cash')", [s!.id]);
      await t.query("INSERT INTO counters (shop_id, key, value) VALUES ($1,'customer',1000)", [s!.id]);
      await audit(t, req, s!.id, 'workspace_created', 'shop', s!.id, { from: c.shopId });
      await t.query("SELECT set_config('app.shop_id', '', true)");
      await t.query("INSERT INTO user_shops (user_id, shop_id, role) VALUES ($1,$2,'Owner')", [c.id, s!.id]);
      return s!;
    });
    await audit(db, req, c.shopId, 'create_organization', 'shop', shop.id, { name: b.companyName });
    return { shopId: shop.id };
  }),
);
