import crypto from 'node:crypto';
import type { Db } from '../db';
import { withPrintDefaults } from '../../../shared/printSettings';
import { getOrg } from './common';
import { getInvoice } from './documents';

/** Everything the printable invoice needs, in one payload. The same bundle feeds the screen, the print dialog and the server PDF. */
export async function invoicePrintBundle(db: Db, shopId: string, invoiceId: string) {
  const inv = await getInvoice(db, shopId, invoiceId);
  const org = await getOrg(db, shopId);
  const branch = inv.branchId ? (await db.query('SELECT name, address, phone FROM branches WHERE id = $1', [inv.branchId])).rows[0] : null;
  const settings = (await db.query('SELECT print_settings FROM organizations WHERE shop_id = $1', [shopId])).rows[0]?.print_settings;
  return {
    invoice: { ...inv, createdBy: undefined, recurringId: undefined, salesOrderId: undefined },
    branch: branch ? { name: branch.name as string, address: branch.address as string, phone: branch.phone as string } : null,
    org: {
      companyName: org.company_name, legalName: org.legal_name, gstin: org.gstin, email: org.email, phone: org.phone, address: org.address,
      state: org.state, logo: org.logo, invoiceFooter: org.invoice_footer, upiId: org.upi_id, bankDetails: org.bank_details,
      invoiceTemplate: org.invoice_template, compositionScheme: org.composition_scheme,
    },
    settings: withPrintDefaults(settings),
  };
}

/* ---------- Render tokens ----------
 * The PDF renderer is a headless browser with no session. It loads the print route with a short-lived,
 * HMAC-signed token naming exactly one invoice, and the API accepts that token for that invoice only. */
const SECRET = process.env.RENDER_SECRET || crypto.randomBytes(32).toString('hex');
const sign = (body: string) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

export function renderToken(shopId: string, invoiceId: string, ttlMs = 120_000) {
  const body = `${shopId}.${invoiceId}.${Date.now() + ttlMs}`;
  return `${Buffer.from(body).toString('base64url')}.${sign(body)}`;
}

export function verifyRenderToken(token: string, invoiceId: string): string | null {
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const body = Buffer.from(b64, 'base64url').toString();
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [shopId, id, exp] = body.split('.');
  if (id !== invoiceId || !shopId || Number(exp) < Date.now()) return null;
  return shopId;
}
