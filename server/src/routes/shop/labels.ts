/**
 * Barcode & Labels module API (spec appendix A, adapted to Corpus360's /api/shop conventions).
 * Stocks, printer profiles, templates (draft + immutable published versions), print sources, print jobs with an
 * idempotency key, progress, resume and reprint, and barcode coverage with bulk generation.
 * Roles (spec 2.4): anyone who can see items prints, reprints, edits quantities and calibrates; items.write manages
 * barcodes, templates, stock and printers; admin changes the generator and GS1 prefix.
 */
import { Router } from 'express';
import { z } from 'zod';
import { perm } from '../../auth';
import { audit } from '../../audit';
import { many, one, type Db } from '../../db';
import { badRequest, notFound, parse } from '../../http';
import { allowed, T } from './ctx';
import { barcodeKey, DEFAULT_GENERATOR, isGs1Prefix, nextCode, type GeneratorSettings } from '../../../../shared/barcode';
import {
  JOB_MAX, LABEL_FIELDS, jobBlocked, validateJob, type JobLine, type LabelData, type LabelTemplateBody, type PrinterSettings, type StockGeometry,
} from '../../../../shared/labelEngine';

export const labelsRouter = Router();
/** The same JSON whatever the key order (jsonb stores keys in its own order). */
const canon = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const uuid = z.string().uuid();
const mm = (min: number, max: number) => z.number().finite().min(min).max(max);

/* ---------- Schemas ---------- */
const geometrySchema = z.object({
  w: mm(10, 200), h: mm(8, 300), across: z.number().int().min(1).max(8), gutter: mm(0, 30), marginL: mm(0, 40), marginR: mm(0, 40), rowGap: mm(0, 20),
  media: z.enum(['die-cut', 'black-mark', 'continuous']), sheet: z.enum(['roll', 'a4', 'letter']), rows: z.number().int().min(0).max(60), marginTop: mm(0, 60), safeInset: mm(0, 5),
});
const printerSchema = z.object({
  language: z.enum(['browser', 'tspl', 'zpl', 'escpos']), dpi: z.union([z.literal(203), z.literal(300), z.literal(600)]), headMm: mm(20, 220),
  media: z.enum(['die-cut', 'black-mark', 'continuous']), offsetX: mm(-20, 20), offsetY: mm(-20, 20), darkness: z.number().int().min(0).max(15), speed: z.number().min(1).max(14),
});
const elementSchema = z.object({
  id: z.string().min(1).max(40), type: z.enum(['barcode', 'qr', 'field', 'text', 'line', 'box']),
  x: mm(-1, 300), y: mm(-1, 300), w: mm(0, 300), h: mm(0, 300),
  field: z.enum(LABEL_FIELDS).optional(), text: z.string().max(120).optional(), size: mm(0.8, 30).optional(), bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(), maxLines: z.number().int().min(1).max(6).optional(), overflow: z.enum(['shrink', 'truncate']).optional(),
  minSize: mm(0.8, 30).optional(), symbology: z.enum(['auto', 'CODE128', 'EAN13', 'EAN8', 'UPC', 'QR']).optional(), showValue: z.boolean().optional(), stroke: mm(0.1, 5).optional(),
});
const bodySchema = z.object({ w: mm(10, 200), h: mm(8, 300), elements: z.array(elementSchema).max(40) });

const serializeTemplate = (t: any) => ({
  id: t.id, name: t.name, draft: t.draft, version: t.current_version, isDefault: t.is_default, categories: t.categories ?? [],
  published: t.published ?? null, updatedAt: t.updated_at, dirty: t.published ? !same(t.published, t.draft) : true,
});
const serializeJob = (j: any) => ({
  id: j.id, source: { type: j.source_type, id: j.source_id, label: j.source_label }, templateId: j.template_id, templateVersion: j.template_version,
  templateName: j.template_name ?? null, template: j.template_body, stock: j.stock, printerId: j.printer_id, printerName: j.printer_name ?? null, printer: j.printer,
  options: j.options, status: j.status, total: j.total_count, sent: j.sent_count, printed: j.printed_count, createdBy: j.created_by_name ?? null, createdAt: j.created_at, updatedAt: j.updated_at,
});

