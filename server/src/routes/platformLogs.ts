/**
 * Super admin: the email log, the API-call log and the map of outside services (which feature uses which API,
 * whether it is set up, and how it has been doing). Read-only. CSV export for escalations.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { h, notFound, parse } from '../http';
import { mailStatus } from '../mailer';
import { LOG_DAYS } from '../services/outbound';
import { toCsv } from '../../../shared/csv';
import { featureLabel, INTEGRATIONS } from '../../../shared/integrations';

export const platformLogsRouter = Router();

const PAGE = 50;
const filters = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['sent', 'failed', 'not_sent', 'problems']).optional(),
  kind: z.string().max(60).optional(),
  service: z.string().max(40).optional(),
  feature: z.string().max(60).optional(),
  ok: z.enum(['true', 'false']).optional(),
  shopId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  format: z.enum(['json', 'csv']).default('json'),
});

/** Spreadsheet apps run cells that start with = + - @ as formulas; quote them so an exported log is safe to open. */
const safeCell = (v: unknown) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const sendCsv = (res: import('express').Response, name: string, rows: Array<Record<string, unknown>>, cols: Array<{ key: string; label: string }>) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + toCsv(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)]))), cols));
};

function where(f: z.infer<typeof filters>, table: 'e' | 'a') {
  const w: string[] = []; const p: unknown[] = [];
  const add = (sql: string, v: unknown) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (f.shopId) add(`${table}.shop_id = ?`, f.shopId);
  if (f.from) add(`${table}.created_at >= (?::date)::timestamptz`, f.from);
  if (f.to) add(`${table}.created_at < (?::date + 1)::timestamptz`, f.to);
  if (table === 'e') {
    if (f.q) { p.push(`%${f.q.toLowerCase()}%`); const n = p.length; w.push(`(lower(e.recipient) LIKE $${n} OR lower(e.subject) LIKE $${n} OR lower(e.provider_message_id) LIKE $${n} OR lower(s.name) LIKE $${n})`); }
    if (f.status === 'problems') w.push("e.status <> 'sent'"); else if (f.status) add('e.status = ?', f.status);
    if (f.kind) add('e.kind = ?', f.kind);
  } else {
    if (f.q) { p.push(`%${f.q.toLowerCase()}%`); const n = p.length; w.push(`(lower(a.endpoint) LIKE $${n} OR lower(a.error) LIKE $${n} OR lower(a.ref) LIKE $${n} OR lower(s.name) LIKE $${n})`); }
    if (f.service) add('a.service = ?', f.service);
    if (f.feature) add('a.feature = ?', f.feature);
    if (f.ok) add('a.ok = ?', f.ok === 'true');
  }
  return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', params: p };
}

const EMAIL_COLS = [
  { key: 'sentAt', label: 'Time (UTC)' }, { key: 'status', label: 'Status' }, { key: 'purpose', label: 'Purpose' }, { key: 'recipient', label: 'To' },
  { key: 'cc', label: 'Cc' }, { key: 'subject', label: 'Subject' }, { key: 'shop', label: 'Shop' }, { key: 'provider', label: 'Provider' },
  { key: 'messageId', label: 'Provider message id' }, { key: 'error', label: 'Error' }, { key: 'attachments', label: 'Attachments' }, { key: 'ms', label: 'Took (ms)' },
];

platformLogsRouter.get('/emails', h(async (req, res) => {
  const f = parse(filters, req.query);
  const w = where(f, 'e');
  const csv = f.format === 'csv';
  const rows = await query(`SELECT e.*, s.name AS shop_name FROM email_log e LEFT JOIN shops s ON s.id = e.shop_id ${w.sql}
    ORDER BY e.created_at DESC, e.id DESC LIMIT ${csv ? 50_000 : PAGE} OFFSET ${csv ? 0 : (f.page - 1) * PAGE}`, w.params);
  const out = rows.map((r) => ({
    id: Number(r.id), sentAt: new Date(r.created_at).toISOString(), status: r.status, kind: r.kind, purpose: featureLabel(r.kind),
    recipient: r.recipient, cc: r.cc, subject: r.subject, shopId: r.shop_id, shop: r.shop_name ?? '', provider: r.provider,
    messageId: r.provider_message_id, error: r.error, ms: r.duration_ms,
    attachments: (r.attachments as Array<{ name: string; kb: number }>).map((a) => `${a.name} (${a.kb} KB)`).join('; '),
  }));
  if (csv) return sendCsv(res, 'email-log', out, EMAIL_COLS);
  const [{ total }] = await query(`SELECT count(*)::int AS total FROM email_log e LEFT JOIN shops s ON s.id = e.shop_id ${w.sql}`, w.params);
  const kinds = await query("SELECT kind, count(*)::int AS n FROM email_log WHERE created_at > now() - interval '90 days' GROUP BY kind ORDER BY n DESC");
  res.json({ rows: out, total, page: f.page, pageSize: PAGE, kinds: kinds.map((k) => ({ key: k.kind, label: featureLabel(k.kind), n: k.n })), keepDays: LOG_DAYS.email });
}));

