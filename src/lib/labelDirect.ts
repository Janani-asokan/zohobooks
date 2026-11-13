/**
 * Label printers straight from the phone app (no print screen): a 2/3/4-inch label printer paired over Bluetooth
 * (Android) or on the shop's Wi-Fi (Android and iPhone, raw port 9100). Each printed row is drawn from the same
 * preview the screen shows, at the printer's own dots, and sent in the printer's language (TSPL for TSC, Xprinter,
 * TVS…; ZPL for Zebra; ESC/POS raster for receipt printers used with labels). The printer is told the exact label size
 * and gap, so nothing is turned sideways or fitted onto 4 × 6 paper.
 */
import { btSupported } from './btPrinter';
import { isNativeApp, native } from './native';
import { helperPrint } from './pcHelper';
import { toMono } from './btPrinter';
import { dotsPerMm, rowWidthMm, type PrinterSettings, type StockGeometry } from '../../shared/labelEngine';

export type DirectConn = { kind: 'bt'; address: string; name: string } | { kind: 'net'; host: string; port: number } | { kind: 'pc'; printer: string };
const KEY = 'c360.labels.direct';

/** Phone app: Bluetooth / Wi-Fi straight from the phone. Website: through the Corpus360 Print Helper on this PC. */
export const directSupported = () => isNativeApp();
export const pcHelperSupported = () => !isNativeApp();
export const btLabelSupported = () => btSupported();

export function directConn(): DirectConn | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as DirectConn | null;
    if (directSupported()) {
      if (v?.kind === 'bt' && v.address && btSupported()) return v;
      if (v?.kind === 'net' && v.host) return { ...v, port: v.port || 9100 };
    } else if (v?.kind === 'pc' && v.printer) return v;
    return null;
  } catch { return null; }
}
export function setDirectConn(c: DirectConn | null) {
  try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event('c360:label-direct'));
}

/* ---------------- One row → printer dots ---------------- */

export interface RowBitmap { width: number; height: number; mono: Uint8Array }

/** Draws a printed row (the `.label-row` element) at the printer's dots: exactly rowWidth × label height. */
// The label font (Inter, bundled with the app) as embeddable CSS, made once. Without it the picture for the printer
// fell back to another font: text came out about 11% narrower than the preview and the print window.
let fontCss: Promise<string> | null = null;
async function labelFontCss(el: HTMLElement): Promise<string> {
  const { getFontEmbedCSS } = await import('html-to-image');
  fontCss ??= getFontEmbedCSS(el, { preferredFontFormat: 'woff2' }).catch(() => { fontCss = null; return ''; });
  return fontCss;
}

export async function rowBitmap(el: HTMLElement, stock: StockGeometry, dpi: number): Promise<RowBitmap> {
  const { toCanvas } = await import('html-to-image');
  const fontEmbedCSS = await labelFontCss(el);
  const dpm = dotsPerMm(dpi);
  const width = Math.round(rowWidthMm(stock) * dpm);
  const height = Math.round(stock.h * dpm);
  // Drawn straight at the printer's dots: the row's exact CSS size (mm → px) onto a canvas of exactly width × height
  // dots. (Drawing at the screen size and then squeezing it to the printer's width shifted thin bars by a dot halfway
  // along a barcode, so 2-dot EAN bars came out 1 and 3 dots wide and stopped scanning.)
  const pxW = (rowWidthMm(stock) * 96) / 25.4, pxH = (stock.h * 96) / 25.4;
  const canvas = await toCanvas(el, {
    width: pxW, height: pxH, canvasWidth: width, canvasHeight: height, pixelRatio: 1, backgroundColor: '#ffffff', cacheBust: false, fontEmbedCSS,
    style: { margin: '0', boxShadow: 'none', position: 'static', left: 'auto', top: 'auto', transform: 'none', outline: 'none', width: `${pxW}px`, height: `${pxH}px` },
  });
  const out = document.createElement('canvas');
  out.width = width; out.height = height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(canvas, 0, 0, width, height);
  return { width, height, mono: toMono(ctx.getImageData(0, 0, width, height).data, width, height) };
}

