import { Router } from 'express';
import { z } from 'zod';
import { perm, todayISO, userCtx } from '../../auth';
import { audit } from '../../audit';
import { many, one, withTenant } from '../../db';
import { badRequest, h, HttpError, notFound, parse } from '../../http';
import { nextSeq, platformConfig } from '../../services/common';
import { accountsWithBalances, balanceSheet, cashFlow, chartOfAccounts, fyStartFor, generalLedger, profitAndLoss, trialBalance } from '../../services/ledger';
import { htmlPdf } from '../../services/pdf';
import crypto from 'node:crypto';
import { config } from '../../config';
import { query } from '../../db';
import { sendMail } from '../../mailer';
import { toCsv } from '../../../../shared/csv';
import { buildXlsx } from '../../../../shared/xlsx';
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES } from '../../../../shared/accounting';
import { r2 } from '../../../../shared/calc';
import { T } from './ctx';

export const accountingRouter = Router();

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = z.string().regex(ISO, 'Choose a date');

/** from/to (or asOf) from the query string, defaulting to the current financial year to date. */
async function range(db: Parameters<typeof platformConfig>[0], q: Record<string, unknown>) {
  const cfg = await platformConfig(db);
  const to = ISO.test(String(q.to ?? q.asOf ?? '')) ? String(q.to ?? q.asOf) : todayISO();
  const from = ISO.test(String(q.from ?? '')) ? String(q.from) : fyStartFor(to, cfg.fyStartMonth);
  if (from > to) throw badRequest('The start date is after the end date');
  return { from, to, fyStartMonth: cfg.fyStartMonth };
}

/* ======================= Chart of accounts ======================= */

accountingRouter.get(
  '/accounting/accounts',
  perm('accounting.read'),
  T(async (db, req, c) => {
    const { to } = await range(db, req.query);
    return accountsWithBalances(db, c.shopId, to);
  }),
);

const accountBody = z.object({
  code: z.string().trim().max(10).default(''),
  name: z.string().trim().min(1, 'Give the account a name').max(80),
  type: z.enum(ACCOUNT_TYPES),
  subtype: z.string().max(20).default(''),
  description: z.string().max(200).default(''),
});

