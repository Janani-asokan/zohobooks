import type { NextFunction, Request, Response } from 'express';
import { FEATURES, featureByKey, featureForApi, hasFeature, yearlyFromMonthly, type Entitlements } from '../../../shared/features';
import { todayISO, type UserCtx } from '../auth';
import { pool, query, type Db } from '../db';
import { HttpError, badRequest } from '../http';

/*
 * Which features a shop has, and changing that. These are platform billing records (like subscription_payments),
 * so they are read with the plain pool, always filtered by shop_id.
 */

const ACTIVE = `status = 'active' AND starts_on <= current_date AND (ends_on IS NULL OR ends_on >= current_date)`;

export async function loadEntitlements(shopId: string): Promise<Entitlements> {
  const rows = await query<{ feature_key: string; level: string }>(`SELECT feature_key, level FROM shop_features WHERE shop_id = $1 AND ${ACTIVE}`, [shopId]);
  const ent: Entitlements = {};
  for (const r of rows) if (featureByKey(r.feature_key)) ent[r.feature_key] = r.level;
  return ent;
}

/** The features of the request's shop, loaded once per request. */
export async function entitlementsOf(req: Request): Promise<Entitlements> {
  const c = req.ctx as UserCtx & { features?: Entitlements };
  c.features ??= await loadEntitlements(c.shopId);
  return c.features;
}

export const shopHas = async (req: Request, key: string) => hasFeature(await entitlementsOf(req), key);

/**
 * Blocks API calls for features the shop does not have. Core billing has no feature and always passes. The message
 * tells the user what to do; the data behind a blocked feature is untouched.
 */
export const featureGate = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const f = featureForApi(req.path);
    if (!f) return next();
    if (hasFeature(await entitlementsOf(req), f.key)) return next();
    const isOwner = (req.ctx as UserCtx).permissions.includes('admin');
    throw new HttpError(403, `${f.name} isn’t turned on for this business. ${isOwner ? 'You can turn it on in Settings → Features.' : 'Ask the owner to turn it on in Settings → Features.'}`, 'feature_off', { feature: f.key });
  } catch (e) {
    next(e);
  }
};

/* ---------------- Prices ---------------- */

export interface PriceRow { feature: string; level: string; monthly: number; yearly: number; custom: boolean; includedCredits: number | null }

/** Every feature and level with its price: the platform owner's price, or the catalogue default. */
export async function priceList(): Promise<PriceRow[]> {
  const set = new Map((await query('SELECT feature_key, level, monthly, updated_by, included_credits FROM feature_prices')).map((r) => [`${r.feature_key}:${r.level}`, r]));
  return FEATURES.flatMap((f) => f.levels.map((l) => {
    const row = set.get(`${f.key}:${l.key}`);
    const monthly = row ? Number(row.monthly) : f.defaultMonthly[l.key] ?? 0;
    const includedCredits = row?.included_credits ?? f.defaultCredits?.[l.key] ?? null;
    return { feature: f.key, level: l.key, monthly, yearly: yearlyFromMonthly(monthly), custom: !!row && row.updated_by !== 'default', includedCredits: includedCredits == null ? null : Number(includedCredits) };
  }));
}

export async function setPrice(feature: string, level: string, monthly: number, by: string, includedCredits?: number) {
  const f = featureByKey(feature);
  if (!f || !f.levels.some((l) => l.key === level)) throw badRequest('Unknown feature or level');
  if (includedCredits !== undefined && !f.defaultCredits) throw badRequest(`${f.name} has no AI credits`);
  await query(`INSERT INTO feature_prices (feature_key, level, monthly, updated_by, included_credits) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (feature_key, level) DO UPDATE SET monthly = EXCLUDED.monthly, updated_by = EXCLUDED.updated_by, updated_at = now(),
      included_credits = coalesce(EXCLUDED.included_credits, feature_prices.included_credits)`, [feature, level, monthly, by, includedCredits ?? f.defaultCredits?.[level] ?? null]);
}

const priceOf = async (feature: string, level: string) => (await priceList()).find((p) => p.feature === feature && p.level === level)?.monthly ?? 0;

/* ---------------- Turning features on and off ---------------- */

const checkLevel = (feature: string, level: string) => {
  const f = featureByKey(feature);
  if (!f) throw badRequest('Unknown feature');
  if (!f.levels.some((l) => l.key === level)) throw badRequest(`${f.name} has no level “${level}”`);
  return f;
};

/** Every period and request of one shop, newest first, for the owner's and the platform's screens. */
export async function shopFeatureHistory(shopId: string) {
  return (await query(`SELECT *, (${ACTIVE}) AS live FROM shop_features WHERE shop_id = $1 ORDER BY created_at DESC`, [shopId])).map((r) => ({
    id: r.id, feature: r.feature_key, level: r.level, status: r.status, source: r.source, live: r.live,
    startsOn: r.starts_on, endsOn: r.ends_on, monthlyPrice: r.monthly_price == null ? null : Number(r.monthly_price),
    note: r.note, requestedBy: r.requested_by, decidedBy: r.decided_by, createdAt: r.created_at,
  }));
}

