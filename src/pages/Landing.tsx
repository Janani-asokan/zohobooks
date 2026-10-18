import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, FileText, Boxes, ShoppingBag, Landmark, BarChart3, ScanLine, ShieldCheck, Users, WifiOff, Languages, CheckCircle2,
  MessageCircle, X, ChevronDown, Receipt, Building2, Smartphone,
} from 'lucide-react';
import { Canopy } from '@/components/Canopy';
import { CountUp, Reveal } from '@/components/motion';
import '@/styles/landing.css';

const FEATURES = [
  { icon: FileText, title: 'GST invoicing', text: 'Tax invoices, bills of supply and credit notes. CGST, SGST and IGST worked out from the place of supply.' },
  { icon: Boxes, title: 'Inventory', text: 'Barcodes, three price levels, batches with expiry, low-stock alerts and stock across branches.' },
  { icon: ShoppingBag, title: 'Purchases', text: 'Purchase orders you receive into stock, vendor bills, expenses and the input tax credit they carry.' },
  { icon: ScanLine, title: 'Counter billing', text: 'A fast POS screen: scan, charge and print — every sale is a proper invoice.' },
  { icon: Landmark, title: 'Banking', text: 'Bank, cash and card accounts update themselves as you collect payments and pay bills.' },
  { icon: BarChart3, title: 'Reports & returns', text: 'Profit & loss, sales and aging reports, plus GSTR-1, GSTR-3B and HSN summaries ready to file.' },
];

const SCREENS = [
  { id: 'dashboard', label: 'Dashboard', src: '/screens/dashboard.jpg', caption: 'Revenue, dues and what needs attention today — at a glance.' },
  { id: 'items', label: 'Items', src: '/screens/items.jpg', caption: 'Your catalogue with prices, margins and live stock.' },
  { id: 'invoice', label: 'Invoice', src: '/screens/invoice.jpg', caption: 'Print-ready A4 invoices with your logo and a UPI QR code.' },
  { id: 'reports', label: 'Reports', src: '/screens/reports.jpg', caption: 'Profit & loss and GST returns prepared from your transactions.' },
];

const FAQ = [
  ['Is it GST compliant?', 'Yes. Invoices carry GSTIN, HSN/SAC, place of supply and the correct tax split. GSTR-1 and GSTR-3B are prepared from your data and can be downloaded for the GST portal.'],
  ['Does invoice numbering reset every year?', 'Yes. The financial year runs 1 April – 31 March, and invoice numbers start again automatically in each new year.'],
  ['Can my staff use it?', 'Each staff member gets their own login with a role — owner, manager, sales or accounts — so they only see what they need.'],
  ['Does it work on a phone?', 'Yes. It runs in any modern browser on desktop, tablet or phone, can be installed like an app, and shows your saved data when you are offline.'],
  ['Can I manage more than one branch?', 'Yes. Stock is tracked per branch, and you can transfer goods between branches with a full history.'],
] as const;

