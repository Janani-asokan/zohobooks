import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Check } from 'lucide-react';
import { BrandLogo } from '@/components/Logo';

/** Split-screen frame shared by login, password reset and forced password change. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      <div className="login-left">
        <Link to="/" aria-label="Corpus360 home" style={{ color: 'var(--brand-600)', alignSelf: 'flex-start' }}>
          <BrandLogo height={18} />
        </Link>
        <div className="login-form-wrap">{children}</div>
        <div className="login-foot">
          <span>© {new Date().getFullYear()} Corpus360</span>
          <span className="row" style={{ gap: 6 }}><ShieldCheck size={14} /> Encrypted sessions. Each business sees only its own data.</span>
        </div>
      </div>
      <div className="login-right" aria-hidden>
        <div className="login-hero">
          <h2>Billing and stock, without the paperwork.</h2>
          <p>GST invoices, inventory across warehouses and the accounts behind them — in one place your accountant can trust.</p>
          <ul className="login-points">
            <li><Check size={16} /><div><strong>Invoices in under 30 seconds</strong>Find items by name, SKU, HSN or barcode. CGST, SGST or IGST is picked from the place of supply.</div></li>
            <li><Check size={16} /><div><strong>Stock that keeps itself up to date</strong>Invoices reduce it, bills add to it, and every movement is recorded per item and warehouse.</div></li>
            <li><Check size={16} /><div><strong>Returns ready when you are</strong>GSTR-1 and GSTR-3B summaries, P&amp;L and balance sheet, exportable to PDF, Excel and CSV.</div></li>
          </ul>
        </div>
        <img className="login-photo" src="/img/hero.webp" alt="" decoding="async" />
      </div>
    </div>
  );
}
