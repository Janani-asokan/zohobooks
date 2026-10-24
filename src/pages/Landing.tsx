import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileText, Boxes, ShoppingBag, Landmark, BarChart3, Users, Check } from 'lucide-react';
import { BrandLogo } from '@/components/Logo';
import '@/styles/landing.css';

const FEATURES = [
  { icon: FileText, title: 'GST invoicing', text: 'Tax invoices, quotes and credit notes. CGST and SGST within your state, IGST across states — chosen from the place of supply. E-invoice IRN and QR, e-way bill details.' },
  { icon: Boxes, title: 'Inventory', text: 'Items with variants, batches and expiry, serial numbers and reorder levels. Stock moves itself when you invoice or receive a bill, warehouse by warehouse.' },
  { icon: ShoppingBag, title: 'Purchases', text: 'Purchase orders, vendor bills and payments made, with payables ageing so you know who to pay this week.' },
  { icon: Landmark, title: 'Accounting', text: 'A chart of accounts and journals behind every document. Banking, P&L, balance sheet and cash flow without re-entering anything.' },
  { icon: BarChart3, title: 'Reports and returns', text: 'GSTR-1 and GSTR-3B summaries, sales by item and customer, stock summary and valuation. Export any report to PDF, Excel or CSV.' },
  { icon: Users, title: 'Roles and audit', text: 'Owner, accountant, sales and warehouse roles with access set per module, and a log of every change.' },
];

const SCREENS = [
  { id: 'dashboard', label: 'Dashboard', src: '/screens/dashboard.jpg' },
  { id: 'invoice', label: 'Invoice', src: '/screens/invoice.jpg' },
  { id: 'items', label: 'Items', src: '/screens/items.jpg' },
  { id: 'reports', label: 'Reports', src: '/screens/reports.jpg' },
];

export default function Landing() {
  const [screen, setScreen] = useState(SCREENS[0]!.id);
  useEffect(() => { document.title = 'Corpus360 — Billing and stock, without the paperwork'; }, []);
  const current = SCREENS.find((s) => s.id === screen)!;

  return (
    <div className="lp">
      <header className="lp-nav">
        <Link to="/" className="lp-logo" aria-label="Corpus360 home"><BrandLogo height={18} /></Link>
        <nav className="lp-links"><a href="#features">Product</a><a href="#screens">Screens</a><a href="#faq">Questions</a></nav>
        <Link to="/login" className="btn btn-secondary">Sign in</Link>
      </header>

      <section className="lp-hero">
        <p className="lp-eyebrow">For Indian shops, distributors and service businesses</p>
        <h1>Billing and stock, without the paperwork.</h1>
        <p className="lp-sub">Corpus360 puts GST invoicing, inventory and the accounts behind them in one tool. Make an invoice in under 30 seconds, see what is low on stock, and hand your accountant clean books at the end of the month.</p>
        <div className="lp-cta">
          <Link to="/login" className="btn btn-primary btn-lg">Sign in <ArrowRight size={16} /></Link>
          <a href="#features" className="btn btn-ghost btn-lg">See what it does</a>
        </div>
        <ul className="lp-facts">
          <li><Check size={14} /> GSTR-1 and GSTR-3B ready</li>
          <li><Check size={14} /> Multi-warehouse stock</li>
          <li><Check size={14} /> Works on your phone</li>
        </ul>
      </section>

      <section className="lp-shot" id="screens">
        <div className="lp-tabs" role="tablist" aria-label="Screens">
          {SCREENS.map((s) => <button key={s.id} role="tab" aria-selected={screen === s.id} className={screen === s.id ? 'active' : ''} onClick={() => setScreen(s.id)}>{s.label}</button>)}
        </div>
        <div className="lp-frame"><img src={current.src} alt={`Corpus360 ${current.label.toLowerCase()} screen`} /></div>
      </section>

      <section className="lp-section" id="features">
        <h2>Everything a growing business runs on</h2>
        <div className="lp-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="lp-feature">
              <f.icon size={18} />
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section" id="faq">
        <h2>Questions</h2>
        <dl className="lp-faq">
          <dt>Is it GST compliant?</dt><dd>Invoices carry your GSTIN, HSN/SAC codes, place of supply and the correct tax split. GSTR-1 and GSTR-3B summaries are prepared from your data for upload to the GST portal.</dd>
          <dt>Does invoice numbering restart every year?</dt><dd>Yes. The financial year runs 1 April to 31 March and numbering restarts automatically.</dd>
          <dt>Can my staff use it?</dt><dd>Each person signs in with their own account and role, and sees only the modules you allow.</dd>
          <dt>Does it work on a phone?</dt><dd>Yes. Collect a payment, check stock or send an invoice from any modern phone browser.</dd>
        </dl>
      </section>

      <footer className="lp-foot">
        <BrandLogo height={15} />
        <span>© {new Date().getFullYear()} Corpus360. Billing and stock, without the paperwork.</span>
        <Link to="/login">Sign in</Link>
      </footer>
    </div>
  );
}
