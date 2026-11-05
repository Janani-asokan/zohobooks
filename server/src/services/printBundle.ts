import crypto from 'node:crypto';
import type { Db } from '../db';
import { withPrintDefaults } from '../../../shared/printSettings';
import { one } from '../db';
import { takePrintSnapshot, type PrintSnapshot } from './printSnapshot';
import { templateByKey } from '../../../shared/templates';
import { getInvoice } from './documents';

/**
 * Everything the printable invoice needs, in one payload. The same bundle feeds the screen, the print dialog and the
 * server PDF. An issued invoice prints from the snapshot taken when it was issued, so reprints match the original
 * (FUN-11); a draft uses today's details.
 */
export async function invoicePrintBundle(db: Db, shopId: string, invoiceId: string) {
  const inv = await getInvoice(db, shopId, invoiceId);
  const row = await one(db, 'SELECT print_snapshot, branch_id, customer_id FROM invoices WHERE shop_id = $1 AND id = $2', [shopId, invoiceId]);
  const snap: PrintSnapshot = inv.status !== 'Draft' && row?.print_snapshot
    ? row.print_snapshot
    : await takePrintSnapshot(db, shopId, { id: invoiceId, branch_id: row?.branch_id ?? null, customer_id: row?.customer_id ?? null });
  // How the counter's printer takes the page is a printer setting, not part of the bill: always today's.
  const now = withPrintDefaults((await one(db, 'SELECT print_settings FROM organizations WHERE shop_id = $1', [shopId]))?.print_settings);
  const settings = withPrintDefaults(snap.settings);
  settings.thermal = { ...settings.thermal, pageWidth: now.thermal.pageWidth };
  const tradeLabels = Object.fromEntries((templateByKey(String(snap.org.businessType ?? ''))?.tradeDetails ?? []).map((d) => [d.key, d.label]));
  const tradeDetails = Object.entries((snap.org.tradeDetails ?? {}) as Record<string, string>).filter(([, v]) => v).map(([k, v]) => ({ label: tradeLabels[k] ?? k, value: v }));
  return {
    invoice: { ...inv, createdBy: undefined, recurringId: undefined, salesOrderId: undefined },
    branch: snap.branch,
    org: { ...snap.org, tradeDetails },
    settings,
    itemFields: snap.itemFields ?? [],
    invoiceFields: snap.invoiceFields ?? [],
    /** Shown on the bill only when the snapshot recorded it (not for invoices issued before this was kept). */
    previousBalance: snap.previousBalance ?? null,
    snapshotAt: inv.status !== 'Draft' && row?.print_snapshot ? snap.takenAt : null,
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
