import type { PaperSize } from '../../shared/printSettings';

export type PrintPaper = 'a4' | 'a5' | 'thermal';
/** Thermal roll width: '2in' = 58 mm, '3in' = 80 mm. Omitted = the shop's Print settings. */
export type Roll = PaperSize;

const query = (paper: PrintPaper, roll?: Roll) => `paper=${paper}${paper === 'thermal' && roll ? `&roll=${roll}` : ''}`;
export const printRoute = (id: string, paper: PrintPaper, roll?: Roll) => `/invoices/${id}/print?${query(paper, roll)}`;
export const pdfUrl = (id: string, paper: PrintPaper, roll?: Roll) => `/api/shop/invoices/${id}/pdf?${query(paper, roll)}`;

/** The frame couldn't load (blocked or too slow): open the print view in a tab instead. */
class FrameUnavailable extends Error {}

interface Prepared { frame: HTMLIFrameElement; ready: Promise<void>; drop: () => void; claim: () => void }
const prepared = new Map<string, Prepared>();
const UNUSED_TTL = 60_000;

/** Loads the standalone print route in a hidden iframe and resolves once its document (data, QR codes, fonts) is ready. */
function load(id: string, paper: PrintPaper, roll?: Roll): Prepared {
  const key = `${id}|${query(paper, roll)}`;
  const hit = prepared.get(key);
  if (hit) return hit;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  let listeners = () => {};
  const expiry = setTimeout(() => entry.drop(), UNUSED_TTL);
  const entry: Prepared = {
    frame,
    ready: new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new FrameUnavailable('timeout')), 15_000);
      const onMessage = (e: MessageEvent) => {
        if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
        if (e.data?.type === 'corpus360:print-error') reject(new Error(e.data.message));
        if (e.data?.type === 'corpus360:print-ready') resolve();
      };
      // A frame blocked by the page's security policy never loads; don't wait for the timeout.
      const onViolation = (e: SecurityPolicyViolationEvent) => { if (e.effectiveDirective === 'frame-src' && e.blockedURI.includes('/print')) reject(new FrameUnavailable('blocked')); };
      window.addEventListener('message', onMessage);
      document.addEventListener('securitypolicyviolation', onViolation);
      listeners = () => { clearTimeout(timer); window.removeEventListener('message', onMessage); document.removeEventListener('securitypolicyviolation', onViolation); };
    }),
    drop: () => { clearTimeout(expiry); listeners(); if (prepared.get(key) === entry) prepared.delete(key); frame.remove(); },
    // Each print uses its frame once, so the next one shows any change made since.
    claim: () => { clearTimeout(expiry); if (prepared.get(key) === entry) prepared.delete(key); },
  };
  entry.ready.then(listeners, () => entry.drop());
  prepared.set(key, entry);
  frame.src = `${printRoute(id, paper, roll)}&embed=1`;
  document.body.appendChild(frame);
  return entry;
}

/** Starts loading a print in the background (e.g. when the Print menu opens) so the click itself is instant. */
export function preparePrint(id: string, paper: PrintPaper, roll?: Roll) {
  try { load(id, paper, roll); } catch { /* printing still works without the head start */ }
}

/**
 * Prints the standalone print route from a hidden iframe, so the browser dialog gets exactly the document the
 * server PDF is made from, with its own @page size. Falls back to opening the route in a new tab.
 */
export async function printInvoice(id: string, paper: PrintPaper, roll?: Roll): Promise<void> {
  const p = load(id, paper, roll);
  p.claim();
  try {
    await p.ready;
  } catch (e) {
    p.drop();
    if (e instanceof FrameUnavailable) { window.open(`${printRoute(id, paper, roll)}&autoprint=1`, '_blank', 'noopener'); return; }
    throw e;
  }
  const w = p.frame.contentWindow!;
  w.addEventListener('afterprint', () => setTimeout(p.drop, 1000), { once: true });
  setTimeout(p.drop, 60_000);
  w.focus();
  w.print();
}