/* ---------- Everything the hub needs, in one call ---------- */
labelsRouter.get('/label/setup', T(async (db, _req, c) => {
  const [stocks, printers, templates, org] = await Promise.all([
    many(db, 'SELECT * FROM label_stocks WHERE shop_id = $1 ORDER BY name', [c.shopId]),
    many(db, 'SELECT p.*, b.name AS branch_name FROM printer_profiles p LEFT JOIN branches b ON b.id = p.branch_id WHERE p.shop_id = $1 ORDER BY p.name', [c.shopId]),
    many(db, `SELECT t.*, (SELECT v.body FROM label_template_versions v WHERE v.template_id = t.id AND v.version = t.current_version) AS published
                FROM label_templates t WHERE t.shop_id = $1 AND NOT t.archived ORDER BY t.is_default DESC, t.name`, [c.shopId]),
    one(db, 'SELECT label_settings FROM organizations WHERE shop_id = $1', [c.shopId]),
  ]);
  const ls = org?.label_settings ?? {};
  return {
    stocks: stocks.map((s) => ({ id: s.id, name: s.name, geometry: s.geometry })),
    printers: printers.map((p) => ({ id: p.id, name: p.name, settings: p.settings, branchId: p.branch_id, branchName: p.branch_name ?? null, canRestore: !!p.last_good })),
    templates: templates.map(serializeTemplate),
    generator: { ...DEFAULT_GENERATOR, ...(ls.generator ?? {}) } as GeneratorSettings,
    can: { manage: allowed(c, 'items.write'), admin: allowed(c, 'admin') },
  };
}));

