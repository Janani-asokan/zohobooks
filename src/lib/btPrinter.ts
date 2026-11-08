/**
 * Bluetooth receipt printers in the Android app (the 58 / 80 mm printers most phone counters use).
 * The receipt on screen is turned into a picture at the printer's dot width and sent as ESC/POS raster commands, so
 * whatever the screen shows prints the same: Tamil/Hindi names, ₹, the logo and the UPI QR, with no font set-up.
 * The printer is paired once in the phone's Bluetooth settings and chosen once in the app (kept on this phone).
 */
import { isNativeApp, native, nativePlatform } from './native';

export interface BtPrinter { address: string; name: string; widthMm: 58 | 80 }
export interface BtDevice { address: string; name: string; printer?: boolean }

const KEY = 'c360.app.btPrinter';
/** Dots across the printable width: 48 mm on a 58 mm roll, 72 mm on an 80 mm roll, at 8 dots/mm. */
export const printerDots = (widthMm: 58 | 80) => (widthMm === 80 ? 576 : 384);

/** Bluetooth printing needs the Android app (iPhones only talk to certified accessories). */
export const btSupported = () => isNativeApp() && nativePlatform() === 'android';

export function btPrinter(): BtPrinter | null {
  if (!btSupported()) return null;
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return v?.address ? v : null; } catch { return null; }
}
export function setBtPrinter(p: BtPrinter | null) {
  try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event('c360:bt-printer'));
}

export async function listBtDevices(): Promise<BtDevice[]> {
  const r = await native<{ devices: BtDevice[] }>('btList');
  return [...r.devices].sort((a, b) => Number(!!b.printer) - Number(!!a.printer) || a.name.localeCompare(b.name));
}

/* ---------------- Picture → ESC/POS ---------------- */

/** One-bit rows (1 = black) from RGBA pixels, threshold on lightness; transparent counts as white. */
export function toMono(rgba: Uint8ClampedArray, width: number, height: number, threshold = 170): Uint8Array {
  const bpr = Math.ceil(width / 8);
  const out = new Uint8Array(bpr * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3]! / 255;
      const lum = (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) * a + 255 * (1 - a);
      if (lum < threshold) out[y * bpr + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/** Trims blank rows at the top and bottom (the receipt's padding), keeping a few. */
function trimRows(mono: Uint8Array, bpr: number, height: number, keep = 8): { data: Uint8Array; height: number } {
  const blank = (y: number) => { for (let i = y * bpr; i < (y + 1) * bpr; i++) if (mono[i]) return false; return true; };
  let top = 0; while (top < height && blank(top)) top++;
  let bottom = height; while (bottom > top && blank(bottom - 1)) bottom--;
  if (top >= bottom) return { data: new Uint8Array(0), height: 0 };
  top = Math.max(0, top - keep); bottom = Math.min(height, bottom + keep);
  return { data: mono.slice(top * bpr, bottom * bpr), height: bottom - top };
}

/** ESC/POS: initialise, the picture in bands (GS v 0), feed past the cutter, cut. */
export function escposRaster(mono: Uint8Array, width: number, height: number): Uint8Array {
  const bpr = Math.ceil(width / 8);
  const t = trimRows(mono, bpr, height);
  const parts: number[] = [0x1b, 0x40];
  const BAND = 128;
  for (let y = 0; y < t.height; y += BAND) {
    const h = Math.min(BAND, t.height - y);
    parts.push(0x1d, 0x76, 0x30, 0x00, bpr & 0xff, bpr >> 8, h & 0xff, h >> 8);
    for (let i = y * bpr; i < (y + h) * bpr; i++) parts.push(t.data[i]!);
  }
  parts.push(0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00);
  return Uint8Array.from(parts);
}

const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/** The receipt element as a picture exactly `dots` wide. */
export async function receiptPicture(el: HTMLElement, dots: number): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const { toCanvas } = await import('html-to-image');
  const w = el.getBoundingClientRect().width || el.offsetWidth;
  const canvas = await toCanvas(el, {
    pixelRatio: dots / w, backgroundColor: '#ffffff', cacheBust: false,
    // Printers have no colour: drop the on-screen frame and shadow.
    style: { margin: '0', border: 'none', boxShadow: 'none', borderRadius: '0', position: 'static', left: 'auto', top: 'auto', transform: 'none' },
  });
  // Rounding can leave the canvas a dot off; draw it onto exactly `dots`.
  const out = document.createElement('canvas');
  out.width = dots; out.height = Math.round(canvas.height * (dots / canvas.width));
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return { rgba: ctx.getImageData(0, 0, out.width, out.height).data, width: out.width, height: out.height };
}

export async function receiptBytes(el: HTMLElement, widthMm: 58 | 80): Promise<Uint8Array> {
  const dots = printerDots(widthMm);
  const pic = await receiptPicture(el, dots);
  return escposRaster(toMono(pic.rgba, pic.width, pic.height), pic.width, pic.height);
}

/** Prints a receipt element on the chosen Bluetooth printer. */
export async function btPrintReceipt(el: Element | null, p: BtPrinter = btPrinter()!) {
  if (!el) throw new Error('Nothing to print');
  const bytes = await receiptBytes(el as HTMLElement, p.widthMm);
  await native('btPrint', { address: p.address, data: b64(bytes) });
}

/** A test slip for the printer settings. */
export async function btTestPrint(p: BtPrinter) {
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:-10000px;top:0;width:${p.widthMm === 80 ? 72 : 48}mm;background:#fff;color:#000;font:13px/1.5 Inter,Arial,sans-serif;padding:2mm 0;`;
  box.innerHTML = `<div style="text-align:center;font-weight:700;font-size:16px">Corpus360 printer test</div>
    <div style="text-align:center">${p.name} · ${p.widthMm} mm</div><hr style="border:0;border-top:1px dashed #000">
    <div style="display:flex;justify-content:space-between"><span>Item</span><span>₹ 123.45</span></div>
    <div>தமிழ் · हिन्दी · ಕನ್ನಡ · తెలుగు</div>
    <div style="text-align:center;margin-top:4px">If this prints clearly, receipts will too.</div>`;
  document.body.appendChild(box);
  try { await btPrintReceipt(box, p); } finally { box.remove(); }
}
