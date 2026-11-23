import { Router } from 'express';
import { rateLimit } from '../../auth';
import { one } from '../../db';
import { badRequest } from '../../http';
import { lookupGstin, lookupOn } from '../../services/gstinLookup';
import { checkGstin } from '../../../../shared/gst';
import { T } from './ctx';

/**
 * Validate next to a GST number: the offline check (state, PAN, check digit), the register record from the lookup
 * service when it is set up (legal name, trade name, status, address), and whether this shop already has the party.
 */
export const gstinRouter = Router();

gstinRouter.get('/gstin/:gstin', rateLimit('gstin', 60, 10 * 60_000), T(async (db, req, c) => {
  const gstin = String(req.params.gstin).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (gstin.length !== 15) throw badRequest('A GSTIN has 15 characters.');
  const check = checkGstin(gstin);
  const forWhat = req.query.for === 'vendor' ? 'vendor' : req.query.for === 'customer' ? 'customer' : null;
  const existing = forWhat === 'vendor'
    ? await one(db, 'SELECT id, name FROM vendors WHERE shop_id = $1 AND upper(gstin) = $2 LIMIT 1', [c.shopId, gstin])
    : forWhat === 'customer'
      ? await one(db, "SELECT id, CASE WHEN company_name <> '' THEN company_name ELSE name END AS name FROM customers WHERE shop_id = $1 AND upper(gstin) = $2 LIMIT 1", [c.shopId, gstin])
      : null;
  const org = await one(db, 'SELECT gstin FROM organizations WHERE shop_id = $1', [c.shopId]);
  const base = { gstin, check, existing: existing ? { id: existing.id, name: existing.name } : null, isYours: !!org?.gstin && org.gstin.toUpperCase() === gstin && forWhat !== null };
  // A number with a wrong check digit can't be in the register: don't spend a (paid) lookup on it.
  if (check.status !== 'ok') return { ...base, lookup: 'skipped' as const, taxpayer: null };
  if (!lookupOn()) return { ...base, lookup: 'off' as const, taxpayer: null };
  try {
    const r = await lookupGstin(gstin);
    return { ...base, lookup: r.taxpayer ? 'found' as const : 'not_found' as const, taxpayer: r.taxpayer, cached: r.cached };
  } catch (e) {
    return { ...base, lookup: 'failed' as const, taxpayer: null, error: (e as Error).message };
  }
}));
