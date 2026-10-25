import { ApiError, download } from '@/api/client';
import { toCsv } from '../../shared/csv';
import { buildXlsx } from '../../shared/xlsx';

/** One table as every report exports it: the same rows go to PDF, Excel and CSV. */
export interface ReportTable {
  title: string;
  subtitle: string;
  filename: string;
  columns: Array<{ label: string; align?: 'left' | 'right'; money?: boolean }>;
  rows: Array<{ cells: Array<string | number | null>; kind?: 'row' | 'group' | 'sub' | 'total' }>;
  note?: string;
  landscape?: boolean;
}

const save = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
};

const fmt = (v: string | number | null) => (typeof v === 'number' ? new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) : v ?? '');

export function exportCsv(t: ReportTable) {
  const cols = t.columns.map((c, i) => ({ key: String(i), label: c.label }));
  const rows = t.rows.map((r) => Object.fromEntries(r.cells.map((v, i) => [String(i), typeof v === 'number' ? v.toFixed(2) : v ?? ''])));
  save(new Blob(['﻿' + toCsv(rows, cols)], { type: 'text/csv' }), `${t.filename}.csv`);
}

export function exportXlsx(t: ReportTable) {
  const bytes = buildXlsx({
    name: t.title, title: [t.title, t.subtitle],
    columns: t.columns.map((c) => ({ label: c.label, money: c.money })),
    rows: t.rows.map((r) => ({ cells: r.cells, bold: r.kind === 'group' || r.kind === 'sub' || r.kind === 'total' })),
  });
  save(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${t.filename}.xlsx`);
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The same layout as the server PDF, opened in the browser's print window (Save as PDF works everywhere). */
export function printTable(t: ReportTable, business = '') {
  // A hidden frame, not a pop-up: it can print even when this runs after an async failure.
  document.getElementById('c360-print-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'c360-print-frame';
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const w = frame.contentWindow!;
  const right = (c: ReportTable['columns'][number]) => c.align === 'right' || (c.money && c.align !== 'left');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.title)}</title><style>
    @page { size: A4 ${t.landscape ? 'landscape' : 'portrait'}; margin: 14mm 12mm; }
    body { font: 10.5px/1.45 Inter, "Segoe UI", Arial, sans-serif; color: #111; margin: 0; font-variant-numeric: tabular-nums; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1.5px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
    h1 { font-size: 16px; margin: 0 0 2px; } .muted { color: #555; }
    table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; } tr { break-inside: avoid; }
    th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; color: #444; border-bottom: 1px solid #999; padding: 5px 6px; }
    td { padding: 4.5px 6px; border-bottom: .5px solid #ddd; vertical-align: top; } .r { text-align: right; }
    tr.group td { font-weight: 600; background: #f2f2f2; } tr.sub td { font-weight: 600; border-top: 1px solid #999; } tr.total td { font-weight: 700; border-top: 1.5px solid #111; border-bottom: 1.5px solid #111; }
    .note { margin-top: 12px; color: #555; }
  </style></head><body>
    <header><div><strong>${esc(business)}</strong></div><div style="text-align:right"><h1>${esc(t.title)}</h1><div class="muted">${esc(t.subtitle)}</div></div></header>
    <table><thead><tr>${t.columns.map((c) => `<th class="${right(c) ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map((r) => `<tr class="${r.kind ?? 'row'}">${t.columns.map((c, i) => `<td class="${right(c) ? 'r' : ''}">${esc(fmt(r.cells[i] ?? null))}</td>`).join('')}</tr>`).join('')}</tbody></table>
    ${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}
  </body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 250);
}

/**
 * Downloads the server-made PDF. If the PDF service is busy or unavailable, opens the print window instead
 * and resolves to 'print' so the caller can tell the user to choose "Save as PDF".
 */
export async function exportPdf(t: ReportTable, business = ''): Promise<'pdf' | 'print'> {
  try {
    await download('/shop/reports/pdf', `${t.filename}.pdf`, {
      method: 'POST',
      body: {
        title: t.title, subtitle: t.subtitle, note: t.note ?? '', landscape: !!t.landscape,
        columns: t.columns.map((c) => ({ label: c.label, align: c.align ?? (c.money ? 'right' : 'left') })),
        rows: t.rows.map((r) => ({ cells: r.cells.map((v) => String(fmt(v))), kind: r.kind ?? 'row' })),
      },
    });
    return 'pdf';
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) throw e;
    printTable(t, business);
    return 'print';
  }
}

/** Prints another page of the app (e.g. an invoice print view) through a hidden frame. The page prints itself on load. */
export function printPage(url: string) {
  document.getElementById('c360-print-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'c360-print-frame';
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  frame.src = url + (url.includes('?') ? '&' : '?') + 'autoprint=1';
  document.body.appendChild(frame);
}

/** Server PDF for an invoice, falling back to the browser's print window when the PDF service is unavailable. */
export async function downloadInvoicePdf(id: string, filename: string, paper = 'a4'): Promise<'pdf' | 'print'> {
  try {
    await download(`/shop/invoices/${id}/pdf?paper=${paper}`, filename);
    return 'pdf';
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) throw e;
    printPage(`/invoices/${id}/print?paper=${paper}`);
    return 'print';
  }
}