/**
 * Turns a row bitmap a quarter turn: 90 = clockwise, 270 = anticlockwise (as the print window's Turn 90° / 270°).
 * Used when the design reads along the roll ("vertical"): the printer is then told the turned size.
 */
export function rotateBitmap(b: RowBitmap, turn: 90 | 270): RowBitmap {
  const W = b.width, H = b.height, nw = H, nh = W;
  const sbpr = Math.ceil(W / 8), dbpr = Math.ceil(nw / 8);
  const out = new Uint8Array(dbpr * nh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!(b.mono[y * sbpr + (x >> 3)]! & (0x80 >> (x & 7)))) continue;
    const nx = turn === 90 ? H - 1 - y : y, ny = turn === 90 ? x : W - 1 - x;
    out[ny * dbpr + (nx >> 3)]! |= 0x80 >> (nx & 7);
  }
  return { width: nw, height: nh, mono: out };
}

/** Moves a bitmap by the printer's calibrated offset (dots), cropping what falls off. */
function shift(b: RowBitmap, dx: number, dy: number): RowBitmap {
  if (!dx && !dy) return b;
  const bpr = Math.ceil(b.width / 8);
  const out = new Uint8Array(b.mono.length);
  for (let y = 0; y < b.height; y++) {
    const sy = y - dy; if (sy < 0 || sy >= b.height) continue;
    for (let x = 0; x < b.width; x++) {
      const sx = x - dx; if (sx < 0 || sx >= b.width) continue;
      if (b.mono[sy * bpr + (sx >> 3)]! & (0x80 >> (sx & 7))) out[y * bpr + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { ...b, mono: out };
}

/* ---------------- Printer languages ---------------- */

const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
const concat = (parts: Uint8Array[]) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const mm = (v: number) => String(Math.round(v * 10) / 10);

/**
 * TSPL (TSC, Xprinter, TVS, Honeywell PC42, Gprinter…): the exact label size and gap, then each row as a BITMAP.
 * In TSPL bitmaps a 0 bit prints a dot, so the picture's bits are inverted. turn 180 flips the print direction for
 * printers that feed the other way round (90/270 are not needed: the printer is told the real size).
 */
export function tsplJob(rows: RowBitmap[], stock: StockGeometry, printer: PrinterSettings, turn = 0): Uint8Array {
  const gap = stock.media === 'continuous' ? 'GAP 0 mm,0 mm' : stock.media === 'black-mark' ? `BLINE ${mm(stock.rowGap)} mm,0 mm` : `GAP ${mm(stock.rowGap)} mm,0 mm`;
  // The label as it goes through the printer: the row as designed, or turned a quarter (then the bitmap is turned).
  const dpm0 = dotsPerMm(printer.dpi);
  const across = rows[0] ? rows[0].width / dpm0 : rowWidthMm(stock), along = rows[0] ? rows[0].height / dpm0 : stock.h;
  const head = [`SIZE ${mm(across)} mm,${mm(along)} mm`, gap, `DIRECTION ${turn === 180 ? 0 : 1},0`, 'REFERENCE 0,0', 'OFFSET 0 mm', 'SET TEAR ON',
    `DENSITY ${Math.max(0, Math.min(15, Math.round(printer.darkness)))}`, `SPEED ${Math.max(1, Math.min(6, Math.round(printer.speed)))}`, ''].join('\r\n');
  const dpm = dotsPerMm(printer.dpi);
  const parts: Uint8Array[] = [ascii(head)];
  for (const r0 of rows) {
    const r = shift(r0, Math.round(printer.offsetX * dpm), Math.round(printer.offsetY * dpm));
    const bpr = Math.ceil(r.width / 8);
    const inv = new Uint8Array(r.mono.length);
    for (let i = 0; i < inv.length; i++) inv[i] = ~r.mono[i]! & 0xff;
    // Bits past the row's last dot stay white.
    const spare = bpr * 8 - r.width;
    if (spare) for (let y = 0; y < r.height; y++) inv[y * bpr + bpr - 1]! |= (1 << spare) - 1;
    parts.push(ascii(`CLS\r\nBITMAP 0,0,${bpr},${r.height},0,`), inv, ascii('\r\nPRINT 1,1\r\n'));
  }
  return concat(parts);
}

/** ZPL (Zebra): each row as one ^GFA graphic, with the label width and length set. */
export function zplJob(rows: RowBitmap[], printer: PrinterSettings, turn = 0): Uint8Array {
  const dpm = dotsPerMm(printer.dpi);
  const out: string[] = [];
  for (const r0 of rows) {
    const r = shift(r0, Math.round(printer.offsetX * dpm), Math.round(printer.offsetY * dpm));
    const bpr = Math.ceil(r.width / 8);
    let hex = '';
    for (let i = 0; i < r.mono.length; i++) hex += r.mono[i]!.toString(16).padStart(2, '0').toUpperCase();
    out.push(`^XA^PW${r.width}^LL${r.height}^LH0,0^PO${turn === 180 ? 'I' : 'N'}~SD${String(Math.min(30, Math.round(printer.darkness * 2))).padStart(2, '0')}^FO0,0^GFA,${r.mono.length},${r.mono.length},${bpr},${hex}^FS^PQ1^XZ`);
  }
  return ascii(out.join('\n') + '\n');
}

/** ESC/POS (receipt printers used for continuous labels): rows as raster, a short feed after the last. */
export function escposLabelJob(rows: RowBitmap[]): Uint8Array {
  const parts: number[] = [0x1b, 0x40];
  for (const r of rows) {
    const bpr = Math.ceil(r.width / 8);
    parts.push(0x1d, 0x76, 0x30, 0x00, bpr & 0xff, bpr >> 8, r.height & 0xff, r.height >> 8);
    for (let i = 0; i < r.mono.length; i++) parts.push(r.mono[i]!);
  }
  parts.push(0x1b, 0x64, 0x03);
  return Uint8Array.from(parts);
}

export function labelJobBytes(rows: RowBitmap[], stock: StockGeometry, printer: PrinterSettings, turn = 0): Uint8Array {
  if (printer.language === 'zpl') return zplJob(rows, printer, turn);
  if (printer.language === 'escpos') return escposLabelJob(rows);
  return tsplJob(rows, stock, printer, turn);   // 'tspl', and 'browser' profiles sent directly: most label printers speak TSPL
}

const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

export async function sendDirect(conn: DirectConn, bytes: Uint8Array) {
  if (conn.kind === 'pc') await helperPrint(conn.printer, bytes);
  else if (conn.kind === 'bt') await native('btPrint', { address: conn.address, data: b64(bytes) });
  else await native('netPrint', { host: conn.host, port: conn.port || 9100, data: b64(bytes) });
}

/** Prints the rows now in the hidden print area (`.lb-print .label-row`), a few rows per send. */
export async function printRowsDirect(container: ParentNode, stock: StockGeometry, printer: PrinterSettings, conn: DirectConn, turn = 0): Promise<number> {
  const els = [...container.querySelectorAll<HTMLElement>('.label-row')];
  if (!els.length) throw new Error('Nothing to print');
  const PER_SEND = 10;
  let sent = 0;
  for (let i = 0; i < els.length; i += PER_SEND) {
    const rows: RowBitmap[] = [];
    for (const el of els.slice(i, i + PER_SEND)) {
      const r = await rowBitmap(el, stock, printer.dpi);
      rows.push(turn === 90 || turn === 270 ? rotateBitmap(r, turn) : r);
    }
    const acrossMm = rows[0]!.width / dotsPerMm(printer.dpi);
    if (acrossMm > printer.headMm + 0.5) throw new Error(`Turned ${turn}°, these labels are ${mm(acrossMm)} mm across the printer, wider than it prints (${printer.headMm} mm). Choose “As shown”.`);
    await sendDirect(conn, labelJobBytes(rows, stock, printer, turn));
    sent += rows.length;
  }
  return sent;
}