accountingRouter.post(
  '/accounting/accounts',
  perm('accounting.write'),
  T(async (db, req, c) => {
    const b = parse(accountBody, req.body);
    if (b.subtype && !ACCOUNT_SUBTYPES[b.type].some((s) => s.id === b.subtype)) throw badRequest('Pick a detail type for this account');
    const coa = await chartOfAccounts(db, c.shopId);
    if ([...coa.values()].some((a) => !a.archived && a.name.toLowerCase() === b.name.toLowerCase())) throw badRequest('An account with this name already exists', { name: 'Already exists' });
    const a = await one(db, 'INSERT INTO accounts (shop_id, code, name, type, subtype, description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [c.shopId, b.code, b.name, b.type, b.subtype || ACCOUNT_SUBTYPES[b.type][0]!.id, b.description]);
    await audit(db, req, c.shopId, 'create', 'account', a.id, { name: b.name, type: b.type });
    return { key: `acc:${a.id}`, id: a.id };
  }),
);

accountingRouter.patch(
  '/accounting/accounts/:id',
  perm('accounting.write'),
  T(async (db, req, c) => {
    const b = parse(accountBody.partial().extend({ archived: z.boolean().optional() }), req.body);
    const a = await one(db, 'SELECT * FROM accounts WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
    if (!a) throw notFound('Account');
    const type = b.type ?? a.type;
    if (b.type && b.type !== a.type) {
      const used = await one(db, `SELECT 1 FROM journals WHERE shop_id = $1 AND lines @> $2::jsonb LIMIT 1`, [c.shopId, JSON.stringify([{ account: `acc:${a.id}` }])]);
      if (used) throw badRequest('This account has journal entries, so its type can’t change');
    }
    await db.query('UPDATE accounts SET code = $3, name = $4, type = $5, subtype = $6, description = $7, archived = $8 WHERE shop_id = $1 AND id = $2', [
      c.shopId, a.id, b.code ?? a.code, b.name ?? a.name, type, b.subtype ?? (b.type ? ACCOUNT_SUBTYPES[type as keyof typeof ACCOUNT_SUBTYPES][0]!.id : a.subtype), b.description ?? a.description, b.archived ?? a.archived,
    ]);
    await audit(db, req, c.shopId, b.archived ? 'archive' : 'update', 'account', a.id, { name: b.name ?? a.name });
    return { ok: true };
  }),
);

/* ======================= Manual journals ======================= */

const serializeJournal = (j: any, names: Map<string, string>) => ({
  id: j.id, number: j.number, date: j.date, reference: j.reference, notes: j.notes, total: Number(j.total), createdBy: j.created_by_name, createdAt: j.created_at,
  lines: (j.lines as any[]).map((l) => ({ ...l, accountName: names.get(l.account) ?? 'Unknown account' })),
});

accountingRouter.get(
  '/accounting/journals',
  perm('accounting.read'),
  T(async (db, _req, c) => {
    const coa = await chartOfAccounts(db, c.shopId);
    const names = new Map([...coa.values()].map((a) => [a.key, a.name]));
    return (await many(db, 'SELECT * FROM journals WHERE shop_id = $1 ORDER BY date DESC, created_at DESC', [c.shopId])).map((j) => serializeJournal(j, names));
  }),
);

accountingRouter.post(
  '/accounting/journals',
  perm('accounting.write'),
  T(async (db, req, c) => {
    const b = parse(z.object({
      date: iso, reference: z.string().trim().max(60).default(''), notes: z.string().trim().max(500).default(''),
      lines: z.array(z.object({ account: z.string().min(1, 'Choose an account'), debit: z.number().min(0).default(0), credit: z.number().min(0).default(0), description: z.string().max(200).default('') })).min(2, 'A journal needs at least two lines').max(100),
    }), req.body);
    const coa = await chartOfAccounts(db, c.shopId);
    const lines = b.lines.map((l) => ({ ...l, debit: r2(l.debit), credit: r2(l.credit) })).filter((l) => l.debit || l.credit);
    for (const l of lines) {
      const a = coa.get(l.account);
      if (!a || a.archived) throw badRequest('One of the accounts no longer exists');
      if (l.debit && l.credit) throw badRequest('Each line is either a debit or a credit, not both');
    }
    if (lines.length < 2) throw badRequest('A journal needs at least two lines with amounts');
    const dr = r2(lines.reduce((s, l) => s + l.debit, 0)), cr = r2(lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(dr - cr) > 0.004) throw badRequest(`Debits (₹${dr.toFixed(2)}) and credits (₹${cr.toFixed(2)}) must be equal`);
    const number = `JV-${String(await nextSeq(db, c.shopId, 'journal')).padStart(4, '0')}`;
    const j = await one(db, 'INSERT INTO journals (shop_id, number, date, reference, notes, lines, total, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [
      c.shopId, number, b.date, b.reference, b.notes, JSON.stringify(lines), dr, c.id, c.name,
    ]);
    await audit(db, req, c.shopId, 'create', 'journal', j.id, { number, total: dr });
    return serializeJournal(j, new Map([...coa.values()].map((a) => [a.key, a.name])));
  }),
);

accountingRouter.delete(
  '/accounting/journals/:id',
  perm('accounting.write'),
  T(async (db, req, c) => {
    const j = await one(db, 'DELETE FROM journals WHERE shop_id = $1 AND id = $2 RETURNING number, total', [c.shopId, req.params.id]);
    if (!j) throw notFound('Journal');
    await audit(db, req, c.shopId, 'delete', 'journal', req.params.id!, { number: j.number, total: Number(j.total) });
    return { ok: true };
  }),
);

/* ======================= Ledger reports ======================= */

accountingRouter.get('/accounting/ledger', perm('accounting.read'), T(async (db, req, c) => {
  const { from, to } = await range(db, req.query);
  const key = String(req.query.account ?? '');
  if (!key) throw badRequest('Choose an account');
  return generalLedger(db, c.shopId, key, from, to);
}));
accountingRouter.get('/accounting/trial-balance', perm('accounting.read'), T(async (db, req, c) => trialBalance(db, c.shopId, (await range(db, req.query)).to)));
accountingRouter.get('/reports/profit-loss', perm('reports.read'), T(async (db, req, c) => { const r = await range(db, req.query); return profitAndLoss(db, c.shopId, r.from, r.to); }));
accountingRouter.get('/reports/balance-sheet', perm('reports.read'), T(async (db, req, c) => { const r = await range(db, req.query); return balanceSheet(db, c.shopId, r.to, r.fyStartMonth); }));
accountingRouter.get('/reports/cash-flow', perm('reports.read'), T(async (db, req, c) => { const r = await range(db, req.query); return cashFlow(db, c.shopId, r.from, r.to); }));

/** Sales by customer and by item for any date range. */
accountingRouter.get(
  '/reports/sales-by',
  perm('reports.read'),
  T(async (db, req, c) => {
    const { from, to } = await range(db, req.query);
    const showCost = c.permissions.includes('items.cost');
    const byCustomer = await many(db, `
      SELECT coalesce(customer_id::text, 'walk-in') AS id, max(coalesce(nullif(customer->>'companyName', ''), customer->>'name')) AS name, max(customer->>'gstin') AS gstin,
             count(*) AS count, sum(sub_total) AS net, sum(tax_total) AS tax, sum(total) AS total, sum(GREATEST(total - amount_paid - amount_credited, 0)) AS due
        FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY total DESC`, [c.shopId, from, to]);
    const byItem = await many(db, `
      SELECT l->>'itemId' AS item_id, max(l->>'name') AS name, max(l->>'hsn') AS hsn, max(l->>'unit') AS unit, sum((l->>'qty')::numeric) AS qty,
             sum((l->>'amount')::numeric) AS amount, sum((l->>'qty')::numeric * coalesce(it.cost, 0)) AS cost, count(DISTINCT i.id) AS invoices
        FROM invoices i CROSS JOIN jsonb_array_elements(i.lines) l LEFT JOIN items it ON it.id = (l->>'itemId')::uuid
       WHERE i.shop_id = $1 AND i.status = 'Issued' AND i.date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY amount DESC`, [c.shopId, from, to]);
    return {
      from, to,
      byCustomer: byCustomer.map((r) => ({ id: r.id, name: r.name || 'Walk-in customer', gstin: r.gstin ?? '', count: Number(r.count), net: Number(r.net), tax: Number(r.tax), total: Number(r.total), due: Number(r.due) })),
      byItem: byItem.map((r) => {
        const cost = showCost ? r2(Number(r.cost)) : null;
        return { itemId: r.item_id, name: r.name, hsn: r.hsn ?? '', unit: r.unit ?? '', qty: Number(r.qty), amount: Number(r.amount), invoices: Number(r.invoices), cost, profit: cost === null ? null : r2(Number(r.amount) - cost) };
      }),
    };
  }),
);

/** Receivables or payables by age, as of a date, per customer or vendor. */
accountingRouter.get(
  '/reports/ageing',
  perm('reports.read'),
  T(async (db, req, c) => {
    const { to: asOf } = await range(db, { to: req.query.asOf });
    const kind = req.query.kind === 'payable' ? 'payable' : 'receivable';
    if (kind === 'payable' && !c.permissions.includes('purchases.read')) throw new HttpError(403, 'You don’t have access to purchases', 'forbidden');
    // Balance as of the date: paid amounts after asOf are added back.
    const rows = kind === 'receivable'
      ? await many(db, `
          SELECT i.id, i.number, i.date, i.due_date, coalesce(i.customer_id::text, 'walk-in') AS party_id, coalesce(nullif(i.customer->>'companyName', ''), i.customer->>'name', 'Walk-in customer') AS party,
                 i.total - coalesce((SELECT sum(amount + tds_amount) FROM payments p WHERE p.invoice_id = i.id AND p.date <= $2), 0)
                         - coalesce((SELECT sum(total) FROM credit_notes cn WHERE cn.invoice_id = i.id AND cn.date <= $2), 0) AS balance
            FROM invoices i WHERE i.shop_id = $1 AND i.status = 'Issued' AND i.date <= $2`, [c.shopId, asOf])
      : await many(db, `
          SELECT b.id, b.number, b.date, b.due_date, b.vendor_id::text AS party_id, v.name AS party,
                 b.amount - coalesce((SELECT sum(amount + tds_amount) FROM bill_payments p WHERE p.bill_id = b.id AND p.date <= $2), 0) AS balance
            FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.shop_id = $1 AND b.date <= $2`, [c.shopId, asOf]);
    const BUCKETS = ['Current', '1–30 days', '31–60 days', '61–90 days', '> 90 days'] as const;
    const bucketOf = (due: string) => {
      const d = Math.floor((Date.parse(asOf) - Date.parse(due)) / 86400000);
      return d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
    };
    const parties = new Map<string, { id: string; name: string; buckets: number[]; total: number; documents: number }>();
    const docs = [];
    for (const r of rows) {
      const bal = r2(Number(r.balance));
      if (bal < 0.01) continue;
      const k = bucketOf(r.due_date ?? r.date);
      const p = parties.get(r.party_id) ?? { id: r.party_id, name: r.party, buckets: [0, 0, 0, 0, 0], total: 0, documents: 0 };
      p.buckets[k] = r2(p.buckets[k]! + bal); p.total = r2(p.total + bal); p.documents++;
      parties.set(r.party_id, p);
      docs.push({ id: r.id, number: r.number, party: r.party, date: r.date, dueDate: r.due_date, balance: bal, bucket: BUCKETS[k], daysOverdue: Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(r.due_date ?? r.date)) / 86400000)) });
    }
    const list = [...parties.values()].sort((a, b) => b.total - a.total);
    const totals = BUCKETS.map((_, i) => r2(list.reduce((s, p) => s + p.buckets[i]!, 0)));
    return { kind, asOf, buckets: BUCKETS, parties: list, totals, total: r2(totals.reduce((s, v) => s + v, 0)), documents: docs.sort((a, b) => b.daysOverdue - a.daysOverdue) };
  }),
);

