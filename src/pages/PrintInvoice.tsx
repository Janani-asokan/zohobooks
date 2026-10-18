import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, FileX, Loader2, Printer } from 'lucide-react';
import type { Invoice } from '@/api/types';
import { TaxInvoice, type PrintBranch, type PrintOrg } from '@/components/TaxInvoice';
import { ThermalReceipt, receiptFromInvoice } from '@/components/printing';
import { Segmented } from '@/components/ui';
import { withPrintDefaults, type PrintSettings } from '../../shared/printSettings';

export type Paper = 'a4' | 'a5' | 'thermal';
interface Bundle { invoice: Invoice; org: PrintOrg; branch: PrintBranch | null; settings: PrintSettings }

declare global { interface Window { __PRINT_READY?: boolean | string } }

const PAGE_MARGIN: Record<Exclude<Paper, 'thermal'>, string> = { a4: '14mm 13mm 16mm', a5: '10mm 10mm 13mm' };
const cssString = (s: string) => `"${s.replace(/["\\]/g, '\\$&').replace(/\n/g, ' ')}"`;

/** @page rules for the chosen paper, with "Page X of Y" in the bottom margin (Chrome, Edge; Firefox adds its own). */
function pageCss(paper: Paper, label: string, thermalMm: number) {
  if (paper === 'thermal') return `@page { size: ${thermalMm}mm auto; margin: 0; }`;
  const margin = PAGE_MARGIN[paper];
  const box = 'font-family: Inter, sans-serif; font-size: 7.5pt; color: #555;';
  return `@page { size: ${paper.toUpperCase()} portrait; margin: ${margin};
    @bottom-left { content: ${cssString(label)}; ${box} }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); ${box} } }`;
}

async function loadBundle(id: string, rt: string | null, share: string | null): Promise<Bundle> {
  const url = rt ? `/api/public/render/invoices/${id}?rt=${encodeURIComponent(rt)}` : share ? `/api/public/invoices/${share}` : `/api/shop/invoices/${id}/print-data`;
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (res.status === 401) throw Object.assign(new Error('Sign in to view this invoice'), { status: 401 });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Invoice not found');
  const b = await res.json();
  return { ...b, settings: withPrintDefaults(b.settings) };
}

/** Standalone print route: /invoices/:id/print?paper=a4|a5|thermal. Renders only the document. */
export default function PrintInvoice() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const rt = params.get('rt');
  const share = params.get('share');
  const embedded = !!rt || params.get('embed') === '1';
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readyFor, setReadyFor] = useState<Paper | null>(null);
  const paper = (['a4', 'a5', 'thermal'].includes(params.get('paper') ?? '') ? params.get('paper') : data?.settings.invoice.paper ?? 'a4') as Paper;

  useLayoutEffect(() => {
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    document.body.classList.add('print-route');
    root.setAttribute('data-theme', 'light');
    window.__PRINT_READY = false;
    return () => {
      document.body.classList.remove('print-route');
      if (prevTheme) root.setAttribute('data-theme', prevTheme); else root.removeAttribute('data-theme');
    };
  }, []);

  useEffect(() => {
    let alive = true;
    loadBundle(id, rt, share)
      .then((b) => alive && setData(b))
      .catch((e: Error & { status?: number }) => {
        if (!alive) return;
        if (e.status === 401 && !embedded) return navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
        setError(e.message);
        window.__PRINT_READY = e.message;
        if (embedded) window.parent?.postMessage({ type: 'kanakku:print-error', message: e.message }, location.origin);
      });
    return () => { alive = false; };
  }, [id, rt, share]);

  const inv = data?.invoice;
  const label = inv ? `${inv.number ?? 'Draft'} · ${data!.org.companyName}` : '';
  const thermalMm = data?.settings.thermal.paper === '2in' ? 58 : 80;

  useEffect(() => {
    if (!inv) return;
    document.title = `${inv.number ?? 'Draft invoice'} · ${data!.org.companyName}`;
    const style = document.createElement('style');
    style.dataset.print = 'page';
    style.textContent = pageCss(paper, label, thermalMm);
    document.head.appendChild(style);
    return () => style.remove();
  }, [inv?.id, paper, label, thermalMm]);

  const onDocReady = useCallback(() => setReadyFor(paper), [paper]);
  const docReady = paper === 'thermal' || readyFor === paper;

  // Ready = data, QR codes, images and fonts are all in. The PDF renderer and the in-app print iframe wait for this.
  useEffect(() => {
    if (!data || !docReady) return;
    let alive = true;
    const imgs = [...document.querySelectorAll<HTMLImageElement>('.print-doc img')];
    Promise.all([document.fonts?.ready, ...imgs.map((i) => (i.complete ? null : i.decode().catch(() => null)))]).then(() => {
      if (!alive) return;
      window.__PRINT_READY = true;
      if (embedded && !rt) window.parent?.postMessage({ type: 'kanakku:print-ready' }, location.origin);
      if (params.get('autoprint') === '1') setTimeout(() => window.print(), 50);
    });
    return () => { alive = false; };
  }, [data, docReady]);

  const doc = useMemo(() => {
    if (!data || !inv) return null;
    if (paper === 'thermal')
      return <div className="print-doc"><ThermalReceipt data={receiptFromInvoice(inv, [], undefined, undefined)} org={data.org} s={data.settings.thermal} /></div>;
    return <TaxInvoice inv={inv} org={data.org} branch={data.branch} s={data.settings.invoice} paper={paper} onReady={onDocReady} />;
  }, [data, paper, onDocReady]);

  if (error)
    return (
      <div className="print-shell">
        <div className="empty-state" style={{ paddingTop: 96 }}>
          <FileX size={28} />
          <h3>Can’t show this invoice</h3>
          <p>{error}</p>
          {!embedded && <Link to="/app/sales/invoices" className="btn btn-secondary">Back to invoices</Link>}
        </div>
      </div>
    );

  const pdfHref = share ? `/api/public/invoices/${share}/pdf` : `/api/shop/invoices/${id}/pdf?paper=${paper}`;
  return (
    <div className="print-shell">
      {!embedded && (
        <div className="print-bar">
          {!share && <button className="icon-btn" onClick={() => (history.length > 1 ? navigate(-1) : navigate(`/app/sales/invoices/${id}`))} aria-label="Back"><ArrowLeft size={18} /></button>}
          <div className="strong" style={{ fontSize: 14 }}>{inv?.number ?? (inv ? 'Draft invoice' : '')}</div>
          <div className="grow" />
          {!share && <Segmented value={paper} onChange={(v) => { params.set('paper', v); setParams(params, { replace: true }); }} options={[{ value: 'a4', label: 'A4' }, { value: 'a5', label: 'A5' }, { value: 'thermal', label: '80mm' }]} />}
          <a className="btn btn-secondary" href={pdfHref}><Download size={15} /> PDF</a>
          <button className="btn btn-primary" onClick={() => window.print()} disabled={!data}><Printer size={15} /> Print</button>
        </div>
      )}
      <div className="print-page">{doc ?? <div className="row muted" style={{ gap: 8, padding: 48 }}><Loader2 size={16} className="spin" /> Preparing invoice…</div>}</div>
    </div>
  );
}