const TICKER = ['GST-compliant invoices', 'GSTR-1 & GSTR-3B', 'Barcode scanning', 'Multi-branch stock', 'UPI QR on invoices', 'Purchase orders', 'Profit & loss', 'Works offline', 'Hindi · Tamil · English'];

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [screen, setScreen] = useState(SCREENS[0]!.id);
  const [faq, setFaq] = useState<number | null>(0);
  const [help, setHelp] = useState(false);
  const [helpTip, setHelpTip] = useState(true);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    document.title = 'Ledgerly Books · GST billing, inventory & accounting';
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Rotate the showcase every few seconds until the visitor picks a tab.
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setScreen((s) => SCREENS[(SCREENS.findIndex((x) => x.id === s) + 1) % SCREENS.length]!.id), 5000);
    return () => clearInterval(t);
  }, [auto]);
  const current = SCREENS.find((s) => s.id === screen)!;

  return (
    <div className="lp">
      <div className="lp-util">
        <span>GST billing &amp; accounting for Indian businesses</span>
        <nav><a href="#features">Features</a><a href="#faq">Help</a><Link to="/login">Sign in</Link></nav>
      </div>

      <header className={`lp-nav ${scrolled ? 'solid' : ''}`}>
        <a href="#top" className="lp-logo"><span className="lp-mark">L</span><span><strong>Ledgerly</strong><em>BOOKS</em></span></a>
        <nav className="lp-links"><a href="#features">Features</a><a href="#screens">Product</a><a href="#how">How it works</a><a href="#faq">FAQ</a></nav>
        <Link to="/login" className="lp-btn gold sm">Sign in <ArrowRight size={15} /></Link>
      </header>

      <section className="lp-hero" id="top">
        <Canopy />
        <div className="lp-hero-inner">
          <p className="lp-eyebrow fade-1">Billing · Inventory · GST · Accounting</p>
          <h1 className="fade-2">Grow your business,<br />naturally.</h1>
          <p className="lp-sub fade-3">Invoices, stock, purchases and GST returns in one calm, beautiful workspace — built for Indian shops and service businesses.</p>
          <div className="lp-cta fade-4">
            <Link to="/login" className="lp-btn gold">Sign in to your account <ArrowRight size={17} /></Link>
            <a href="#features" className="lp-btn ghost">Explore features</a>
          </div>
        </div>
        <div className="lp-hero-shot fade-5">
          <div className="lp-browser">
            <div className="lp-browser-bar"><i /><i /><i /><span>ledgerly-books.onrender.com</span></div>
            <img src="/screens/dashboard.jpg" alt="Ledgerly Books dashboard" loading="eager" />
          </div>
        </div>
        <a href="#features" className="lp-scroll" aria-label="Scroll to features"><ChevronDown size={20} /></a>
      </section>

      <div className="lp-ticker" aria-hidden>
        <div className="lp-ticker-track">
          {[...TICKER, ...TICKER].map((t, i) => <span key={i}><CheckCircle2 size={14} /> {t}</span>)}
        </div>
      </div>

      <section className="lp-section" id="features">
        <Reveal><p className="lp-kicker">Everything in one place</p><h2>All the tools your business runs on.</h2><p className="lp-lead">From the first quote to the GST return — without spreadsheets, without switching apps.</p></Reveal>
        <div className="lp-features">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 70} className="lp-feature">
              <span className="lp-ficon"><f.icon size={22} /></span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="lp-stats">
        <Canopy fireflies={10} interactive={false} />
        <div className="lp-stats-inner">
          {[
            { v: 12, s: '+', l: 'modules in one app' },
            { v: 3, s: '', l: 'price levels per item' },
            { v: 5, s: '', l: 'staff roles with their own access' },
            { v: 100, s: '%', l: 'browser-based — nothing to install' },
          ].map((x, i) => (
            <Reveal key={x.l} delay={i * 90} className="lp-stat">
              <strong><CountUp value={x.v} />{x.s}</strong>
              <span>{x.l}</span>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="lp-section" id="screens">
        <Reveal><p className="lp-kicker">See it in action</p><h2>Designed to be understood at a glance.</h2></Reveal>
        <Reveal className="lp-showcase">
          <div className="lp-tabs" role="tablist">
            {SCREENS.map((s) => (
              <button key={s.id} role="tab" aria-selected={screen === s.id} className={screen === s.id ? 'active' : ''} onClick={() => { setAuto(false); setScreen(s.id); }}>{s.label}</button>
            ))}
          </div>
          <div className="lp-browser big">
            <div className="lp-browser-bar"><i /><i /><i /><span>{current.label}</span></div>
            <div className="lp-frames">
              {SCREENS.map((s) => <img key={s.id} src={s.src} alt={s.caption} className={screen === s.id ? 'on' : ''} loading="lazy" />)}
            </div>
          </div>
          <p className="lp-caption">{current.caption}</p>
        </Reveal>
      </section>

      <section className="lp-section alt" id="how">
        <Reveal><p className="lp-kicker">Up and running in minutes</p><h2>Three steps to your first invoice.</h2></Reveal>
        <div className="lp-steps">
          {[
            { icon: Building2, t: 'Set up your business', d: 'Add your logo, GSTIN, address and UPI ID. They appear on every invoice.' },
            { icon: Boxes, t: 'Add items & customers', d: 'Scan barcodes or import a spreadsheet. Customers get an automatic ID.' },
            { icon: Receipt, t: 'Bill and get paid', d: 'Create a GST invoice, share it on WhatsApp or print it, and record the payment.' },
          ].map((s, i) => (
            <Reveal key={s.t} delay={i * 110} className="lp-step">
              <span className="lp-step-n">{i + 1}</span>
              <s.icon size={22} />
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </Reveal>
          ))}
        </div>
        <div className="lp-pills">
          {[{ i: ShieldCheck, t: 'Secure sign-in & encrypted sessions' }, { i: Users, t: 'Role-based staff access' }, { i: WifiOff, t: 'Read-only offline mode' }, { i: Languages, t: 'English, Hindi & Tamil' }, { i: Smartphone, t: 'Install on any phone' }].map((p) => (
            <span key={p.t}><p.i size={15} /> {p.t}</span>
          ))}
        </div>
      </section>

      <section className="lp-section" id="faq">
        <Reveal><p className="lp-kicker">Questions</p><h2>Frequently asked.</h2></Reveal>
        <div className="lp-faq">
          {FAQ.map(([q, a], i) => (
            <Reveal key={q} delay={i * 50} className={`lp-q ${faq === i ? 'open' : ''}`}>
              <button onClick={() => setFaq(faq === i ? null : i)} aria-expanded={faq === i}>{q}<ChevronDown size={18} /></button>
              <div className="lp-a"><p>{a}</p></div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="lp-final">
        <Canopy fireflies={14} interactive={false} />
        <Reveal className="lp-final-inner">
          <h2>Your books, beautifully kept.</h2>
          <p>Sign in and create your first GST invoice in under a minute.</p>
          <Link to="/login" className="lp-btn gold">Sign in <ArrowRight size={17} /></Link>
        </Reveal>
      </section>

      <footer className="lp-foot">
        <div className="lp-logo"><span className="lp-mark">L</span><span><strong>Ledgerly</strong><em>BOOKS</em></span></div>
        <span>© {new Date().getFullYear()} Ledgerly Books. GST billing, inventory &amp; accounting.</span>
        <nav><a href="#features">Features</a><a href="#faq">FAQ</a><Link to="/login">Sign in</Link></nav>
      </footer>

      <div className="lp-help">
        {help && (
          <div className="lp-help-panel" role="dialog" aria-label="Help">
            <div className="lp-help-head"><strong>How can we help?</strong><button onClick={() => setHelp(false)} aria-label="Close"><X size={16} /></button></div>
            {FAQ.slice(0, 3).map(([q], i) => <a key={q} href="#faq" onClick={() => { setFaq(i); setHelp(false); }}>{q}</a>)}
            <Link to="/login" className="lp-btn gold sm" style={{ marginTop: 10, justifyContent: 'center' }}>Sign in</Link>
          </div>
        )}
        {!help && helpTip && <button className="lp-help-tip" onClick={() => setHelp(true)}>How may we help you today?<span onClick={(e) => { e.stopPropagation(); setHelpTip(false); }} aria-label="Dismiss"><X size={12} /></span></button>}
        <button className="lp-help-btn" onClick={() => setHelp((h) => !h)} aria-label="Help"><MessageCircle size={22} /></button>
      </div>
    </div>
  );
}
