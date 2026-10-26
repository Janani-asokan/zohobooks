/** RFC 4180-ish CSV helpers (quotes, embedded commas/newlines). Excel opens these directly. */
export function toCsv(rows: Array<Record<string, unknown>>, columns: Array<{ key: string; label: string }>): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n');
}

/** Rows keyed by the header text exactly as written (for column mapping screens). Accepts comma, semicolon or tab separators. */
export function parseCsvRaw(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const sep = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const grid = splitCsv(text, sep);
  const [head, ...body] = grid;
  if (!head) return { headers: [], rows: [] };
  const headers = head.map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

function splitCsv(text: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
