import type { Request } from 'express';
import type { Db } from '../db';
import { one, tx } from '../db';
import { hashPassword } from '../auth';
import { audit } from '../audit';
import { badRequest } from '../http';

export interface NewShop {
  shopName: string;
  ownerName: string;
  email: string;
  phone: string;
  city: string;
  planId: string;
  years: number;
  password: string;
  mustChangePassword?: boolean;
  licenseStart: string;
}

/**
 * Creates the shop record (platform), its isolated workspace (tenant rows) and the owner login —
 * all in one transaction so a failure never leaves a half-provisioned shop.
 */
export async function provisionShop(req: Request | null, s: NewShop) {
  const plan = await withPlatformPlan(s.planId);
  const days = plan.trial_days ?? 365 * s.years;
  const passwordHash = await hashPassword(s.password);
  return tx(async (db) => {
    const shop = await one(
      db,
      `INSERT INTO shops (name, owner_name, email, phone, city, plan_id, license_start, license_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$7::date + $8::int) RETURNING *`,
      [s.shopName, s.ownerName, s.email.toLowerCase(), s.phone, s.city, s.planId, s.licenseStart, days],
    );
    await db.query("SELECT set_config('app.shop_id', $1, true)", [shop.id]);
    await db.query('INSERT INTO organizations (shop_id, company_name, legal_name, email, phone, address) VALUES ($1,$2,$2,$3,$4,$5)', [shop.id, s.shopName, s.email, s.phone, s.city]);
    const br = await one(db, "INSERT INTO branches (shop_id, name, address, phone, is_primary) VALUES ($1,'Head Office',$2,$3,true) RETURNING id", [shop.id, s.city, s.phone]);
    await db.query("INSERT INTO bank_accounts (shop_id, name, bank, account_no, type) VALUES ($1,'Petty Cash','Cash in hand','—','Cash')", [shop.id]);
    await db.query("INSERT INTO counters (shop_id, key, value) VALUES ($1,'customer',1000)", [shop.id]);
    await db.query(
      `INSERT INTO users (shop_id, name, email, password_hash, role, branch_id, must_change_password) VALUES ($1,$2,$3,$4,'Owner',$5,$6)`,
      [shop.id, s.ownerName, s.email.toLowerCase(), passwordHash, br.id, s.mustChangePassword ?? true],
    );
    await audit(db, null, shop.id, 'workspace_created', 'shop', shop.id, { plan: s.planId });
    await db.query("SELECT set_config('app.shop_id', '', true)");
    await audit(db, req, null, 'create_shop', 'shop', shop.id, { name: s.shopName, plan: s.planId, years: s.years });
    return shop;
  });
}

async function withPlatformPlan(planId: string) {
  return tx(async (db: Db) => {
    const p = await one(db, 'SELECT * FROM plans WHERE id = $1', [planId]);
    if (!p) throw badRequest('Unknown plan');
    return p;
  });
}

export async function auditPlatform(db: Db, req: Request | null, action: string, entity: string, id: string, details: Record<string, unknown> = {}) {
  await audit(db, req, null, action, entity, id, details);
}
