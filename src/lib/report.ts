import { download } from '@/api/client';
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

export function exportPdf(t: ReportTable) {
  return download('/shop/reports/pdf', `${t.filename}.pdf`, {
    method: 'POST',
    body: {
      title: t.title, subtitle: t.subtitle, note: t.note ?? '', landscape: !!t.landscape,
      columns: t.columns.map((c) => ({ label: c.label, align: c.align ?? (c.money ? 'right' : 'left') })),
      rows: t.rows.map((r) => ({ cells: r.cells.map((v) => String(fmt(v))), kind: r.kind ?? 'row' })),
    },
  });
}
