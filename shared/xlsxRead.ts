/**
 * Reads the first sheet of an .xlsx file into rows of text, in the browser, with no library. Used by the item,
 * customer and vendor imports so a shop can upload the Excel file as it is, without "Save as CSV" first.
 * Reading the workbook directly also keeps long numbers whole: a CSV saved by Excel often turns a 15-digit IMEI into
 * 3.56789E+14, while the .xlsx file still holds every digit.
 */

const dec = new TextDecoder();

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open .xlsx files. Save the sheet as CSV and upload that.');
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([data as unknown as ArrayBuffer]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** The files inside a ZIP (an .xlsx is one), by name. Only the ones asked for are unpacked. */
async function unzip(buf: Uint8Array, want: (name: string) => boolean): Promise<Map<string, string>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file isn’t a valid .xlsx workbook. Open it in Excel and save it again, or save it as CSV.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = buf.subarray(start, start + size);
    if (method === 0) files.set(name, dec.decode(raw));
    else if (method === 8) files.set(name, dec.decode(await inflate(raw)));
    else throw new Error('This workbook uses a compression Excel files don’t normally use. Save it again from Excel, or as CSV.');
  }
  return files;
}

const unescape = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** All the text of an element, including rich-text runs (<r><t>…</t></r>), but not phonetic hints (<rPh>). */
const textOf = (x: string) => [...x.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)].map((m) => unescape(m[1] ?? '')).join('');

const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64); return n - 1; };

/** Rows of the first sheet as text (empty rows dropped). Numbers are kept exactly as stored, so IMEIs keep every digit. */
export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new Error('This is an old Excel 97–2003 (.xls) file. In Excel use File → Save As → Excel Workbook (.xlsx) or CSV, then upload that.');
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('This file isn’t a valid .xlsx workbook. Open it in Excel and save it again, or save it as CSV.');
  const meta = await unzip(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml');
  const wb = meta.get('xl/workbook.xml') ?? '';
  const rels = meta.get('xl/_rels/workbook.xml.rels') ?? '';
  // The first sheet in the workbook's tab order, wherever its file is.
  const rid = /<sheet\b[^>]*?\br:id="([^"]+)"/.exec(wb)?.[1] ?? /<sheet\b[^>]*?\bid="([^"]+)"/.exec(wb)?.[1];
  let target = rid ? new RegExp(`<Relationship\\b[^>]*?Id="${rid}"[^>]*?Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\b[^>]*?Target="([^"]+)"[^>]*?Id="${rid}"`).exec(rels)?.[1] : undefined;
  target = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`).replace(/\/\.\//g, '/') : 'xl/worksheets/sheet1.xml';
  const sheet = (await unzip(buf, (n) => n === target)).get(target!) ?? (await unzip(buf, (n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))).values().next().value;
  if (!sheet) throw new Error('No sheet found in this workbook.');
  const shared = [...(meta.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const at = ref ? colIndex(ref) : next;
      next = at + 1;
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const body = cm[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (t === 's') text = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') text = textOf(body);
      else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'e') text = '';
      else text = unescape(v ?? '');
      while (row.length < at) row.push('');
      row[at] = text;
    }
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  return rows;
}

/** The sheet as CSV text, for importers that take CSV. */
export async function xlsxToCsv(data: ArrayBuffer | Uint8Array): Promise<string> {
  const rows = await readXlsx(data);
  const width = Math.max(0, ...rows.map((r) => r.length));
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => Array.from({ length: width }, (_, i) => esc(r[i] ?? '')).join(',')).join('\r\n');
}

export const isXlsxName = (name: string) => /\.xlsx$/i.test(name);
export const isXlsName = (name: string) => /\.xls$/i.test(name);
