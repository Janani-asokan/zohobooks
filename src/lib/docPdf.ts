import type { Bill, CreditNote, Journal, Line, PurchaseOrder, SalesOrder, StockAdjustment, StockTransfer } from '@/api/types';
import { fmtDate } from '@/lib/format';
import type { ReportTable } from '@/lib/report';

/**
 * One builder per document type, so every quote, order, bill, credit note, adjustment, transfer and journal
 * downloads as a PDF with the same layout as the reports (business header, table, totals).
 */
const r2 = (n: number) => Math.round(n * 100) / 100;
const fileName = (s: string) => s.replace(/[^\w-]+/g, '-');

function itemRows(lines: Array<Pick<Line, 'name' | 'hsn' | 'qty' | 'unit' | 'rate' | 'discount' | 'taxRate' | 'amount'>>, withGst: boolean) {
  return lines.map((l, i) => ({ cells: [String(i + 1), l.name, l.hsn || '—', `${l.qty} ${l.unit}`, l.rate, l.discount ? `${l.discount}%` : '—', withGst ? `${l.taxRate}%` : '—', l.amount] }));
}
const ITEM_COLS: ReportTable['columns'] = [
  { label: '#' }, { label: 'Item' }, { label: 'HSN/SAC' }, { label: 'Qty', align: 'right' }, { label: 'Rate', money: true }, { label: 'Disc', align: 'right' }, { label: 'GST', align: 'right' }, { label: 'Amount', money: true },
];

export function salesDocTable(so: SalesOrder, customer: string): ReportTable {
  const kind = so.kind === 'quote' ? 'Quotation' : 'Sales order';
  const taxable = r2(so.lines.reduce((s, l) => s + l.amount, 0));
  const tax = so.withGst ? r2(so.lines.reduce((s, l) => s + (l.amount * l.taxRate) / 100, 0)) : 0;
  return {
    title: `${kind} ${so.number}`, filename: fileName(`${kind}-${so.number}`),
    subtitle: `${customer} · ${fmtDate(so.date)}${so.kind === 'quote' && so.expiryDate ? ` · valid till ${fmtDate(so.expiryDate)}` : ''} · ${so.status}`,
    columns: ITEM_COLS,
    rows: [
      ...itemRows(so.lines, so.withGst),
      { cells: ['', 'Taxable amount', '', '', null, '', '', taxable], kind: 'sub' },
      ...(so.withGst ? [{ cells: ['', 'GST', '', '', null, '', '', tax] as Array<string | number | null> }] : []),
      { cells: ['', 'Total', '', '', null, '', '', so.total], kind: 'total' },
    ],
    note: so.notes,
  };
}

export function creditNoteTable(cn: CreditNote): ReportTable {
  const party = cn.customer.companyName || cn.customer.name;
  return {
    title: `Credit note ${cn.number}`, filename: fileName(`credit-note-${cn.number}`),
    subtitle: `${party} · ${fmtDate(cn.date)} · against ${cn.invoiceNumber}`,
    columns: ITEM_COLS,
    rows: [
      ...itemRows(cn.lines, cn.withGst),
      { cells: ['', 'Taxable amount', '', '', null, '', '', cn.subTotal], kind: 'sub' },
      ...(cn.interState ? [{ cells: ['', 'IGST', '', '', null, '', '', cn.igst] as Array<string | number | null> }] : [
        { cells: ['', 'CGST', '', '', null, '', '', cn.cgst] as Array<string | number | null> },
        { cells: ['', 'SGST', '', '', null, '', '', cn.sgst] as Array<string | number | null> },
      ]),
      { cells: ['', 'Total credit', '', '', null, '', '', cn.total], kind: 'total' },
    ],
    note: cn.reason ? `Reason: ${cn.reason}` : '',
  };
}

const PURCHASE_COLS: ReportTable['columns'] = [{ label: '#' }, { label: 'Item' }, { label: 'Qty', align: 'right' }, { label: 'Received', align: 'right' }, { label: 'Rate', money: true }, { label: 'GST', align: 'right' }, { label: 'Amount', money: true }];