/* ======================= Report PDF ======================= */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const pdfBody = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(200).default(''),
  landscape: z.boolean().default(false),
  columns: z.array(z.object({ label: z.string().max(60), align: z.enum(['left', 'right']).default('left') })).min(1).max(16),
  rows: z.array(z.object({ cells: z.array(z.union([z.string(), z.number()]).transform(String)).max(16), kind: z.enum(['row', 'group', 'sub', 'total']).default('row') })).max(5000),
  note: z.string().max(500).default(''),
});

type ReportBody = { title: string; subtitle: string; note: string; columns: Array<{ label: string; align: 'left' | 'right' }>; rows: Array<{ cells: string[]; kind: string }> };
/** A report laid out for the PDF: the business header, the table, and who made it when. */
function reportHtml(org: any, b: ReportBody, by: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; } body { font: 10.5px/1.45 "Inter", "Segoe UI", Arial, sans-serif; color: #111; margin: 0; font-variant-numeric: tabular-nums; }
      header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1.5px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
      h1 { font-size: 16px; margin: 0 0 2px; } .org { font-weight: 600; font-size: 12px; } .muted { color: #555; }
      table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; } tr { break-inside: avoid; }
      th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; color: #444; border-bottom: 1px solid #999; padding: 5px 6px; }
      td { padding: 4.5px 6px; border-bottom: 0.5px solid #ddd; vertical-align: top; } .r { text-align: right; }
      tr.group td { font-weight: 600; background: #f2f2f2; } tr.sub td { font-weight: 600; border-top: 1px solid #999; } tr.total td { font-weight: 700; border-top: 1.5px solid #111; border-bottom: 1.5px solid #111; }
      .note { margin-top: 12px; color: #555; }
    </style></head><body>
      <header><div><div class="org">${esc(org?.company_name)}</div><div class="muted">${esc([org?.address, org?.state].filter(Boolean).join(', '))}${org?.gstin ? ` · GSTIN ${esc(org.gstin)}` : ''}</div></div>
      <div style="text-align:right"><h1>${esc(b.title)}</h1><div class="muted">${esc(b.subtitle)}</div></div></header>
      <table><thead><tr>${b.columns.map((col) => `<th class="${col.align === 'right' ? 'r' : ''}">${esc(col.label)}</th>`).join('')}</tr></thead>
      <tbody>${b.rows.map((r) => `<tr class="${r.kind}">${b.columns.map((col, i) => `<td class="${col.align === 'right' ? 'r' : ''}">${esc(r.cells[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${b.note ? `<p class="note">${esc(b.note)}</p>` : ''}
      <p class="note">Generated ${esc(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))} by ${esc(by)}</p>
    </body></html>`;
}

/** Any report as a PDF: the client sends the table it shows; the server lays it out with the business header. */
accountingRouter.post(
  '/reports/pdf',
  perm('reports.read'),
  h(async (req, res) => {
    const c = userCtx(req);
    const b = parse(pdfBody, req.body);
    const org = await withTenant(c.shopId, async (db) => {
      await audit(db, req, c.shopId, 'export_pdf', 'report', b.title);
      return one(db, 'SELECT company_name, gstin, address, state FROM organizations WHERE shop_id = $1', [c.shopId]);
    });
    const html = reportHtml(org, b, c.name);
    let pdf: Buffer;
    try { pdf = await htmlPdf(html, b.landscape); } catch (e) {
      console.error('[pdf]', (e as Error).message);
      throw new HttpError(503, 'Could not create the PDF right now. Use Print → Save as PDF instead.', 'pdf_unavailable');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${b.title.replace(/[^\w-]+/g, '-')}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }),
);


/* ======================= Email or WhatsApp a report ======================= */

const shareBody = z.object({
  format: z.enum(['pdf', 'xlsx', 'csv']),
  via: z.enum(['email', 'link']),
  to: z.string().trim().max(160).default(''),
  cc: z.string().trim().max(160).default(''),
  message: z.string().trim().max(2000).default(''),
  filename: z.string().trim().min(1).max(120),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(200).default(''),
  landscape: z.boolean().default(false),
  note: z.string().max(500).default(''),
  columns: z.array(z.object({ label: z.string().max(60), align: z.enum(['left', 'right']).optional(), money: z.boolean().optional() })).min(1).max(16),
  rows: z.array(z.object({ cells: z.array(z.union([z.string().max(500), z.number(), z.null()])).max(16), kind: z.enum(['row', 'group', 'sub', 'total']).default('row') })).max(5000),
});
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const inr2 = (v: string | number | null) => (typeof v === 'number' ? new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) : v ?? '');
const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8' } as const;
export const SHARE_DAYS = 7;

/** The report as a file in the chosen format: the same rows the screen shows. */
async function reportFile(b: z.infer<typeof shareBody>, org: any, by: string): Promise<Buffer> {
  if (b.format === 'csv') {
    const cols = b.columns.map((col, i) => ({ key: String(i), label: col.label }));
    const rows = b.rows.map((r) => Object.fromEntries(r.cells.map((v, i) => [String(i), typeof v === 'number' ? v.toFixed(2) : v ?? ''])));
    return Buffer.from('\uFEFF' + toCsv(rows, cols), 'utf8');
  }
  if (b.format === 'xlsx') {
    return Buffer.from(buildXlsx({ name: b.title, title: [b.title, b.subtitle], columns: b.columns.map((col) => ({ label: col.label, money: col.money })),
      rows: b.rows.map((r) => ({ cells: r.cells, bold: r.kind !== 'row' })) }));
  }
  const html = reportHtml(org, { ...b, columns: b.columns.map((col) => ({ label: col.label, align: col.align ?? (col.money ? 'right' : 'left') })),
    rows: b.rows.map((r) => ({ cells: r.cells.map((v) => String(inr2(v))), kind: r.kind })) }, by);
  try { return await htmlPdf(html, b.landscape); } catch (e) {
    console.error('[pdf]', (e as Error).message);
    throw new HttpError(503, 'Could not create the PDF right now. Try Excel or CSV, or use Print → Save as PDF.', 'pdf_unavailable');
  }
}

/**
 * Email a report (PDF, Excel or CSV attached) to someone, or keep it behind a 7-day link to send on WhatsApp
 * (WhatsApp links can't carry a file).
 */
accountingRouter.post(
  '/reports/share',
  perm('reports.read'),
  h(async (req, res) => {
    const c = userCtx(req);
    const b = parse(shareBody, req.body);
    if (b.via === 'email') {
      if (!isEmail(b.to)) throw badRequest('Enter the email address to send it to');
      if (b.cc && !isEmail(b.cc)) throw badRequest('Enter a valid Cc email');
    }
    const org = await withTenant(c.shopId, (db) => one(db, 'SELECT company_name, gstin, address, state FROM organizations WHERE shop_id = $1', [c.shopId]));
    const file = await reportFile(b, org, c.name);
    if (file.length > 10 * 1024 * 1024) throw new HttpError(413, 'This report is too large to send. Pick a shorter date range.', 'too_large');
    const filename = `${b.filename.replace(/[^\w.-]+/g, '-')}.${b.format}`;
    const business = org?.company_name || 'our business';
    if (b.via === 'email') {
      const sent = await sendMail({
        kind: 'report', to: b.to, cc: b.cc || undefined,
        subject: `${b.title}${b.subtitle ? ` (${b.subtitle})` : ''} from ${business}`,
        text: [b.message, `Please find the ${b.title} attached${b.subtitle ? ` for ${b.subtitle}` : ''}.`, `Regards,\n${c.name}\n${business}`].filter(Boolean).join('\n\n'),
        attachments: [{ filename, content: file, contentType: MIME[b.format] }],
      });
      await withTenant(c.shopId, (db) => audit(db, req, c.shopId, 'email_report', 'report', b.title, { to: b.to, format: b.format, sent }));
      res.json({ status: sent ? 'sent' : 'skipped', detail: sent ? `Emailed ${b.to} with ${filename}` : 'Email is not set up on the server yet, so nothing was sent.' });
      return;
    }
    const token = crypto.randomBytes(24).toString('hex');
    await query('DELETE FROM shared_files WHERE expires_at < now()');
    await query(`INSERT INTO shared_files (shop_id, token, filename, mime, data, title, created_by_name, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(days => $8))`, [c.shopId, token, filename, MIME[b.format], file, b.title, c.name, SHARE_DAYS]);
    await withTenant(c.shopId, (db) => audit(db, req, c.shopId, 'share_report', 'report', b.title, { format: b.format }));
    const url = `${config.appUrl}/api/public/files/${token}`;
    res.json({ url, text: `${b.title}${b.subtitle ? ` (${b.subtitle})` : ''} from ${business}:\n${url}\n(Link works for ${SHARE_DAYS} days.)`, expiresInDays: SHARE_DAYS });
  }),
);
