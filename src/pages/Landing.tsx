import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Boxes, BarChart3, Check, Camera, Store, Calculator, Users, FileText,
  Sparkles, BellRing, IndianRupee, Send, ChevronDown, Zap, LogIn, ScanLine, Mic, BrainCircuit, MapPinned, RefreshCw, Split, Truck, TrendingUp, MessageCircle, Scale,
} from 'lucide-react';
import { BrandLogo } from '@/components/Logo';
import { HeroArt, Photo, SceneArt } from '@/components/Photo';
import '@/styles/landing.css';

const FEATURES = [
  { icon: Mic, tone: 'rose', title: 'Speak the bill', text: 'Say “3 mouse aur ek monitor for Nila Textiles, 5% off, UPI” in English, Hindi, Tamil or Hinglish. AI fills the invoice.' },
  { icon: Camera, tone: 'sage', title: 'Photo to bill (AI OCR)', text: 'Snap a supplier bill, purchase order or receipt. Items, GST and totals fill themselves, even from small screenshots.' },
  { icon: BrainCircuit, tone: 'gold', title: 'Smart reorder', text: 'Knows how fast each item sells, warns before you run out, and turns the shopping list into purchase orders in one tap.' },
  { icon: Sparkles, tone: 'blush', title: 'Ask AI about your shop', text: '“Who owes me the most?” “What sold best this Diwali?” Answers from your own data in seconds.' },
  { icon: MapPinned, tone: 'cocoa', title: 'Salesman tracking', text: 'Field staff check in at customers. See their route, visits, orders and collections on a map, with an AI day summary.' },
  { icon: RefreshCw, tone: 'rose', title: 'Tally both ways', text: 'Send masters and vouchers to Tally for your CA, or move in from Tally, Vyapar or Busy. AI matches the columns.' },
  { icon: Split, tone: 'sage', title: 'Split payments & MRP billing', text: 'Part cash, part UPI on one bill. Type MRP prices and GST is worked out inside them. Discount on the whole bill.' },
  { icon: Truck, tone: 'gold', title: 'Delivery challans', text: 'Packed, dispatched, delivered with the receiver’s name, then invoiced in one click.' },
  { icon: TrendingUp, tone: 'blush', title: 'Profit on every bill', text: 'See the margin on each invoice and spot bills sold below cost before they hurt.' },
  { icon: MessageCircle, tone: 'cocoa', title: 'WhatsApp reminders by AI', text: 'Polite, friendly or firm payment reminders in 10 Indian languages, with your UPI link.' },
  { icon: BarChart3, tone: 'rose', title: 'GST returns & reports', text: 'GSTR-1, GSTR-3B, e-invoice and e-way bill JSON, P&L and balance sheet. PDF, Excel or CSV.' },
  { icon: Scale, tone: 'sage', title: 'Barcode, thermal & scale', text: 'Scan barcodes, print thermal receipts and labels, and read weights from a USB weighing scale at the counter.' },
] as const;

const AUDIENCE = [
  { img: '/img/owner.webp', tone: 'rose' as const, icon: <Store size={44} />, title: 'For shop owners', text: 'See sales, dues and stock on one screen every morning.', cta: 'See the dashboard' },
  { img: '/img/counter.webp', tone: 'sage' as const, icon: <ScanLine size={44} />, title: 'For the billing counter', text: 'Scan, bill and print — even during the evening rush.', cta: 'Try POS billing' },
  { img: '/img/accountant.webp', tone: 'cocoa' as const, icon: <Calculator size={44} />, title: 'For your accountant', text: 'Clean books, GST returns and exports ready to file.', cta: 'View reports' },
];

const STEPS = [
  { icon: Store, title: 'Add your business', text: 'Your name, GSTIN and logo. It takes two minutes.' },
  { icon: Boxes, title: 'Add items', text: 'Type them, import a price list, or upload a photo of one.' },
  { icon: Send, title: 'Start billing', text: 'Make an invoice and share it on WhatsApp with a UPI QR code.' },
];

const SCREENS = [
  { id: 'dashboard', label: 'AI morning plan', icon: Sparkles, caption: 'Every morning: a health score for your business and a to-do list written by AI, with one-tap reminders.', src: '/screens/dashboard.jpg' },
  { id: 'pos', label: 'Speak the bill', icon: Mic, caption: 'Say or type the bill in your own words. Items, customer, discount and payment fill themselves.', src: '/screens/pos.jpg' },
  { id: 'reorder', label: 'Smart reorder', icon: BrainCircuit, caption: 'What to buy, how much and from whom, with festival tips. One tap makes the purchase orders.', src: '/screens/reorder.jpg' },
  { id: 'ask', label: 'Ask AI', icon: MessageCircle, caption: 'Ask your shop anything, by voice or text, and hear the answer read aloud.', src: '/screens/ask.jpg' },
  { id: 'invoice', label: 'GST invoice', icon: FileText, caption: 'Clean GST invoices with your logo, UPI QR and profit on every bill.', src: '/screens/invoice.jpg' },
  { id: 'reports', label: 'Reports', icon: BarChart3, caption: 'P&L, balance sheet, GST returns and Tally export, ready for your CA.', src: '/screens/reports.jpg' },
];

