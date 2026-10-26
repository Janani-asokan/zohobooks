import { Router } from 'express';
import { z } from 'zod';
import { rateLimit, todayISO, type UserCtx } from '../../auth';
import { audit } from '../../audit';
import { many, one, type Db } from '../../db';
import { badRequest, forbidden, HttpError, parse } from '../../http';
import { getOrg, primaryBranchId } from '../../services/common';
import { moveStock } from '../../services/stock';
import { parseTallyXml, tallyMasters, tallyVouchers } from '../../services/tally';
import { aiEnabled } from '../../services/extract';
import { aiError, mapColumns } from '../../services/assistant';
import { GSTIN_RE, INDIAN_STATES, stateFromCode } from '../../../../shared/gst';
import { IMPORT_FIELDS, cleanNumber, guessKind, guessMapping, type ImportKind } from '../../../../shared/columnMap';
import { insertCustomer } from './sales';
import { T, allowed } from './ctx';
import type { Request } from 'express';

/* Moving data in and out: Tally XML both ways, and lists from any other software with AI column mapping. */
export const dataRouter = Router();

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fileName = (s: string) => s.replace(/[^\w.-]+/g, '-').slice(0, 60);

dataRouter.get(
  '/tally/masters.xml',
  T(async (db, _req, c, res) => {
    if (!allowed(c, 'accounting.read') && !allowed(c, 'reports.read')) throw forbidden();
    const xml = await tallyMasters(db, c.shopId);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tally-masters-${fileName((await getOrg(db, c.shopId)).company_name)}.xml"`);
    res.send(xml);
  }),
);

dataRouter.get(
  '/tally/vouchers.xml',
  T(async (db, req, c, res) => {
    if (!allowed(c, 'accounting.read') && !allowed(c, 'reports.read')) throw forbidden();
    const from = ISO.test(String(req.query.from)) ? String(req.query.from) : todayISO().slice(0, 8) + '01';
    const to = ISO.test(String(req.query.to)) ? String(req.query.to) : todayISO();
    if (from > to) throw badRequest('The start date is after the end date');
    const { xml, counts } = await tallyVouchers(db, c.shopId, from, to);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('X-Voucher-Counts', JSON.stringify(counts));
    res.setHeader('Content-Disposition', `attachment; filename="tally-vouchers-${from}-to-${to}.xml"`);
    res.send(xml);
  }),
);

/* ---------- Import: shared row writer ---------- */
type Row = Record<string, string>;
interface ImportResult { created: number; skipped: number; errors: Array<{ row: number; error: string }>; warnings: string[] }

const PERM: Record<ImportKind, Parameters<typeof allowed>[1]> = { customers: 'customers.write', vendors: 'purchases.write', items: 'items.write' };

