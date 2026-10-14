import { Router } from 'express';
import { rateLimit } from '../auth';
import { query, withTenant } from '../db';
import { h, notFound } from '../http';
import { getOrg } from '../services/common';
import { getInvoice } from '../services/documents';

/** Unauthenticated, read-only invoice view behind an unguessable token (for WhatsApp / email links). */
export const publicRouter = Router();

publicRouter.get(
  '/invoices/:token',
  rateLimit('public', 60, 60_000),
  h(async (req, res) => {
    if (!/^[0-9a-f]{36}$/.test(req.params.token!)) throw notFound('Invoice');
    const [link] = await query('SELECT shop_id, invoice_id FROM public_links WHERE token = $1', [req.params.token]);
    if (!link) throw notFound('Invoice');
    const out = await withTenant(link.shop_id, async (db) => {
      const inv = await getInvoice(db, link.shop_id, link.invoice_id);
      const org = await getOrg(db, link.shop_id);
      const branch = inv.branchId ? (await db.query('SELECT name FROM branches WHERE id = $1', [inv.branchId])).rows[0] : null;
      return {
        invoice: { ...inv, createdBy: undefined, recurringId: undefined, salesOrderId: undefined },
        branchName: branch?.name ?? '',
        org: {
          companyName: org.company_name, legalName: org.legal_name, gstin: org.gstin, email: org.email, phone: org.phone, address: org.address,
          state: org.state, logo: org.logo, invoiceFooter: org.invoice_footer, upiId: org.upi_id, bankDetails: org.bank_details,
          invoiceTemplate: org.invoice_template, compositionScheme: org.composition_scheme,
        },
      };
    });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.json(out);
  }),
);