/** Where Corpus360 goes further than a regular billing app. */
const COMPARE: Array<[string, string, string]> = [
  ['GST invoices, POS, barcode, thermal printing', 'Yes', 'Yes'],
  ['Make a bill by speaking, in Indian languages', '—', 'Yes'],
  ['AI morning plan and business health score', '—', 'Yes'],
  ['Photo or PDF of any bill fills the form', 'Basic OCR', 'AI reader'],
  ['Reorder list from real sales speed + festival tips', 'Low-stock alert', 'Yes'],
  ['Ask your shop questions by voice', '—', 'Yes'],
  ['WhatsApp reminders written in the customer’s language', 'Fixed text', 'AI, 10 languages'],
  ['Salesman route, visits and AI day summary', 'Add-on', 'Included'],
  ['Tally: export and import, any software’s Excel', 'Export only', 'Both ways, AI-matched'],
];

const FAQ = [
  ['Is it GST compliant?', 'Yes. Invoices carry your GSTIN, HSN/SAC codes, place of supply and the right tax split. GSTR-1 and GSTR-3B are prepared from your data.'],
  ['Can I upload a bill instead of typing it?', 'Yes. Upload a PDF or take a photo of a supplier bill, price list or product label — the form fills itself and you check it before saving.'],
  ['Can my staff use it?', 'Each person gets their own login and role. You decide who can see costs, reports or purchases.'],
  ['Does it work on a phone?', 'Yes. Everything works in a phone browser, and it can be installed like an app.'],
  ['Does invoice numbering restart every year?', 'Yes. The financial year runs 1 April to 31 March and numbering restarts automatically.'],
];