async function importRows(db: Db, req: Request, c: UserCtx, kind: ImportKind, rows: Row[]): Promise<ImportResult> {
  if (!allowed(c, PERM[kind])) throw forbidden(`Your role can’t add ${kind}`);
  const org = await getOrg(db, c.shopId);
  const out: ImportResult = { created: 0, skipped: 0, errors: [], warnings: [] };
  const stateOf = (s: string, gstin: string) => INDIAN_STATES.find((x) => x.toLowerCase() === s.trim().toLowerCase()) ?? (gstin ? stateFromCode(gstin.slice(0, 2)) : '') ?? '';

  if (kind === 'customers' || kind === 'vendors') {
    const table = kind === 'customers' ? 'customers' : 'vendors';
    const existing = await many(db, `SELECT lower(name) AS n, ${kind === 'customers' ? "lower(company_name) AS c," : ''} gstin FROM ${table} WHERE shop_id = $1`, [c.shopId]);
    const names = new Set(existing.flatMap((e) => [e.n, e.c].filter(Boolean)));
    const gstins = new Set(existing.map((e) => e.gstin).filter(Boolean));
    for (const [i, r] of rows.entries()) {
      const name = (r.name || r.company || '').trim().slice(0, 150);
      if (!name) { out.errors.push({ row: i + 2, error: 'No name' }); continue; }
      let gstin = (r.gstin ?? '').replace(/\s/g, '').toUpperCase();
      if (gstin && !GSTIN_RE.test(gstin)) { out.warnings.push(`${name}: “${gstin}” isn’t a valid GSTIN, imported without it`); gstin = ''; }
      if ((gstin && gstins.has(gstin)) || names.has(name.toLowerCase()) || (r.company && names.has(r.company.trim().toLowerCase()))) { out.skipped++; continue; }
      const phone = (r.phone ?? '').replace(/[^\d+]/g, '').slice(0, 20);
      const state = stateOf(r.state ?? '', gstin) || org.state;
      if (kind === 'customers') {
        const company = (r.company ?? '').trim();
        await insertCustomer(db, c.shopId, {
          type: gstin ? 'Business' : 'Individual', name: gstin && !company ? name : name, companyName: gstin ? company || name : '', gstin, email: (r.email ?? '').trim().slice(0, 120),
          phone, state, address: (r.address ?? '').trim().slice(0, 500), tier: 'SP1',
        }, org.state);
      } else {
        await db.query('INSERT INTO vendors (shop_id, name, gstin, phone, email, state) VALUES ($1,$2,$3,$4,$5,$6)', [c.shopId, name, gstin, phone, (r.email ?? '').trim().slice(0, 120), state]);
      }
      names.add(name.toLowerCase());
      if (gstin) gstins.add(gstin);
      out.created++;
    }
    const noPhone = kind === 'customers' ? rows.filter((r) => !(r.phone ?? '').replace(/\D/g, '')).length : 0;
    if (noPhone) out.warnings.push(`${noPhone} customer${noPhone === 1 ? ' has' : 's have'} no phone number; add one to send bills on WhatsApp`);
    return out;
  }

  // Items
  const slabs = await many(db, 'SELECT id, rate FROM tax_slabs WHERE active ORDER BY rate');
  const branchId = await primaryBranchId(db, c.shopId);
  const existing = await many(db, 'SELECT lower(name) AS n, lower(sku) AS s, barcode FROM items WHERE shop_id = $1 AND NOT archived', [c.shopId]);
  const seen = { n: new Set(existing.map((e) => e.n)), s: new Set(existing.map((e) => e.s).filter(Boolean)), b: new Set(existing.map((e) => e.barcode).filter(Boolean)) };
  let noRate = 0; let noPrice = 0;
  for (const [i, r] of rows.entries()) {
    const name = (r.name ?? '').trim().slice(0, 200);
    if (!name) { out.errors.push({ row: i + 2, error: 'No item name' }); continue; }
    const sku = (r.sku ?? '').trim().toUpperCase().slice(0, 60); const barcode = (r.barcode ?? '').replace(/\s/g, '').slice(0, 40);
    if (seen.n.has(name.toLowerCase()) || (sku && seen.s.has(sku.toLowerCase())) || (barcode && seen.b.has(barcode))) { out.skipped++; continue; }
    const cost = Math.max(0, cleanNumber(r.cost) || 0);
    let price = cleanNumber(r.sp1);
    if (!(price > 0)) { price = cost > 0 ? cost : 1; noPrice++; }
    const rate = cleanNumber(r.tax_rate);
    const slab = Number.isFinite(rate) ? slabs.reduce((a, b) => (Math.abs(Number(b.rate) - rate) < Math.abs(Number(a.rate) - rate) ? b : a)) : slabs.find((s) => Number(s.rate) === 18) ?? slabs.at(-1)!;
    if (!Number.isFinite(rate)) noRate++;
    const hsn = (r.hsn ?? '').replace(/\D/g, '').slice(0, 8);
    const type = hsn.startsWith('99') ? 'Services' : 'Goods';
    await db.query('SAVEPOINT row');
    try {
      const it = await one(db, `INSERT INTO items (shop_id, type, name, sku, barcode, unit, hsn, cost, sp1, sp2, sp3, tax_slab_id, reorder_level)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9,$10,$11) RETURNING id`,
        [c.shopId, type, name, sku, barcode, ((r.unit ?? '').trim().toLowerCase() || (type === 'Goods' ? 'pcs' : 'job')).slice(0, 12), hsn, cost, Math.round(price * 100) / 100, slab.id, Math.max(0, cleanNumber(r.reorder_level) || 10)]);
      const qty = cleanNumber(r.stock);
      if (type === 'Goods' && qty > 0) await moveStock(db, { shopId: c.shopId, itemId: it.id, branchId, qty, reason: 'opening', userId: c.id, note: 'Imported' });
      await db.query('RELEASE SAVEPOINT row');
      seen.n.add(name.toLowerCase()); if (sku) seen.s.add(sku.toLowerCase()); if (barcode) seen.b.add(barcode);
      out.created++;
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT row');
      out.errors.push({ row: i + 2, error: (e as { code?: string }).code === '23505' ? 'Duplicate barcode or SKU' : 'Could not save this item' });
    }
  }
  if (noPrice) out.warnings.push(`${noPrice} item${noPrice === 1 ? ' had' : 's had'} no selling price; set to cost (or ₹1). Update them before billing`);
  if (noRate) out.warnings.push(`${noRate} item${noRate === 1 ? ' had' : 's had'} no GST rate; set to 18%. Check them`);
  return out;
}