/* ---------- Stock profiles ---------- */
labelsRouter.post('/label/stocks', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), geometry: geometrySchema }), req.body);
  const s = await one(db, 'INSERT INTO label_stocks (shop_id, name, geometry) VALUES ($1,$2,$3) RETURNING *', [c.shopId, b.name, JSON.stringify(b.geometry)]);
  await audit(db, req, c.shopId, 'create', 'label_stock', s.id, { name: b.name });
  return { id: s.id, name: s.name, geometry: s.geometry };
}));
labelsRouter.put('/label/stocks/:id', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), geometry: geometrySchema }), req.body);
  const s = await one(db, 'UPDATE label_stocks SET name = $3, geometry = $4, updated_at = now() WHERE shop_id = $1 AND id = $2 RETURNING *', [c.shopId, req.params.id, b.name, JSON.stringify(b.geometry)]);
  if (!s) throw notFound('Label stock');
  return { id: s.id, name: s.name, geometry: s.geometry };
}));
labelsRouter.delete('/label/stocks/:id', perm('items.write'), T(async (db, req, c) => {
  await db.query('DELETE FROM label_stocks WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
  return { ok: true };
}));

/* ---------- Printer profiles ---------- */
labelsRouter.post('/label/printers', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), settings: printerSchema, branchId: uuid.nullable().optional() }), req.body);
  const p = await one(db, 'INSERT INTO printer_profiles (shop_id, name, settings, branch_id) VALUES ($1,$2,$3,$4) RETURNING *', [c.shopId, b.name, JSON.stringify(b.settings), b.branchId ?? null]);
  await audit(db, req, c.shopId, 'create', 'printer_profile', p.id, { name: b.name });
  return { id: p.id, name: p.name, settings: p.settings, branchId: p.branch_id, canRestore: false };
}));
labelsRouter.put('/label/printers/:id', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), settings: printerSchema, branchId: uuid.nullable().optional() }), req.body);
  const p = await one(db, 'UPDATE printer_profiles SET name = $3, last_good = settings, settings = $4, branch_id = $5, updated_at = now() WHERE shop_id = $1 AND id = $2 RETURNING *', [c.shopId, req.params.id, b.name, JSON.stringify(b.settings), b.branchId ?? null]);
  if (!p) throw notFound('Printer');
  return { id: p.id, name: p.name, settings: p.settings, branchId: p.branch_id, canRestore: !!p.last_good };
}));
/** Calibration (TP-12): offsets, darkness and speed. Store operators may calibrate (spec 2.4). */
labelsRouter.put('/label/printers/:id/calibrate', T(async (db, req, c) => {
  const b = parse(printerSchema.pick({ offsetX: true, offsetY: true, darkness: true, speed: true }), req.body);
  const cur = await one(db, 'SELECT settings FROM printer_profiles WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
  if (!cur) throw notFound('Printer');
  const settings = { ...cur.settings, ...b };
  const p = await one(db, 'UPDATE printer_profiles SET last_good = settings, settings = $3, updated_at = now() WHERE shop_id = $1 AND id = $2 RETURNING *', [c.shopId, req.params.id, JSON.stringify(settings)]);
  await audit(db, req, c.shopId, 'calibrate', 'printer_profile', p.id, b);
  return { id: p.id, name: p.name, settings: p.settings, branchId: p.branch_id, canRestore: true };
}));
/** Back to the settings before the last change (TP-13). */
labelsRouter.post('/label/printers/:id/restore', T(async (db, req, c) => {
  const p = await one(db, 'UPDATE printer_profiles SET settings = last_good, last_good = settings, updated_at = now() WHERE shop_id = $1 AND id = $2 AND last_good IS NOT NULL RETURNING *', [c.shopId, req.params.id]);
  if (!p) throw badRequest('Nothing to restore');
  return { id: p.id, name: p.name, settings: p.settings, branchId: p.branch_id, canRestore: true };
}));
labelsRouter.delete('/label/printers/:id', perm('items.write'), T(async (db, req, c) => {
  await db.query('DELETE FROM printer_profiles WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
  return { ok: true };
}));

/* ---------- Templates ---------- */
const getTemplate = async (db: Db, shopId: string, id: string) => {
  const t = await one(db, `SELECT t.*, (SELECT v.body FROM label_template_versions v WHERE v.template_id = t.id AND v.version = t.current_version) AS published
                              FROM label_templates t WHERE t.shop_id = $1 AND t.id = $2 AND NOT t.archived`, [shopId, id]);
  if (!t) throw notFound('Template');
  return t;
};
labelsRouter.post('/label/templates', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), draft: bodySchema }), req.body);
  const t = await one(db, 'INSERT INTO label_templates (shop_id, name, draft, created_by) VALUES ($1,$2,$3,$4) RETURNING *', [c.shopId, b.name, JSON.stringify(b.draft), c.id]);
  await audit(db, req, c.shopId, 'create', 'label_template', t.id, { name: b.name });
  return serializeTemplate(t);
}));
labelsRouter.put('/label/templates/:id', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), draft: bodySchema }), req.body);
  await getTemplate(db, c.shopId, req.params.id!);
  await db.query('UPDATE label_templates SET name = $3, draft = $4, updated_at = now() WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id, b.name, JSON.stringify(b.draft)]);
  return serializeTemplate(await getTemplate(db, c.shopId, req.params.id!));
}));
/** Publish: the draft becomes a new immutable version (BL-13). */
labelsRouter.post('/label/templates/:id/publish', perm('items.write'), T(async (db, req, c) => {
  const t = await getTemplate(db, c.shopId, req.params.id!);
  const v = t.current_version + 1;
  await db.query('INSERT INTO label_template_versions (shop_id, template_id, version, body, published_by) VALUES ($1,$2,$3,$4,$5)', [c.shopId, t.id, v, JSON.stringify(t.draft), c.id]);
  await db.query('UPDATE label_templates SET current_version = $3, updated_at = now() WHERE shop_id = $1 AND id = $2', [c.shopId, t.id, v]);
  await audit(db, req, c.shopId, 'publish', 'label_template', t.id, { name: t.name, version: v });
  return serializeTemplate(await getTemplate(db, c.shopId, t.id));
}));
labelsRouter.post('/label/templates/:id/clone', perm('items.write'), T(async (db, req, c) => {
  const t = await getTemplate(db, c.shopId, req.params.id!);
  const n = await one(db, 'INSERT INTO label_templates (shop_id, name, draft, created_by) VALUES ($1,$2,$3,$4) RETURNING *', [c.shopId, `${t.name} (copy)`.slice(0, 80), JSON.stringify(t.draft), c.id]);
  return serializeTemplate(n);
}));
/** Defaults (BL-14): the shop's default, and per category (most specific wins). */
labelsRouter.put('/label/templates/:id/default', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ isDefault: z.boolean(), categories: z.array(z.string().trim().min(1).max(60)).max(50).default([]) }), req.body);
  const t = await getTemplate(db, c.shopId, req.params.id!);
  if (!t.current_version) throw badRequest('Publish the template before making it a default');
  if (b.isDefault) await db.query('UPDATE label_templates SET is_default = false WHERE shop_id = $1 AND id <> $2', [c.shopId, t.id]);
  // A category has one default template.
  if (b.categories.length) await db.query('UPDATE label_templates SET categories = array(SELECT x FROM unnest(categories) x WHERE NOT x = ANY($3)) WHERE shop_id = $1 AND id <> $2', [c.shopId, t.id, b.categories]);
  await db.query('UPDATE label_templates SET is_default = $3, categories = $4, updated_at = now() WHERE shop_id = $1 AND id = $2', [c.shopId, t.id, b.isDefault, b.categories]);
  return serializeTemplate(await getTemplate(db, c.shopId, t.id));
}));
labelsRouter.delete('/label/templates/:id', perm('items.write'), T(async (db, req, c) => {
  await db.query('UPDATE label_templates SET archived = true, is_default = false, categories = $3 WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id, []]);
  return { ok: true };
}));
labelsRouter.get('/label/templates/:id/versions', T(async (db, req, c) => {
  await getTemplate(db, c.shopId, req.params.id!);
  return (await many(db, `SELECT v.version, v.published_at, u.name AS by FROM label_template_versions v LEFT JOIN users u ON u.id = v.published_by
                             WHERE v.shop_id = $1 AND v.template_id = $2 ORDER BY v.version DESC`, [c.shopId, req.params.id])).map((v) => ({ version: v.version, publishedAt: v.published_at, by: v.by }));
}));

/* ---------- Print sources (spec 3.1): lines with default quantities, and labels already printed (BP-07) ---------- */
const printedFor = async (db: Db, shopId: string, type: string, id: string) => {
  const rows = await many(db, `SELECT l.item_id, sum(CASE WHEN j.status = 'printed' THEN l.quantity ELSE least(l.quantity, greatest(0, j.printed_count)) END)::int AS n
                                 FROM print_job_lines l JOIN print_jobs j ON j.id = l.job_id
                                WHERE l.shop_id = $1 AND j.source_type = $2 AND j.source_id = $3 AND j.status IN ('printed', 'partial', 'sent')
                                GROUP BY l.item_id`, [shopId, type, id]);
  return new Map(rows.map((r) => [r.item_id as string, Number(r.n)]));
};
labelsRouter.get('/label/sources/:type/:id', T(async (db, req, c) => {
  const type = parse(z.enum(['purchase_order', 'bill']), req.params.type);
  const id = parse(uuid, req.params.id);
  const doc = type === 'purchase_order'
    ? await one(db, 'SELECT id, number, lines FROM purchase_orders WHERE shop_id = $1 AND id = $2', [c.shopId, id])
    : await one(db, 'SELECT id, number, vendor_bill_no, lines FROM bills WHERE shop_id = $1 AND id = $2', [c.shopId, id]);
  if (!doc) throw notFound(type === 'bill' ? 'Bill' : 'Purchase order');
  const printed = await printedFor(db, c.shopId, type, id);
  const lines = (doc.lines ?? []).filter((l: any) => l.itemId);
  return {
    source: { type, id, label: `${type === 'bill' ? 'Bill' : 'PO'} ${doc.number}${doc.vendor_bill_no ? ` (${doc.vendor_bill_no})` : ''}` },
    lines: lines.map((l: any) => {
      const ordered = Math.round(Number(l.qty) || 0);
      const received = Math.round(Number(l.received ?? (type === 'bill' ? l.qty : 0)) || 0);
      const done = printed.get(l.itemId) ?? 0;
      // PO: ordered quantity not yet labelled; bill: what arrived (spec 3.1).
      const qty = type === 'bill' ? received : Math.max(0, ordered - done);
      return { itemId: l.itemId, name: l.name, ordered, received, printed: done, qty };
    }),
  };
}));
/** Batches in stock (spec 3.1), with expiry, for pharmacy-style labels. */
labelsRouter.get('/label/batches', T(async (db, req, c) => {
  const q = parse(z.object({ itemId: uuid.optional(), expiresBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
  const rows = await many(db, `SELECT b.item_id, i.name, b.batch_no, b.expiry_date, sum(b.qty)::numeric AS qty, string_agg(DISTINCT br.name, ', ') AS location
                                 FROM item_batches b JOIN items i ON i.id = b.item_id JOIN branches br ON br.id = b.branch_id
                                WHERE b.shop_id = $1 AND b.qty > 0 AND NOT i.archived ${q.itemId ? 'AND b.item_id = $2' : ''} ${q.expiresBefore ? `AND b.expiry_date <= $${q.itemId ? 3 : 2}` : ''}
                                GROUP BY b.item_id, i.name, b.batch_no, b.expiry_date ORDER BY b.expiry_date NULLS LAST, i.name LIMIT 2000`,
    [c.shopId, ...(q.itemId ? [q.itemId] : []), ...(q.expiresBefore ? [q.expiresBefore] : [])]);
  return rows.map((r) => ({ itemId: r.item_id, name: r.name, batch: r.batch_no, expiry: r.expiry_date ? new Date(r.expiry_date).toISOString().slice(0, 10) : '', qty: Math.max(0, Math.floor(Number(r.qty))), location: r.location ?? '' }));
}));

/* ---------- Print jobs (spec 3.4) ---------- */
const jobLineInput = z.object({ itemId: uuid.nullable(), batch: z.string().max(60).default(''), qty: z.number().int().min(0).max(JOB_MAX), expiry: z.string().max(10).optional(), location: z.string().max(120).optional() });
const jobInput = z.object({
  idemKey: z.string().min(8).max(80),
  source: z.object({ type: z.enum(['items', 'batches', 'purchase_order', 'bill', 'csv', 'scan', 'reprint']), id: uuid.nullable().optional(), label: z.string().max(120).default('') }),
  templateId: uuid.nullable().optional(), template: bodySchema,
  stock: geometrySchema, printerId: uuid.nullable().optional(), printer: printerSchema,
  options: z.record(z.string(), z.unknown()).default({}),
  lines: z.array(jobLineInput).min(1).max(5000),
});
/** What each label prints, read from the database at print time (not from the browser), for exact reprints. */
async function snapshots(db: Db, shopId: string, lines: Array<{ itemId: string | null; batch: string; expiry?: string; location?: string }>): Promise<LabelData[]> {
  const ids = [...new Set(lines.map((l) => l.itemId).filter(Boolean))] as string[];
  const [items, org, batches] = await Promise.all([
    ids.length ? many(db, 'SELECT id, name, sku, barcode, sp1, mrp, unit, brand, category FROM items WHERE shop_id = $1 AND id = ANY($2::uuid[])', [shopId, ids]) : Promise.resolve([]),
    one(db, 'SELECT company_name FROM organizations WHERE shop_id = $1', [shopId]),
    ids.length ? many(db, 'SELECT item_id, batch_no, min(expiry_date) AS expiry FROM item_batches WHERE shop_id = $1 AND item_id = ANY($2::uuid[]) GROUP BY item_id, batch_no', [shopId, ids]) : Promise.resolve([]),
  ]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const exp = new Map(batches.map((b) => [`${b.item_id}|${b.batch_no}`, b.expiry ? new Date(b.expiry).toISOString().slice(0, 10) : '']));
  return lines.map((l) => {
    const it = l.itemId ? byId.get(l.itemId) : null;
    if (l.itemId && !it) throw badRequest('One of the items no longer exists. Reload the list.');
    return {
      name: it?.name ?? '', sku: it?.sku ?? '', barcode: it?.barcode ?? '', price: it ? Number(it.sp1) : null, mrp: it?.mrp != null ? Number(it.mrp) : null,
      batch: l.batch, expiry: l.expiry || exp.get(`${l.itemId}|${l.batch}`) || '', unit: it?.unit ?? '', brand: it?.brand ?? '', category: it?.category ?? '',
      location: l.location ?? '', company: org?.company_name ?? '',
    };
  });
}
async function createJob(db: Db, shopId: string, userId: string, b: z.infer<typeof jobInput>, data: LabelData[], templateVersion: number) {
  const total = b.lines.reduce((s, l) => s + l.qty, 0);
  const j = await one(db, `INSERT INTO print_jobs (shop_id, idem_key, source_type, source_id, source_label, template_id, template_version, template_body, stock, printer_id, printer, options, total_count, created_by)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [shopId, b.idemKey, b.source.type, b.source.id ?? null, b.source.label, b.templateId ?? null, templateVersion, JSON.stringify(b.template), JSON.stringify(b.stock), b.printerId ?? null, JSON.stringify(b.printer), JSON.stringify(b.options), total, userId]);
  let pos = 0;
  for (const [i, l] of b.lines.entries()) {
    await db.query('INSERT INTO print_job_lines (shop_id, job_id, position, item_id, batch_no, quantity, snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7)', [shopId, j.id, pos++, l.itemId, l.batch, l.qty, JSON.stringify(data[i])]);
  }
  return j;
}
const jobById = async (db: Db, shopId: string, id: string) => {
  const j = await one(db, `SELECT j.*, t.name AS template_name, p.name AS printer_name, u.name AS created_by_name FROM print_jobs j
                             LEFT JOIN label_templates t ON t.id = j.template_id LEFT JOIN printer_profiles p ON p.id = j.printer_id LEFT JOIN users u ON u.id = j.created_by
                            WHERE j.shop_id = $1 AND j.id = $2`, [shopId, id]);
  if (!j) throw notFound('Print job');
  const lines = await many(db, 'SELECT * FROM print_job_lines WHERE shop_id = $1 AND job_id = $2 ORDER BY position', [shopId, id]);
  return { ...serializeJob(j), lines: lines.map((l) => ({ itemId: l.item_id, batch: l.batch_no, qty: l.quantity, data: l.snapshot as LabelData })) };
};

/** Pre-print checks on the server too (spec 3.3, appendix A), from the database's data. */
labelsRouter.post('/label/jobs/validate', T(async (db, req, c) => {
  const b = parse(jobInput.omit({ idemKey: true }), req.body);
  const data = await snapshots(db, c.shopId, b.lines);
  const lines: JobLine[] = b.lines.map((l, i) => ({ key: String(i), itemId: l.itemId, batch: l.batch, qty: l.qty, data: data[i]!, expiry: data[i]!.expiry }));
  return { issues: validateJob(lines, b.template as LabelTemplateBody, b.stock as StockGeometry, b.printer as PrinterSettings) };
}));
/** Create a job. The same idempotency key returns the job already made (BP-11, QA-R02). */
labelsRouter.post('/label/jobs', T(async (db, req, c) => {
  const b = parse(jobInput, req.body);
  const existing = await one(db, 'SELECT id FROM print_jobs WHERE shop_id = $1 AND idem_key = $2', [c.shopId, b.idemKey]);
  if (existing) return jobById(db, c.shopId, existing.id);
  const total = b.lines.reduce((s, l) => s + l.qty, 0);
  if (total < 1) throw badRequest('Nothing to print: every line is 0');
  if (total > JOB_MAX) throw badRequest(`${total} labels is more than ${JOB_MAX} in one job. Split it.`);
  let version = 0;
  if (b.templateId) {
    const t = await getTemplate(db, c.shopId, b.templateId);
    version = t.current_version;
    // A job uses the published version exactly (BL-13); an unpublished template prints as its draft, version 0.
    if (!same(t.published, b.template) && !same(t.draft, b.template)) throw badRequest('The template changed. Reload and try again.');
    if (!t.published || !same(t.published, b.template)) version = 0;
  }
  const data = await snapshots(db, c.shopId, b.lines);
  const lines: JobLine[] = b.lines.map((l, i) => ({ key: String(i), itemId: l.itemId, batch: l.batch, qty: l.qty, data: data[i]!, expiry: data[i]!.expiry }));
  const issues = validateJob(lines, b.template as LabelTemplateBody, b.stock as StockGeometry, b.printer as PrinterSettings);
  if (jobBlocked(issues)) throw badRequest(issues.find((x) => x.severity === 'blocker' && x.scope === 'job')!.message);
  const j = await createJob(db, c.shopId, c.id, b, data, version);
  await audit(db, req, c.shopId, 'create', 'print_job', j.id, { source: b.source.type, label: b.source.label, labels: total, template: b.templateId ?? 'auto', version });
  return jobById(db, c.shopId, j.id);
}));
labelsRouter.get('/label/jobs', T(async (db, req, c) => {
  const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
  return (await many(db, `SELECT j.*, t.name AS template_name, p.name AS printer_name, u.name AS created_by_name FROM print_jobs j
                            LEFT JOIN label_templates t ON t.id = j.template_id LEFT JOIN printer_profiles p ON p.id = j.printer_id LEFT JOIN users u ON u.id = j.created_by
                           WHERE j.shop_id = $1 ORDER BY j.created_at DESC LIMIT $2`, [c.shopId, q.limit])).map(serializeJob);
}));
labelsRouter.get('/label/jobs/:id', T(async (db, req, c) => jobById(db, c.shopId, parse(uuid, req.params.id))));
/** Progress (BP-09, spec 6.6): labels sent to the printer, labels the user confirms printed, or failed. */
labelsRouter.post('/label/jobs/:id/progress', T(async (db, req, c) => {
  const b = parse(z.object({ sent: z.number().int().min(0).optional(), printed: z.number().int().min(0).optional(), status: z.enum(['sending', 'sent', 'printed', 'partial', 'failed']).optional() }), req.body);
  const j = await one(db, 'SELECT * FROM print_jobs WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
  if (!j) throw notFound('Print job');
  const sent = Math.min(j.total_count, Math.max(j.sent_count, b.sent ?? 0));
  const printed = Math.min(j.total_count, b.printed ?? j.printed_count);
  const status = b.status ?? (printed >= j.total_count ? 'printed' : printed > 0 ? 'partial' : sent > 0 ? 'sent' : j.status);
  await db.query('UPDATE print_jobs SET sent_count = $3, printed_count = $4, status = $5, updated_at = now() WHERE shop_id = $1 AND id = $2', [c.shopId, j.id, sent, printed, status]);
  if (status !== j.status && ['printed', 'partial', 'failed'].includes(status)) await audit(db, req, c.shopId, status, 'print_job', j.id, { printed, total: j.total_count });
  return jobById(db, c.shopId, j.id);
}));
/** Reprint (BP-12): the stored snapshot by default, or fresh names and prices. Makes a new job. */
labelsRouter.post('/label/jobs/:id/reprint', T(async (db, req, c) => {
  const b = parse(z.object({ idemKey: z.string().min(8).max(80), fresh: z.boolean().default(false) }), req.body);
  const dup = await one(db, 'SELECT id FROM print_jobs WHERE shop_id = $1 AND idem_key = $2', [c.shopId, b.idemKey]);
  if (dup) return jobById(db, c.shopId, dup.id);
  const src = await jobById(db, c.shopId, parse(uuid, req.params.id));
  const input = {
    idemKey: b.idemKey, source: { type: 'reprint' as const, id: src.id, label: `Reprint of ${src.source.label || 'job'}` }, templateId: src.templateId, template: src.template,
    stock: src.stock, printerId: src.printerId, printer: src.printer, options: { ...src.options, from: 1 }, lines: src.lines.map((l) => ({ itemId: l.itemId, batch: l.batch, qty: l.qty })),
  };
  const data = b.fresh ? await snapshots(db, c.shopId, src.lines.map((l) => ({ itemId: l.itemId, batch: l.batch, expiry: l.data.expiry, location: l.data.location }))) : src.lines.map((l) => l.data);
  const j = await createJob(db, c.shopId, c.id, input, data, src.templateVersion);
  await audit(db, req, c.shopId, 'reprint', 'print_job', j.id, { from: src.id, fresh: b.fresh });
  return jobById(db, c.shopId, j.id);
}));

/* ---------- Barcodes (spec 2.2) ---------- */
labelsRouter.get('/label/barcodes', T(async (db, _req, c) => {
  const items = await many(db, `SELECT i.id, i.name, i.sku, i.barcode, i.category, i.type,
                                       coalesce((SELECT array_agg(b.value ORDER BY b.created_at) FROM item_barcodes b WHERE b.item_id = i.id AND b.status = 'alias'), '{}') AS aliases
                                  FROM items i WHERE i.shop_id = $1 AND NOT i.archived AND NOT i.is_group ORDER BY i.name`, [c.shopId]);
  // Duplicates by how scanners read them (leading zeros, case): two items that the same scan could mean.
  const byKey = new Map<string, string[]>();
  for (const i of items) for (const v of [i.barcode, ...(i.aliases ?? [])]) { const k = barcodeKey(v); if (k) byKey.set(k, [...(byKey.get(k) ?? []), i.id]); }
  const dup = new Set([...byKey.values()].filter((ids) => new Set(ids).size > 1).flat());
  const goods = items.filter((i) => i.type === 'Goods');
  return {
    total: goods.length, withBarcode: goods.filter((i) => i.barcode).length, missing: goods.filter((i) => !i.barcode).length, duplicates: dup.size,
    items: items.map((i) => ({ id: i.id, name: i.name, sku: i.sku, barcode: i.barcode, category: i.category, type: i.type, aliases: i.aliases ?? [], duplicate: dup.has(i.id) })),
  };
}));
/** Bulk generation (BL-02): fills missing barcodes only, unless overwrite is chosen (old values stay as aliases). */
labelsRouter.post('/label/barcodes/bulk-generate', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ ids: z.array(uuid).max(10000).optional(), overwrite: z.boolean().default(false) }), req.body ?? {});
  const org = await one(db, 'SELECT label_settings FROM organizations WHERE shop_id = $1 FOR UPDATE', [c.shopId]);
  const gen: GeneratorSettings = { ...DEFAULT_GENERATOR, ...(org?.label_settings?.generator ?? {}) };
  const all = await many(db, 'SELECT id, sku, barcode, type, is_group, archived FROM items WHERE shop_id = $1 FOR UPDATE', [c.shopId]);
  const aliases = await many(db, 'SELECT value FROM item_barcodes WHERE shop_id = $1', [c.shopId]);
  const taken = new Set([...all.map((i) => barcodeKey(i.barcode)), ...aliases.map((a) => barcodeKey(a.value))].filter(Boolean));
  const want = all.filter((i) => i.type === 'Goods' && !i.is_group && !i.archived && (b.overwrite || !i.barcode) && (!b.ids || b.ids.includes(i.id)));
  const state = { next: gen.next };
  const done: Array<{ id: string; barcode: string }> = []; const conflicts: Array<{ id: string; error: string }> = [];
  for (const it of want) {
    try {
      const code = nextCode(gen, it, taken, state);
      await db.query(`UPDATE items SET barcode = $3 WHERE shop_id = $1 AND id = $2 ${b.overwrite ? '' : "AND barcode = ''"}`, [c.shopId, it.id, code]);
      done.push({ id: it.id, barcode: code });
    } catch (e) { conflicts.push({ id: it.id, error: (e as Error).message }); if (/prefix|left/.test((e as Error).message)) break; }
  }
  if (state.next !== gen.next) await db.query("UPDATE organizations SET label_settings = jsonb_set(label_settings, '{generator}', $2::jsonb) WHERE shop_id = $1", [c.shopId, JSON.stringify({ ...gen, next: state.next })]);
  if (done.length) await audit(db, req, c.shopId, 'generate_barcodes', 'item', '', { count: done.length, mode: gen.mode, overwrite: b.overwrite });
  return { generated: done.length, items: done, conflicts };
}));
/** Replace one item's barcode: the old one stays as an alias (BL-06). */
labelsRouter.post('/label/barcodes/:itemId/replace', perm('items.write'), T(async (db, req, c) => {
  const b = parse(z.object({ value: z.string().trim().min(1).max(60).regex(/^[\x21-\x7e]+$/, 'Use English letters, digits and - . / in a barcode') }), req.body);
  const it = await one(db, 'UPDATE items SET barcode = $3 WHERE shop_id = $1 AND id = $2 AND NOT archived RETURNING id, barcode', [c.shopId, req.params.itemId, b.value]);
  if (!it) throw notFound('Item');
  await audit(db, req, c.shopId, 'replace_barcode', 'item', it.id, { value: b.value });
  return { id: it.id, barcode: it.barcode };
}));
/** Remove an alias (an old barcode that should no longer scan). */
labelsRouter.delete('/label/barcodes/:itemId/aliases/:value', perm('items.write'), T(async (db, req, c) => {
  await db.query("DELETE FROM item_barcodes WHERE shop_id = $1 AND item_id = $2 AND value = $3 AND status = 'alias'", [c.shopId, req.params.itemId, req.params.value]);
  return { ok: true };
}));
/** Generator and GS1 prefix: admin only (spec 2.4). */
labelsRouter.put('/label/generator', perm('admin'), T(async (db, req, c) => {
  const b = parse(z.object({
    mode: z.enum(['shop-ean', 'sku', 'series', 'gs1']), prefix: z.string().max(10).regex(/^[\x21-\x7e]*$/, 'Use English letters and digits in the prefix').default(''),
    next: z.number().int().min(0).max(1e9), digits: z.number().int().min(3).max(10), gs1Prefix: z.string().trim().max(11).default(''),
  }).refine((g) => g.mode !== 'gs1' || isGs1Prefix(g.gs1Prefix), { message: 'Enter your GS1 company prefix: 6 to 11 digits from GS1 India', path: ['gs1Prefix'] }), req.body);
  await db.query("UPDATE organizations SET label_settings = jsonb_set(label_settings, '{generator}', $2::jsonb) WHERE shop_id = $1", [c.shopId, JSON.stringify(b)]);
  await audit(db, req, c.shopId, 'update', 'barcode_generator', c.shopId, { mode: b.mode });
  return b;
}));
