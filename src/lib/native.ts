/**
 * CorpusLite on a phone: what a browser does by itself but a phone's web view doesn't, done through the app's own
 * native plugin (mobile/…/C360NativePlugin):
 *  - window.print() → the phone's print screen (Android print / AirPrint), with the page size the page asks for;
 *  - prints from hidden frames (invoices, reports) → the frame's page is copied in and printed the same way;
 *  - downloads (PDF, CSV, Excel) → saved on the phone and offered to WhatsApp, Drive, Files…;
 *  - links to other sites and apps (WhatsApp, maps, UPI, phone, mail) → opened in the phone's own apps.
 * On the website none of this is installed.
 */
import { IS_APP } from './platform';

type Cap = { isNativePlatform?: () => boolean; getPlatform?: () => string; nativePromise?: <T>(plugin: string, method: string, opts?: object) => Promise<T> };
const cap = (): Cap | undefined => (window as unknown as { Capacitor?: Cap }).Capacitor;

/** Running inside the Android or iOS app (not the app build opened in a browser for tests). */
export const isNativeApp = (): boolean => IS_APP && !!cap()?.isNativePlatform?.();
export const nativePlatform = (): string => (isNativeApp() ? cap()!.getPlatform?.() ?? '' : 'web');

export function native<T = unknown>(method: string, opts: object = {}): Promise<T> {
  const c = cap();
  if (!c?.nativePromise) return Promise.reject(new Error('Not available outside the app'));
  return c.nativePromise<T>('C360Native', method, opts);
}

/* ---------------- Page size ---------------- */

const NAMED: Record<string, [number, number]> = { a4: [210, 297], a5: [148, 210], a3: [297, 420], letter: [215.9, 279.4] };
/** The @page size the document asks for (the last rule wins, as in a browser), in mm. */
export function pageSizeMm(doc: Document): { widthMm: number; heightMm: number } | null {
  let found: { widthMm: number; heightMm: number } | null = null;
  for (const s of doc.querySelectorAll('style')) {
    for (const m of (s.textContent ?? '').matchAll(/@page\s*{[^}]*?size:\s*([^;}]+)/gi)) {
      const v = m[1].trim().toLowerCase();
      const mm = v.match(/^([\d.]+)mm\s+([\d.]+)mm/);
      if (mm) { found = { widthMm: Number(mm[1]), heightMm: Number(mm[2]) }; continue; }
      const named = v.match(/^(a4|a5|a3|letter)\b/);
      if (named) {
        const [w, h] = NAMED[named[1]];
        found = /landscape/.test(v) ? { widthMm: h, heightMm: w } : { widthMm: w, heightMm: h };
      }
    }
  }
  return found;
}

/* ---------------- Printing ---------------- */

let printing: Promise<void> | null = null;
/** Prints this page through the phone's print screen. beforeprint/afterprint fire as in a browser. */
export function nativePrint(name = document.title || 'Corpus360'): Promise<void> {
  if (printing) return printing;
  window.dispatchEvent(new Event('beforeprint'));
  const size = pageSizeMm(document);
  printing = native<void>('print', { name, ...(size ?? {}) })
    .catch((e) => { window.dispatchEvent(new CustomEvent('c360:native-error', { detail: (e as Error).message })); })
    .finally(() => { printing = null; window.dispatchEvent(new Event('afterprint')); });
  return printing;
}