const API_COLS = [
  { key: 'at', label: 'Time (UTC)' }, { key: 'service', label: 'Service' }, { key: 'featureLabel', label: 'Feature' }, { key: 'method', label: 'Method' },
  { key: 'endpoint', label: 'Endpoint' }, { key: 'statusCode', label: 'HTTP status' }, { key: 'result', label: 'Result' }, { key: 'ms', label: 'Took (ms)' },
  { key: 'shop', label: 'Shop' }, { key: 'error', label: 'Error' }, { key: 'ref', label: 'Reference' },
];

platformLogsRouter.get('/api-calls', h(async (req, res) => {
  const f = parse(filters, req.query);
  const w = where(f, 'a');
  const csv = f.format === 'csv';
  const rows = await query(`SELECT a.*, s.name AS shop_name FROM api_calls a LEFT JOIN shops s ON s.id = a.shop_id ${w.sql}
    ORDER BY a.created_at DESC, a.id DESC LIMIT ${csv ? 50_000 : PAGE} OFFSET ${csv ? 0 : (f.page - 1) * PAGE}`, w.params);
  const out = rows.map((r) => ({
    id: Number(r.id), at: new Date(r.created_at).toISOString(), service: r.service, feature: r.feature, featureLabel: featureLabel(r.feature),
    method: r.method, endpoint: r.endpoint, statusCode: r.status_code, ok: r.ok, result: r.ok ? 'OK' : 'Failed', ms: r.duration_ms,
    shopId: r.shop_id, shop: r.shop_name ?? '', error: r.error, ref: r.ref,
  }));
  if (csv) return sendCsv(res, 'api-calls', out, API_COLS);
  const [{ total }] = await query(`SELECT count(*)::int AS total FROM api_calls a LEFT JOIN shops s ON s.id = a.shop_id ${w.sql}`, w.params);
  res.json({ rows: out, total, page: f.page, pageSize: PAGE, keepDays: LOG_DAYS.api });
}));

platformLogsRouter.get('/emails/:id', h(async (req, res) => {
  if (!/^\d+$/.test(req.params.id!)) throw notFound('Email');
  const [r] = await query('SELECT e.*, s.name AS shop_name FROM email_log e LEFT JOIN shops s ON s.id = e.shop_id WHERE e.id = $1', [req.params.id]);
  if (!r) throw notFound('Email');
  // The provider calls made for this email, matched by time and recipient's feature.
  const calls = await query(`SELECT * FROM api_calls WHERE feature = $1 AND created_at BETWEEN $2::timestamptz - interval '1 minute' AND $2::timestamptz + interval '5 seconds'
    AND service = $3 ORDER BY created_at DESC LIMIT 5`, [r.kind, r.created_at, r.provider]);
  res.json({ ...r, id: Number(r.id), purpose: featureLabel(r.kind), calls });
}));

/** Every outside service: what it is for, whether it is set up (setting names only), and the last 7 and 30 days. */
platformLogsRouter.get('/integrations', h(async (_req, res) => {
  const stats = await query(`SELECT service, count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS failed,
      round(avg(duration_ms))::int AS avg_ms, max(created_at) AS last_at, max(created_at) FILTER (WHERE ok) AS last_ok_at
    FROM api_calls WHERE created_at > now() - interval '7 days' GROUP BY service`);
  const lastErr = await query(`SELECT DISTINCT ON (service) service, error, created_at FROM api_calls WHERE NOT ok ORDER BY service, created_at DESC`);
  const byFeature = await query(`SELECT service, feature, count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS failed
    FROM api_calls WHERE created_at > now() - interval '30 days' GROUP BY service, feature`);
  const emails = await query(`SELECT status, count(*)::int AS n FROM email_log WHERE created_at > now() - interval '7 days' GROUP BY status`);
  const mail = mailStatus();
  const isSet = (name: string) => !!(process.env[name] ?? '').trim();
  res.json({
    mail: { ...mail, last7Days: Object.fromEntries(emails.map((e) => [e.status, e.n])) },
    keepDays: LOG_DAYS,
    services: INTEGRATIONS.map((i) => {
      const s = stats.find((x) => x.service === i.key);
      const e = lastErr.find((x) => x.service === i.key);
      return {
        ...i,
        configured: i.settings.length ? i.settings.filter((n) => n !== 'MAIL_FROM' && n !== 'AI_MODEL' && n !== 'SMTP_PORT').every(isSet) : null,
        settingsStatus: i.settings.map((n) => ({ name: n, set: isSet(n) })),
        inUse: i.key === 'brevo' || i.key === 'resend' || i.key === 'smtp' ? mail.provider === i.key : undefined,
        last7Days: s ? { calls: s.calls, failed: s.failed, avgMs: s.avg_ms, lastAt: s.last_at, lastOkAt: s.last_ok_at } : { calls: 0, failed: 0 },
        lastError: e ? { error: e.error, at: e.created_at } : null,
        features: i.features.map((k) => {
          const b = byFeature.find((x) => x.service === i.key && x.feature === k);
          return { key: k, label: featureLabel(k), calls30d: b?.calls ?? 0, failed30d: b?.failed ?? 0 };
        }),
      };
    }),
  });
}));
