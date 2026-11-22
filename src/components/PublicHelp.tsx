import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Headset, X } from 'lucide-react';
import type { LeadSource } from '../../shared/support';
import '@/styles/sales.css';

// The panel loads only when Help is tapped, so the landing page stays light.
const SalesPanel = lazy(() => import('./SalesPanel').then((m) => ({ default: m.SalesPanel })));

/** Pages for visitors (not signed in) where Help leads to the sales team. */
const SOURCES: Array<[RegExp, LeadSource]> = [
  [/^\/$/, 'landing'], [/^\/login\/?$/, 'login'], [/^\/signup\/?$/, 'signup'], [/^\/reset-password\/?$/, 'login'],
  [/^\/(privacy|terms|delete-account)\/?$/, 'legal'],
];

/** A Help button on every public page. It opens Talk to sales; signed-in shops get Help in the app's top bar. */
export function PublicHelp({ hidden }: { hidden?: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const source = SOURCES.find(([re]) => re.test(pathname))?.[1];
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  if (!source || hidden) return null;
  // On the sign-in and sign-up forms a phone's bottom edge holds the submit button, so Help sits at the top there.
  const top = source === 'login' || source === 'signup' ? ' ph-top' : '';
  return (
    <>
      {open && (
        <div className={`ph-pop${top}`} role="dialog" aria-label="Talk to sales">
          <button type="button" className="icon-btn ph-close" aria-label="Close" onClick={() => setOpen(false)}><X size={18} /></button>
          <Suspense fallback={<div className="ph-loading" aria-busy="true" />}><SalesPanel source={source} compact /></Suspense>
        </div>
      )}
      <button type="button" className={`ph-fab no-print${top}${open ? ' on' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <X size={18} /> : <Headset size={18} />}<span>{open ? 'Close' : 'Help'}</span>
      </button>
    </>
  );
}
