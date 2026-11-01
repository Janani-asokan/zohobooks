import type { Db } from '../db';
import { one } from '../db';
import { getOrg } from './common';

/**
 * What an issued invoice is printed with, frozen when it is issued (FUN-11 / TEC-05): the business details, the print
 * layout, the trade field labels, the branch, and the customer's other dues at that moment. Later edits to the profile
 * or layout never change how an issued invoice reprints.
 */
export interface PrintSnapshot {
  org: Record<string, unknown>;
  settings: unknown;
  itemFields: unknown[];
  invoiceFields: unknown[];
  branch: { name: string; address: string; phone: string } | null;
  /** The customer's unpaid balance on other invoices when this one was issued (FUN-04); null for walk-in sales. */
  previousBalance?: number | null;
  takenAt: string;
  backfilled?: boolean;
}

export const printOrg = (o: any) => ({
  companyName: o.company_name, legalName: o.legal_name, gstin: o.gstin, email: o.email, phone: o.phone, address: o.address,
  state: o.state, logo: o.logo, invoiceFooter: o.invoice_footer, upiId: o.upi_id, bankDetails: o.bank_details,
  invoiceTemplate: o.invoice_template, compositionScheme: o.composition_scheme, businessType: o.business_type ?? '', tradeDetails: o.trade_details ?? {},
});

export async function takePrintSnapshot(db: Db, shopId: string, inv: { id: string; branch_id: string | null; customer_id: string | null }): Promise<PrintSnapshot> {
  const org = await getOrg(db, shopId);
  const branch = inv.branch_id ? await one(db, 'SELECT name, address, phone FROM branches WHERE shop_id = $1 AND id = $2', [shopId, inv.branch_id]) : null;
  const prev = inv.customer_id ? await one(db,
    `SELECT coalesce(sum(GREATEST(total - amount_paid - amount_credited, 0)), 0) AS open FROM invoices
      WHERE shop_id = $1 AND customer_id = $2 AND status = 'Issued' AND id <> $3`, [shopId, inv.customer_id, inv.id]) : null;
  return {
    org: printOrg(org),
    settings: org.print_settings ?? null,
    itemFields: org.item_fields ?? [],
    invoiceFields: org.invoice_fields ?? [],
    branch: branch ? { name: branch.name, address: branch.address, phone: branch.phone } : null,
    previousBalance: prev ? Math.round(Number(prev.open) * 100) / 100 : null,
    takenAt: new Date().toISOString(),
  };
}
