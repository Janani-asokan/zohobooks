import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
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

const OPEN_EVENT = 'corpus:open-help';
/** Opens the help desk panel from anywhere on a public page (the landing's "Talk to our team" buttons). */
export const openHelpDesk = () => window.dispatchEvent(new Event(OPEN_EVENT));

/**
 * Help on every public page. A visitor gets the sales team (demo, plans, setup); someone already signed in gets a
 * "Customer support" button that opens Help in their workspace instead.
 */
export function PublicHelp({ signedIn }: { signedIn?: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const source = SOURCES.find(([re]) => re.test(pathname))?.[1];
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  if (!source) return null;
  // On the sign-in and sign-up forms a phone's bottom edge holds the submit button, so Help sits at the top there.
  const top = source === 'login' || source === 'signup' ? ' ph-top' : '';
  if (signedIn) {
    return <Link to="/app/support" className={`ph-fab no-print${top}`}><Headset size={18} /><span>Customer support</span></Link>;
  }
  return (
    <>
      {open && (
        <div className={`ph-pop${top}`} role="dialog" aria-label="Talk to our team">
          <button type="button" className="icon-btn ph-close" aria-label="Close" onClick={() => setOpen(false)}><X size={18} /></button>
          <Suspense fallback={<div className="ph-loading" aria-busy="true" />}><SalesPanel source={source} compact /></Suspense>
        </div>
      )}
      <button type="button" className={`ph-fab no-print${top}${open ? ' on' : ' attn'}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <X size={18} /> : <Headset size={18} />}<span>{open ? 'Close' : source === 'landing' ? 'Talk to us' : 'Help'}</span>
      </button>
    </>
  );
}
