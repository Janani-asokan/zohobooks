export type PrintPaper = 'a4' | 'a5' | 'thermal';

export const printRoute = (id: string, paper: PrintPaper) => `/invoices/${id}/print?paper=${paper}`;
export const pdfUrl = (id: string, paper: PrintPaper) => `/api/shop/invoices/${id}/pdf?paper=${paper}`;

/**
 * Prints the standalone print route from a hidden iframe, so the browser dialog gets exactly the document the
 * server PDF is made from, with its own @page size. Falls back to opening the route in a new tab.
 */
export function printInvoice(id: string, paper: PrintPaper): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
    let settled = false;
    const cleanup = () => { window.removeEventListener('message', onMessage); setTimeout(() => frame.remove(), 1000); };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true; cleanup();
      window.open(`${printRoute(id, paper)}&autoprint=1`, '_blank', 'noopener');
      resolve();
    }, 20_000);
    function onMessage(e: MessageEvent) {
      if (e.source !== frame.contentWindow || e.origin !== location.origin || settled) return;
      if (e.data?.type === 'kanakku:print-error') { settled = true; clearTimeout(timer); cleanup(); reject(new Error(e.data.message)); }
      if (e.data?.type !== 'kanakku:print-ready') return;
      settled = true; clearTimeout(timer);
      const w = frame.contentWindow!;
      w.addEventListener('afterprint', cleanup, { once: true });
      w.focus();
      w.print();
      setTimeout(cleanup, 60_000);
      resolve();
    }
    window.addEventListener('message', onMessage);
    frame.src = `${printRoute(id, paper)}&embed=1`;
    document.body.appendChild(frame);
  });
}