dataRouter.post(
  '/data-import',
  T(async (db, req, c) => {
    const b = parse(z.object({ kind: z.enum(['customers', 'vendors', 'items']), rows: z.array(z.record(z.string().max(1000))).min(1, 'The file has no rows').max(5000, 'Import up to 5,000 rows at a time') }), req.body);
    const r = await importRows(db, req, c, b.kind, b.rows);
    await audit(db, req, c.shopId, 'import', b.kind, '', { created: r.created, skipped: r.skipped, errors: r.errors.length });
    return r;
  }),
);

/** Suggests which file column is which field: AI when available, else header-name matching. */
dataRouter.post(
  '/data-import/map',
  rateLimit('ai-map', 20, 60_000),
  T(async (_db, req) => {
    const b = parse(z.object({ kind: z.enum(['customers', 'vendors', 'items']).nullable().default(null), headers: z.array(z.string().max(200)).min(1).max(80), sample: z.array(z.record(z.string().max(500))).max(10).default([]) }), req.body);
    const guessKindNow = b.kind ?? guessKind(b.headers);
    const offline = { kind: guessKindNow, mapping: guessMapping(guessKindNow, b.headers), note: null as string | null, method: 'names' as 'names' | 'ai' };
    if (!aiEnabled()) return offline;
    const fields = Object.fromEntries(Object.entries(IMPORT_FIELDS).map(([k, v]) => [k, v.map((f) => ({ key: f.key, label: f.label }))]));
    try {
      const ai = await mapColumns(b.kind, b.headers, b.sample, fields);
      return { ...ai, method: 'ai' as const };
    } catch (e) {
      try { aiError(e); } catch { /* fall back to name matching */ }
      return offline;
    }
  }),
);

/* ---------- Import from Tally XML ---------- */
const tallyBody = z.object({ xml: z.string().min(20).max(30_000_000), include: z.object({ customers: z.boolean(), vendors: z.boolean(), items: z.boolean() }).optional() });

dataRouter.post(
  '/tally/preview',
  T(async (_db, req) => {
    const { xml } = parse(tallyBody, req.body);
    let p;
    try { p = parseTallyXml(xml); } catch { throw new HttpError(400, 'This doesn’t look like a Tally XML export. In Tally: Export → Masters → format XML.', 'bad_xml'); }
    if (!p.customers.length && !p.vendors.length && !p.items.length) throw new HttpError(400, 'No customers, vendors or stock items found in this file. Export “All Masters” from Tally as XML.', 'empty');
    return { company: p.company, counts: { customers: p.customers.length, vendors: p.vendors.length, items: p.items.length, otherLedgers: p.other }, sample: { customers: p.customers.slice(0, 5), vendors: p.vendors.slice(0, 5), items: p.items.slice(0, 5) } };
  }),
);

dataRouter.post(
  '/tally/import',
  T(async (db, req, c) => {
    if (!allowed(c, 'customers.write') && !allowed(c, 'purchases.write') && !allowed(c, 'items.write')) throw forbidden();
    const b = parse(tallyBody, req.body);
    const p = parseTallyXml(b.xml);
    const inc = b.include ?? { customers: true, vendors: true, items: true };
    const res: Record<string, ImportResult> = {};
    if (inc.customers && p.customers.length && allowed(c, 'customers.write')) res.customers = await importRows(db, req, c, 'customers', p.customers.map((x) => ({ ...x, company: x.gstin ? x.name : '' }) as Row));
    if (inc.vendors && p.vendors.length && allowed(c, 'purchases.write')) res.vendors = await importRows(db, req, c, 'vendors', p.vendors as unknown as Row[]);
    if (inc.items && p.items.length && allowed(c, 'items.write'))
      res.items = await importRows(db, req, c, 'items', p.items.map((x) => ({ name: x.name, unit: x.unit, hsn: x.hsn, tax_rate: x.taxRate === null ? '' : String(x.taxRate), cost: x.cost === null ? '' : String(x.cost), sp1: x.price === null ? '' : String(x.price), stock: String(x.openingQty) })));
    await audit(db, req, c.shopId, 'import', 'tally', '', Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.created])));
    return res;
  }),
);
