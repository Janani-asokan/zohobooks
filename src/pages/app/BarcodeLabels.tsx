import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tag } from 'lucide-react';
import type { JobRow } from '@/components/labels/labelsApi';
import Workbench from './labels/Workbench';

const BarcodesTab = lazy(() => import('./labels/BarcodesTab'));
const TemplatesTab = lazy(() => import('./labels/TemplatesTab'));
const StockPrinters = lazy(() => import('./labels/StockPrinters'));
const HistoryTab = lazy(() => import('./labels/HistoryTab'));

const TABS = [
  { id: 'print', label: 'Print Workbench' },
  { id: 'barcodes', label: 'Barcodes' },
  { id: 'templates', label: 'Templates' },
  { id: 'stock', label: 'Stock & Printers' },
  { id: 'history', label: 'History' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * Inventory › Barcode & Labels: the one place to manage barcodes, design labels and run print jobs. Every Print
 * labels action in the app (items, purchase orders, bills) opens the Workbench here with its lines filled in.
 */
export default function BarcodeLabels() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'print') as TabId;
  const [reprint, setReprint] = useState<JobRow | null>(null);
  const go = (t: string) => { const p = new URLSearchParams(params); if (t === 'print') p.delete('tab'); else p.set('tab', t); setParams(p, { replace: true }); };
  return (
    <div className="page ls-page">
      <div className="page-header no-print">
        <div>
          <h1 className="row" style={{ gap: 8 }}><Tag size={20} /> Barcode labels</h1>
          <p>Manage barcodes, design labels and print them on any roll or sheet. What you see is the real label size.</p>
        </div>
      </div>
      <div className="lb-tabs no-print" role="tablist" aria-label="Barcode labels">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => go(t.id)}>{t.label}</button>)}
      </div>
      {/* The Workbench stays mounted so a job in progress survives a look at another tab. */}
      <div hidden={tab !== 'print'}><Workbench reprintOf={reprint} onOpenTab={go} /></div>
      <Suspense fallback={<div className="skeleton" style={{ height: 320 }} />}>
        {tab === 'barcodes' && <BarcodesTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'stock' && <StockPrinters />}
        {tab === 'history' && <HistoryTab onOpen={(j) => { setReprint(j); go('print'); }} />}
      </Suspense>
    </div>
  );
}