/** Adds .in to elements with .reveal as they scroll into view. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.lp .reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

export default function Landing() {
  const [screen, setScreen] = useState(SCREENS[0]!.id);
  const [open, setOpen] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  useReveal();
  useEffect(() => {
    document.title = 'Corpus360 — Billing and stock, made easy';
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const current = SCREENS.find((s) => s.id === screen)!;

  return (
    <div className="lp">
      <span className="lp-dot d1" /><span className="lp-dot d2" /><span className="lp-dot d3" /><span className="lp-dot d4" />
      <header ref={navRef} className={`lp-nav ${scrolled ? 'scrolled' : ''}`}>
        <Link to="/" className="lp-logo" aria-label="Corpus360 home"><BrandLogo height={22} /></Link>
        <nav className="lp-links"><a href="#home">Home</a><a href="#features">Features</a><a href="#screens">See it</a><a href="#compare">Why us</a><a href="#faq">FAQ</a></nav>
        <div className="lp-nav-cta">
          <Link to="/login" className="lp-pill lp-pill-light"><LogIn size={15} /> Login</Link>
          <Link to="/login" className="lp-pill lp-pill-rose">Try the demo</Link>
        </div>
      </header>

      <section className="lp-hero" id="home">
        <div className="lp-hero-text">
          <span className="lp-badge"><Sparkles size={14} /> Made for Indian shops &amp; distributors</span>
          <h1>Billing &amp; stock is now <span className="lp-hl">much easier</span></h1>
          <p className="lp-sub">Corpus360 is a simple app for GST invoices, stock and accounts. Make a bill in seconds, upload a photo of a purchase bill to fill it in, and always know what is in your shop.</p>
          <div className="lp-cta">
            <Link to="/login" className="lp-pill lp-pill-rose lg">Get started <ArrowRight size={18} /></Link>
            <a href="#how" className="lp-play"><span><Zap size={16} /></span> See how it works</a>
          </div>
          <ul className="lp-facts">
            <li><Check size={14} /> GSTR-1 &amp; 3B ready</li>
            <li><Check size={14} /> Multi-branch stock</li>
            <li><Check size={14} /> WhatsApp &amp; UPI</li>
          </ul>
        </div>
        <div className="lp-hero-art">
          <div className="lp-blob" />
          <Photo className="lp-hero-photo" src="/img/hero.webp" alt="Smiling shop owner holding a tablet" fallback={<HeroArt />} />
          <div className="lp-float f1"><span className="ic rose"><IndianRupee size={16} /></span><div><strong>₹15,947</strong><span>Collected this month</span></div></div>
          <div className="lp-float f2"><span className="ic sage"><Check size={16} /></span><div><strong>Invoice sent</strong><span>INV-0012 on WhatsApp</span></div></div>
          <div className="lp-float f3"><span className="ic gold"><BellRing size={16} /></span><div><strong>Low stock</strong><span>HP 680 ink · reorder</span></div><Link to="/login" className="lp-mini">View</Link></div>
        </div>
      </section>

      <section className="lp-section" id="who">
        <h2 className="reveal">What is <span>Corpus360</span>?</h2>
        <p className="lp-lead reveal">One place for billing, stock and accounts — so your shop runs smoothly and your accountant is happy.</p>
        <div className="lp-who">
          {AUDIENCE.map((a, i) => (
            <Link key={a.title} to="/login" className={`lp-who-card reveal tone-${a.tone}`} style={{ transitionDelay: `${i * 0.08}s` }}>
              <Photo className="lp-who-photo" src={a.img} alt={a.title} fallback={<SceneArt icon={a.icon} tone={a.tone} />} />
              <div className="lp-who-body">
                <h3>{a.title}</h3>
                <p>{a.text}</p>
                <span className="lp-mini">{a.cta} <ArrowRight size={13} /></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="lp-section" id="features">
        <h2 className="reveal">Everything your business <span>needs</span></h2>
        <p className="lp-lead reveal">Simple screens, big buttons and clear words — no accounting degree needed.</p>
        <div className="lp-grid">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="lp-feature reveal" style={{ transitionDelay: `${(i % 4) * 0.06}s` }}>
              <span className={`lp-ficon ${f.tone}`}><f.icon size={22} /></span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section" id="how">
        <h2 className="reveal">Start in <span>3 easy steps</span></h2>
        <div className="lp-steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className="lp-step reveal" style={{ transitionDelay: `${i * 0.1}s` }}>
              <span className="lp-step-n">{i + 1}</span>
              <span className="lp-step-icon"><s.icon size={26} /></span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section" id="screens">
        <h2 className="reveal">See it in <span>action</span></h2>
        <div className="lp-tabs reveal" role="tablist" aria-label="Screens">
          {SCREENS.map((s) => <button key={s.id} role="tab" aria-selected={screen === s.id} className={screen === s.id ? 'active' : ''} onClick={() => setScreen(s.id)}><s.icon size={15} /> {s.label}</button>)}
        </div>
        <p className="lp-caption reveal">{current.caption}</p>
        <div className="lp-frame reveal"><div className="lp-frame-bar"><i /><i /><i /></div><img key={current.id} src={current.src} alt={`Corpus360 ${current.label.toLowerCase()} screen`} /></div>
      </section>

      <section className="lp-section" id="compare">
        <h2 className="reveal">Why shops <span>switch</span></h2>
        <p className="lp-sub reveal">Everything a billing app does, plus an assistant that does the thinking for you.</p>
        <div className="lp-compare reveal" role="table" aria-label="Corpus360 compared with a regular billing app">
          <div className="lp-cmp-row lp-cmp-head" role="row"><span role="columnheader" /><span role="columnheader">Regular billing app</span><span role="columnheader" className="us">Corpus360</span></div>
          {COMPARE.map(([what, them, us]) => (
            <div key={what} className="lp-cmp-row" role="row">
              <span role="cell">{what}</span>
              <span role="cell" className="them">{them}</span>
              <span role="cell" className="us"><Check size={15} /> {us}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section" id="faq">
        <h2 className="reveal">Questions? <span>Answers</span></h2>
        <div className="lp-faq">
          {FAQ.map(([q, a], i) => (
            <div key={q} className={`lp-faq-item reveal ${open === i ? 'open' : ''}`}>
              <button aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>{q}<ChevronDown size={18} /></button>
              <div className="lp-faq-a"><p>{a}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-band reveal">
        <div>
          <h2>Ready to make billing easy?</h2>
          <p>Sign in with the demo account and try every feature — no setup needed.</p>
        </div>
        <Link to="/login" className="lp-pill lp-pill-light lg">Open the demo <ArrowRight size={18} /></Link>
      </section>

      <footer className="lp-foot">
        <BrandLogo height={18} />
        <span>© {new Date().getFullYear()} Corpus360 · Billing and stock, made easy.</span>
        <span className="lp-foot-links"><a href="#features">Features</a><a href="#faq">FAQ</a><Link to="/login"><Users size={13} /> Login</Link></span>
      </footer>
    </div>
  );
}
