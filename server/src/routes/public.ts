import { Router } from 'express';
import { rateLimit } from '../auth';
import { query, withTenant } from '../db';
import { h, notFound } from '../http';
import { getInvoice } from '../services/documents';
import { invoicePrintBundle, verifyRenderToken } from '../services/printBundle';
import { pdfName, renderPdfOr503 } from './shop/sales';

/** Unauthenticated, read-only invoice view behind an unguessable token (for WhatsApp / email links). */
export const publicRouter = Router();

async function linkFor(token: string) {
  if (!/^[0-9a-f]{36}$/.test(token)) throw notFound('Invoice');
  const [link] = await query('SELECT shop_id, invoice_id FROM public_links WHERE token = $1', [token]);
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
