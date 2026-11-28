/**
 * Google Analytics 4 on the website only: never in the phone app (its Play Store data-safety form says it collects
 * no analytics) and never inside a shop's records. What GA sees is the kind of page, not whose: ids, share tokens and
 * every ?query are stripped (a password-reset link carries its token in the query), so /app/sales/invoices/9f…
 * arrives as /app/sales/invoices/:id. Loaded after the page is idle so the landing page stays fast.
 */
import { IS_APP } from './platform';

export const GA_ID: string = import.meta.env.VITE_GA_ID ?? 'G-JRTYV5SF8Y';
const ON = !IS_APP && !!GA_ID && typeof window !== 'undefined' && !/^(localhost|127\.|\[::1\])/.test(window.location.hostname);

type Gtag = (...args: unknown[]) => void;
const w = (typeof window !== 'undefined' ? window : {}) as unknown as { dataLayer?: unknown[]; gtag?: Gtag };

/** /share/AbC…, /app/items/9f…/edit, /reset-password?token=… → the shape of the page only. */
export function cleanPath(path: string): string {
  const p = path.split(/[?#]/)[0]
    .replace(/^\/share\/[^/]+/, '/share/:token')
    .split('/')
    .map((s) => (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(s) || /^\d+$/.test(s) || (/\d/.test(s) && s.length >= 16) ? ':id' : s))
    .join('/');
  return p || '/';
}

let started = false;
function start() {
  if (started || !ON) return;
  started = true;
  w.dataLayer = w.dataLayer || [];
  // gtag must push the arguments object itself, as Google's snippet does.
  w.gtag = function gtag() { w.dataLayer!.push(arguments); } as Gtag; // eslint-disable-line prefer-rest-params
  w.gtag('js', new Date());
  w.gtag('config', GA_ID, { send_page_view: false, page_location: window.location.origin + cleanPath(window.location.pathname) });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  const load = () => document.head.appendChild(s);
  if ('requestIdleCallback' in window) (window as unknown as { requestIdleCallback: (f: () => void, o: object) => void }).requestIdleCallback(load, { timeout: 4000 });
  else setTimeout(load, 1500);
}

/** One page view per screen change (React Router), with the cleaned path. */
export function trackPage(pathname: string) {
  if (!ON) return;
  start();
  const path = cleanPath(pathname);
  const page_location = window.location.origin + path;
  w.gtag!('set', { page_location, page_path: path });
  w.gtag!('event', 'page_view', { page_location, page_path: path, page_title: document.title });
}

/** A named event (sign_up, login, generate_lead…). Never pass names, emails, phone numbers or amounts of a shop. */
export function track(name: string, params: Record<string, string | number | boolean> = {}) {
  if (!ON) return;
  start();
  w.gtag!('event', name, params);
}
