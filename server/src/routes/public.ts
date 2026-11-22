import { Router } from 'express';
import { rateLimit } from '../auth';
import { query, withTenant } from '../db';
import { h, notFound } from '../http';
import { getInvoice } from '../services/documents';
import { invoicePrintBundle, verifyRenderToken } from '../services/printBundle';
import { pdfName, renderPdfOr503 } from './shop/sales';
import { z } from 'zod';
import { parse } from '../http';
import { LEAD_SOURCES, salesContact, waDigits } from '../../../shared/support';
import { saveLead } from '../services/salesLeads';

/** Unauthenticated, read-only invoice view behind an unguessable token (for WhatsApp / email links). */
export const publicRouter = Router();

async function linkFor(token: string) {
  if (!/^[0-9a-f]{36}$/.test(token)) throw notFound('Invoice');
  // A link the owner turned off stops working at once (NFR-04).
  const [link] = await query('SELECT shop_id, invoice_id FROM public_links WHERE token = $1 AND revoked_at IS NULL', [token]);
  if (!link) throw notFound('Invoice');
  return link as { shop_id: string; invoice_id: string };
}

const noIndex = (res: import('express').Response) => { res.setHeader('X-Robots-Tag', 'noindex'); };

publicRouter.get(
  '/invoices/:token',
  rateLimit('public', 60, 60_000),
  h(async (req, res) => {
    const link = await linkFor(req.params.token!);
    const b = await withTenant(link.shop_id, (db) => invoicePrintBundle(db, link.shop_id, link.invoice_id));
    res.setHeader('Cache-Control', 'private, max-age=60');
    noIndex(res);
    res.json({ ...b, branchName: b.branch?.name ?? '' });
  }),
);

/** The same document the shop downloads, so a WhatsApp link and an emailed PDF match exactly. */
publicRouter.get(
  '/invoices/:token/pdf',
  rateLimit('public-pdf', 10, 60_000),
  h(async (req, res) => {
    const link = await linkFor(req.params.token!);
    const inv = await withTenant(link.shop_id, (db) => getInvoice(db, link.shop_id, link.invoice_id));
    const pdf = await renderPdfOr503(link.shop_id, inv.id, 'a4');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfName(inv)}"`);
    noIndex(res);
    res.send(pdf);
  }),
);

/** Data for the headless PDF renderer, authorised by a short-lived signed token for one invoice. */
publicRouter.get(
  '/render/invoices/:id',
  h(async (req, res) => {
    const shopId = verifyRenderToken(String(req.query.rt ?? ''), req.params.id!);
    if (!shopId) throw notFound('Invoice');
    res.setHeader('Cache-Control', 'no-store');
    res.json(await withTenant(shopId, (db) => invoicePrintBundle(db, shopId, req.params.id!)));
  }),
);

/** The support email and phone, for the public privacy and account-deletion pages. */
publicRouter.get(
  '/contact',
  rateLimit('public', 60, 60_000),
  h(async (_req, res) => {
    const [c] = await query('SELECT support_phone, support_email, support_whatsapp, sales_phone, sales_email, sales_whatsapp FROM platform_config WHERE id = 1');
    res.setHeader('Cache-Control', 'public, max-age=300');
    const support = { phone: c?.support_phone ?? '', email: c?.support_email ?? '', whatsapp: waDigits(c?.support_whatsapp ?? '') };
    res.json({ ...support, sales: salesContact({ ...support, salesPhone: c?.sales_phone, salesEmail: c?.sales_email, salesWhatsapp: c?.sales_whatsapp }) });
  }),
);

/**
 * "Talk to sales" from the landing, login, signup and legal pages: a visitor asks the sales team to call them.
 * A hidden field ("website") that people never see catches form-filling bots: the request looks accepted but
 * nothing is saved.
 */
publicRouter.post(
  '/sales-leads',
  rateLimit('sales-lead', 5, 10 * 60_000),
  h(async (req, res) => {
    const b = parse(z.object({
      name: z.string().trim().min(2, 'Tell us your name').max(120),
      phone: z.string().trim().max(30).default(''),
      email: z.string().trim().max(160).default(''),
      business: z.string().trim().max(160).default(''),
      city: z.string().trim().max(80).default(''),
      message: z.string().trim().max(1000).default(''),
      source: z.enum(LEAD_SOURCES).default('landing'),
      page: z.string().trim().max(200).default(''),
      website: z.string().max(200).default(''),
    }), req.body);
    if (b.website) { res.status(201).json({ ok: true }); return; }
    await saveLead({ ...b, ip: req.ip ?? '' });
    res.status(201).json({ ok: true });
  }),
);

/** A report file shared on WhatsApp (Reports → Export → WhatsApp): opened by its unguessable link for 7 days. */
publicRouter.get(
  '/files/:token',
  rateLimit('public-file', 30, 60_000),
  h(async (req, res) => {
    if (!/^[0-9a-f]{48}$/.test(req.params.token!)) throw notFound('File');
    const [f] = await query('SELECT filename, mime, data FROM shared_files WHERE token = $1 AND expires_at > now()', [req.params.token]);
    if (!f) throw notFound('File (the link may have expired)');
    noIndex(res);
    res.setHeader('Content-Type', f.mime);
    // Only a PDF opens in the browser; spreadsheets download. Nothing in the file can run scripts on our site.
    res.setHeader('Content-Disposition', `${f.mime === 'application/pdf' ? 'inline' : 'attachment'}; filename="${String(f.filename).replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(f.data);
  }),
);
