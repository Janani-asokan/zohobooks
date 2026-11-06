/**
 * CorpusLite phone app: register a phone for billing. It gets a short code (A1, A2 … Z9) that prefixes its own GST
 * invoice series (A1/2026-27/0001), so it can give final invoice numbers with no internet. Registering again (after
 * a reinstall, with the same client id) returns the same code and the next free number, so the series continues.
 */
import { Router } from 'express';
import { z } from 'zod';
import { perm } from '../../auth';
import { audit } from '../../audit';
import { many, one } from '../../db';
import { badRequest, parse } from '../../http';
import { fyLabel } from '../../../../shared/fy';
import { platformConfig } from '../../services/common';
import { T } from './ctx';

export const appDevicesRouter = Router();
const CODES = Array.from({ length: 26 * 9 }, (_, i) => `${String.fromCharCode(65 + Math.floor(i / 9))}${(i % 9) + 1}`);

appDevicesRouter.post('/app/device', perm('sales.write'), T(async (db, req, c) => {
  const b = parse(z.object({ clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), name: z.string().trim().max(60).default('') }), req.body);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`device:${c.shopId}`]);
  let d = await one(db, 'SELECT * FROM app_devices WHERE shop_id = $1 AND client_id = $2', [c.shopId, b.clientId]);
  if (!d) {
    const used = new Set((await many(db, 'SELECT code FROM app_devices WHERE shop_id = $1', [c.shopId])).map((r) => r.code));
    const code = CODES.find((x) => !used.has(x));
    if (!code) throw badRequest('This shop has registered the most phones allowed (234).');
    d = await one(db, 'INSERT INTO app_devices (shop_id, client_id, code, name, registered_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [c.shopId, b.clientId, code, b.name, c.id]);
    await audit(db, req, c.shopId, 'register', 'app_device', d.id, { code, name: b.name });
  } else await db.query("UPDATE app_devices SET last_seen_at = now(), name = coalesce(nullif($2, ''), name) WHERE id = $1", [d.id, b.name]);
  const cfg = await platformConfig(db);
  const fy = fyLabel(new Date(), cfg.fyStartMonth);
  // The next number this phone may use in this financial year: one after the highest it has used.
  const last = await one(db, "SELECT max(split_part(number, '/', 3)::int) AS n FROM invoices WHERE shop_id = $1 AND device_id = $2 AND fy = $3 AND number ~ '^[A-Z][0-9]/[0-9-]+/[0-9]+$'", [c.shopId, d.id, fy]);
  return { code: d.code, name: d.name, fy, fyStartMonth: cfg.fyStartMonth, next: (Number(last?.n) || 0) + 1 };
}));