/** Owner asks for a feature (or another level). One open request per feature. */
export async function requestFeature(shopId: string, feature: string, level: string, by: string, note = '') {
  const f = checkLevel(feature, level);
  if (!f.available) throw badRequest(`${f.name} is coming soon and can’t be requested yet`);
  const [cur] = await query(`SELECT level, source FROM shop_features WHERE shop_id = $1 AND feature_key = $2 AND ${ACTIVE}`, [shopId, feature]);
  if (cur && cur.level === level && cur.source !== 'trial') throw badRequest(`${f.name} is already on`); // a trial may ask to keep it
  const r = await query(`INSERT INTO shop_features (shop_id, feature_key, level, status, source, monthly_price, note, requested_by)
    VALUES ($1,$2,$3,'requested','request',$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`, [shopId, feature, level, await priceOf(feature, level), note, by]);
  if (!r.length) throw badRequest(`You have already asked for ${f.name}. We will be in touch shortly.`);
  return r[0].id as string;
}

export async function cancelRequest(shopId: string, feature: string, by: string) {
  await query(`UPDATE shop_features SET status = 'ended', decided_by = $3, note = trim(note || ' Withdrawn by the shop.'), updated_at = now()
    WHERE shop_id = $1 AND feature_key = $2 AND status = 'requested'`, [shopId, feature, by]);
}

export interface Activation { level: string; source: 'trial' | 'paid' | 'complimentary'; endsOn: string | null; monthlyPrice?: number | null; note?: string;
  /** Only for setting up a new shop (demo data): the period starts on this date instead of today. */
  startsOn?: string }

/** Turns a feature on (or changes its level or end date). The previous period is ended, never deleted. */
export async function activateFeature(db: Db, shopId: string, feature: string, a: Activation, by: string) {
  const f = checkLevel(feature, a.level);
  if (!f.available) throw badRequest(`${f.name} is not offered yet`);
  if (a.endsOn && a.endsOn < todayISO()) throw badRequest('The end date is in the past');
  await db.query(`UPDATE shop_features SET status = 'ended', ends_on = CASE WHEN starts_on < current_date THEN LEAST(coalesce(ends_on, current_date - 1), current_date - 1) ELSE ends_on END,
      decided_by = $3, updated_at = now() WHERE shop_id = $1 AND feature_key = $2 AND status = 'active'`, [shopId, feature, by]);
  await db.query(`UPDATE shop_features SET status = 'ended', decided_by = $3, note = trim(note || ' Approved.'), updated_at = now()
      WHERE shop_id = $1 AND feature_key = $2 AND status = 'requested'`, [shopId, feature, by]);
  const price = a.monthlyPrice ?? (a.source === 'paid' ? await priceOf(feature, a.level) : 0);
  await db.query(`INSERT INTO shop_features (shop_id, feature_key, level, status, source, starts_on, ends_on, monthly_price, note, decided_by)
      VALUES ($1,$2,$3,'active',$4,coalesce($9::date, current_date),$5,$6,$7,$8)`, [shopId, feature, a.level, a.source, a.endsOn, price, a.note ?? '', by, a.startsOn ?? null]);
}

/** Turns a feature off from today. Its data stays; turning it on again shows everything. */
export async function endFeature(db: Db, shopId: string, feature: string, by: string, note = '') {
  if (!featureByKey(feature)) throw badRequest('Unknown feature');
  await db.query(`UPDATE shop_features SET status = 'ended', ends_on = CASE WHEN starts_on < current_date THEN current_date - 1 ELSE starts_on END,
      decided_by = $3, note = trim(note || ' ' || $4), updated_at = now() WHERE shop_id = $1 AND feature_key = $2 AND status = 'active'`, [shopId, feature, by, note]);
}

/** A new shop tries the given features (every available one when not given) for `days` days. */
export async function grantTrial(db: Db, shopId: string, days: number, by: string, only?: string[]) {
  for (const f of FEATURES.filter((x) => x.available && (!only || only.includes(x.key)))) {
    await db.query(`INSERT INTO shop_features (shop_id, feature_key, level, status, source, starts_on, ends_on, monthly_price, note, decided_by)
      VALUES ($1,$2,$3,'active','trial',current_date,current_date + $4::int,0,$5,$6) ON CONFLICT DO NOTHING`,
    [shopId, f.key, f.levels[f.levels.length - 1]!.key, days, `${days}-day trial`, by]);
  }
}

/** A second organisation of the same owner gets the same features as their first one, until the same dates. */
export async function copyFeatures(db: Db, fromShopId: string, toShopId: string, by: string) {
  await db.query(`INSERT INTO shop_features (shop_id, feature_key, level, status, source, starts_on, ends_on, monthly_price, note, decided_by)
    SELECT $2, feature_key, level, 'active', source, current_date, ends_on, monthly_price, 'Same as the owner''s first organisation', $3
    FROM shop_features WHERE shop_id = $1 AND ${ACTIVE} ON CONFLICT DO NOTHING`, [fromShopId, toShopId, by]);
}

/** Saves the catalogue's default prices for any feature or level that has none yet, so the console shows them. */
export async function syncDefaultPrices() {
  for (const f of FEATURES) for (const l of f.levels) {
    await pool.query(`INSERT INTO feature_prices (feature_key, level, monthly, updated_by, included_credits) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (feature_key, level) DO UPDATE SET included_credits = coalesce(feature_prices.included_credits, EXCLUDED.included_credits)`,
    [f.key, l.key, f.defaultMonthly[l.key] ?? 0, 'default', f.defaultCredits?.[l.key] ?? null]);
  }
}
