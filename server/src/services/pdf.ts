import { chromium, type Browser } from 'playwright-core';
import { config } from '../config';
import { renderToken } from './printBundle';

export type PdfPaper = 'a4' | 'a5' | 'thermal';

let browser: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let active = 0;
const waiting: Array<() => void> = [];
const MAX_PAGES = 2;

const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none', '--no-zygote', '--disable-extensions', '--mute-audio', '--no-first-run'];

/**
 * Starts headless Chromium. Tries Playwright's own headless shell first (always the version this library expects),
 * then the configured or system Chromium, so a distro browser update can't break PDFs.
 */
async function launch(): Promise<Browser> {
  const candidates = [...new Set(['bundled', config.pdf.chromiumPath, '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean))];
  const errors: string[] = [];
  for (const c of candidates) {
    try { return await chromium.launch({ args: ARGS, timeout: 45_000, ...(c === 'bundled' ? {} : { executablePath: c }) }); }
    catch (e) { errors.push(`${c}: ${(e as Error).message.split('\n')[0]}`); }
  }
  throw new Error(errors.join(' | '));
}

function getBrowser() {
  if (!browser) {
    const launching = launch()
      .then((b) => { b.on('disconnected', () => { if (browser === launching) browser = null; }); return b; })
      .catch((e) => { if (browser === launching) browser = null; console.error('[pdf] could not start Chromium:', (e as Error).message); throw e; });
    browser = launching;
  }
  return browser;
}

/** The browser is closed after a minute without work so a small instance keeps its memory. */
function scheduleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (active > 0 || !browser) return;
    const b = browser; browser = null;
    (await b.catch(() => null))?.close().catch(() => {});
  }, 60_000);
  idleTimer.unref();
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PAGES) await new Promise<void>((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); scheduleClose(); }
}

export class PdfUnavailableError extends Error {}

/**
 * Renders /invoices/:id/print in headless Chromium and prints it to PDF. The browser applies the page's own
 * @page rules (size, margins, "Page X of Y"), so the file matches what the print dialog produces.
 */
export async function invoicePdf(shopId: string, invoiceId: string, paper: PdfPaper): Promise<Buffer> {
  const url = `${config.pdf.renderOrigin}/invoices/${invoiceId}/print?paper=${paper}&rt=${encodeURIComponent(renderToken(shopId, invoiceId))}`;
  return slot(async () => {
    try {
      return await render(url, paper);
    } catch (e) {
      if (e instanceof PdfUnavailableError) throw e;
      // A crashed or idle-closed browser: start a fresh one and try once more.
      browser = null;
      return render(url, paper);
    }
  });
}

async function render(url: string, paper: PdfPaper): Promise<Buffer> {
  let b: Browser;
  try { b = await getBrowser(); } catch (e) { throw new PdfUnavailableError(`PDF renderer not available: ${(e as Error).message.split('\n')[0]}`); }
  // Receipts are laid out at roll width so the measured height matches the printed one.
  const ctx = await b.newContext({ viewport: { width: paper === 'thermal' ? 302 : 900, height: 1200 }, colorScheme: 'light', serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForFunction('window.__PRINT_READY', null, { timeout: 15_000 });
    const state = await page.evaluate<boolean | string>('window.__PRINT_READY');
    if (state !== true) throw new Error(`Print page failed: ${state}`);
    await page.emulateMedia({ media: 'print' });
    if (paper === 'thermal') {
      const width = await page.evaluate<number>("Math.ceil(document.querySelector('.print-doc .receipt').getBoundingClientRect().width)");
      if (width < 280) await page.setViewportSize({ width: 219, height: 1200 }); // 58 mm roll
      const height = await page.evaluate<number>("Math.ceil(document.querySelector('.print-doc').getBoundingClientRect().bottom)");
      // One continuous page the length of the receipt, like a cut roll.
      await page.addStyleTag({ content: `@page { size: ${width < 280 ? 58 : 80}mm ${height + 8}px; margin: 0; }` });
    }
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Prints a self-contained HTML document (reports, statements) to an A4 PDF with page numbers. */
export async function htmlPdf(html: string, landscape = false): Promise<Buffer> {
  const run = async () => {
    let b: Browser;
    try { b = await getBrowser(); } catch (e) { throw new PdfUnavailableError(`PDF renderer not available: ${(e as Error).message.split('\n')[0]}`); }
    const ctx = await b.newContext({ colorScheme: 'light', serviceWorkers: 'block', javaScriptEnabled: false, offline: true });
    try {
      const page = await ctx.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
      return await page.pdf({
        format: 'A4', landscape, printBackground: true, margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
        displayHeaderFooter: true, headerTemplate: '<span></span>',
        footerTemplate: '<div style="width:100%;font:8px sans-serif;color:#666;padding:0 12mm;display:flex;justify-content:space-between"><span>Corpus360</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
      });
    } finally {
      await ctx.close().catch(() => {});
    }
  };
  return slot(async () => {
    try { return await run(); } catch (e) { if (e instanceof PdfUnavailableError) throw e; browser = null; return run(); }
  });
}