/** Copies a frame's page (an invoice print view, a report) into this page and prints it. */
export async function printFrame(w: Window): Promise<void> {
  const doc = w.document;
  w.dispatchEvent(new Event('beforeprint'));
  document.getElementById('print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  const source = doc.body;
  for (const n of source.childNodes) {
    if (n.nodeName === 'SCRIPT') continue;
    root.appendChild(document.importNode(n, true));
  }
  // A copied canvas is blank: carry its picture over as an image.
  const from = source.querySelectorAll('canvas'); const to = root.querySelectorAll('canvas');
  from.forEach((c, i) => { try { const img = document.createElement('img'); img.src = c.toDataURL(); img.style.cssText = c.style.cssText; img.className = c.className; to[i]?.replaceWith(img); } catch { /* tainted */ } });
  root.querySelectorAll('script, iframe').forEach((x) => x.remove());
  // The frame's own styles apply only while printing, so the screen behind the print dialog doesn't change.
  const added: HTMLElement[] = [];
  for (const s of doc.querySelectorAll('style')) {
    const el = document.createElement('style');
    el.textContent = `@media print { ${s.textContent ?? ''} }`;
    document.head.appendChild(el); added.push(el);
  }
  const page = pageSizeMm(doc);
  if (page) { const el = document.createElement('style'); el.textContent = `@media print { @page { size: ${page.widthMm}mm ${page.heightMm}mm; } }`; document.head.appendChild(el); added.push(el); }
  document.body.appendChild(root);
  // The frame's page classes (e.g. print-route) carry its print layout rules.
  const classes = [...source.classList].filter((c) => !document.body.classList.contains(c));
  document.body.classList.add('printing', ...classes);
  try {
    await nativePrint(doc.title || document.title);
  } finally {
    root.remove(); added.forEach((x) => x.remove()); document.body.classList.remove('printing', ...classes);
    w.dispatchEvent(new Event('afterprint'));
  }
}

/** w.print() on the website; on the phone the frame is printed through the app. */
export function printWindow(w: Window) {
  if (isNativeApp()) void printFrame(w);
  else { w.focus(); w.print(); }
}

/* ---------------- Files ---------------- */

const toBase64 = (blob: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

/** Saves a file on the phone and opens the share screen. */
export async function shareFile(blob: Blob, name: string) {
  await native('share', { name, mime: blob.type || 'application/octet-stream', data: await toBase64(blob) });
}
/** Prints a PDF (e.g. the server's invoice PDF) through the phone's print screen. */
export async function printPdfBlob(blob: Blob, name: string) {
  await native('printPdf', { name, data: await toBase64(blob) });
}

/* ---------------- Links ---------------- */

const external = (href: string) => {
  try {
    const u = new URL(href, location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin !== location.origin;
    return !['blob:', 'data:', 'javascript:', 'about:'].includes(u.protocol);
  } catch { return false; }
};
export const openExternal = (url: string) => native('openUrl', { url }).catch(() => undefined);

/** In-app route change, as a link click would (React Router listens to popstate). */
function goInApp(href: string) {
  const u = new URL(href, location.href);
  history.pushState(null, '', u.pathname + u.search + u.hash);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/* ---------------- Install ---------------- */

export function installNativeBridges() {
  if (!IS_APP) return;
  // Inside a print frame: hand the print to the page that holds the frame.
  if (window !== window.top) {
    const top = window.top as unknown as { __c360PrintFrame?: (w: Window) => Promise<void> } | null;
    if (top?.__c360PrintFrame) window.print = () => { void top.__c360PrintFrame!(window); };
    return;
  }
  if (!isNativeApp()) return;
  document.documentElement.classList.add('native-app', `native-${nativePlatform()}`);
  (window as unknown as { __c360PrintFrame: typeof printFrame }).__c360PrintFrame = printFrame;
  window.print = () => { void nativePrint(); };

  // Downloads: every <a download> click (blob or data link) becomes save-and-share.
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.download && /^(blob|data):/.test(this.href)) {
      const name = this.download;
      fetch(this.href).then((r) => r.blob()).then((b) => shareFile(b, name))
        .catch((e) => window.dispatchEvent(new CustomEvent('c360:native-error', { detail: (e as Error).message })));
      return;
    }
    if (external(this.href)) { void openExternal(this.href); return; }
    return click.call(this);
  };
  // Tapped links to other sites and apps open in the phone's apps (the web view can't open new windows).
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || e.defaultPrevented) return;
    if (a.download && /^(blob|data):/.test(a.href)) { e.preventDefault(); HTMLAnchorElement.prototype.click.call(a); return; }
    if (external(a.href)) { e.preventDefault(); void openExternal(a.href); return; }
    if (a.target === '_blank') { e.preventDefault(); goInApp(a.href); }
  }, true);
  window.open = ((url?: string | URL) => {
    if (!url) return null;
    const href = String(url);
    if (external(href)) void openExternal(href); else goInApp(href);
    return null;
  }) as typeof window.open;
}