export function purchaseOrderTable(po: PurchaseOrder): ReportTable {
  return {
    title: `Purchase order ${po.number}`, filename: fileName(`purchase-order-${po.number}`),
    subtitle: `${po.vendorName} · ${fmtDate(po.date)}${po.expectedDate ? ` · expected ${fmtDate(po.expectedDate)}` : ''} · ${po.status}`,
    columns: PURCHASE_COLS,
    rows: [
      ...po.lines.map((l, i) => ({ cells: [String(i + 1), l.name, `${l.qty} ${l.unit}`, `${l.received}`, l.rate, `${l.taxRate}%`, l.amount] })),
      { cells: ['', 'Sub total', '', '', null, '', po.subTotal], kind: 'sub' as const },
      { cells: ['', 'GST', '', '', null, '', po.taxTotal] },
      { cells: ['', 'Total', '', '', null, '', po.total], kind: 'total' as const },
    ],
    note: po.notes,
  };
}

export function billTable(b: Bill): ReportTable {
  return {
    title: `Bill ${b.number}`, filename: fileName(`bill-${b.number}`),
    subtitle: `${b.vendorName}${b.vendorBillNo ? ` · vendor bill ${b.vendorBillNo}` : ''} · ${fmtDate(b.date)} · due ${fmtDate(b.dueDate)} · ${b.status}`,
    columns: PURCHASE_COLS,
    rows: [
      ...(b.lines.length ? b.lines.map((l, i) => ({ cells: [String(i + 1), l.name, `${l.qty} ${l.unit}`, `${l.received}`, l.rate, `${l.taxRate}%`, l.amount] as Array<string | number | null> }))
        : [{ cells: ['1', b.description || 'Bill amount', '', '', null, '', b.taxableAmount] as Array<string | number | null> }]),
      { cells: ['', 'Taxable amount', '', '', null, '', b.taxableAmount], kind: 'sub' },
      { cells: ['', 'GST', '', '', null, '', b.taxAmount] },
      { cells: ['', 'Total', '', '', null, '', b.amount], kind: 'total' },
      { cells: ['', 'Paid', '', '', null, '', b.amountPaid] },
      { cells: ['', 'Balance due', '', '', null, '', b.balance], kind: 'total' },
    ],
  };
}

export function adjustmentTable(a: StockAdjustment): ReportTable {
  return {
    title: `Stock adjustment ${a.number}`, filename: fileName(`stock-adjustment-${a.number}`),
    subtitle: `${a.branchName} · ${fmtDate(a.date)} · ${a.reason}${a.createdBy ? ` · by ${a.createdBy}` : ''}`,
    columns: [{ label: 'Item' }, { label: 'Before', align: 'right' }, { label: 'Change', align: 'right' }, { label: 'After', align: 'right' }, { label: 'Value', money: true }],
    rows: [...a.lines.map((l) => ({ cells: [l.name, String(l.before), `${l.change > 0 ? '+' : ''}${l.change} ${l.unit}`, String(l.after), l.value] as Array<string | number | null> })), { cells: ['Total value', '', '', '', a.value], kind: 'total' }],
    note: a.notes,
  };
}

export function transferTable(t: StockTransfer): ReportTable {
  return {
    title: `Stock transfer ${t.number}`, filename: fileName(`transfer-${t.number}`),
    subtitle: `${t.fromName} → ${t.toName} · ${fmtDate(t.date)} · ${t.status}`,
    columns: [{ label: '#' }, { label: 'Item' }, { label: 'Quantity', align: 'right' }, { label: 'Serial numbers' }],
    rows: t.lines.map((l, i) => ({ cells: [String(i + 1), l.name, `${l.qty} ${l.unit}`, l.serials?.join(', ') || '—'] })),
    note: [t.notes, 'Received by: ____________________   Date: ____________'].filter(Boolean).join('\n'),
  };
}

export function journalTable(j: Journal): ReportTable {
  return {
    title: `Journal ${j.number}`, filename: fileName(`journal-${j.number}`),
    subtitle: `${fmtDate(j.date)}${j.reference ? ` · ${j.reference}` : ''}${j.createdBy ? ` · by ${j.createdBy}` : ''}`,
    columns: [{ label: 'Account' }, { label: 'Description' }, { label: 'Debit', money: true }, { label: 'Credit', money: true }],
    rows: [...j.lines.map((l) => ({ cells: [l.accountName, l.description || '', l.debit || null, l.credit || null] as Array<string | number | null> })), { cells: ['Total', '', j.total, j.total], kind: 'total' }],
    note: j.notes,
  };
}
