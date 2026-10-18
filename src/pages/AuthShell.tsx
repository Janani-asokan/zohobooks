import type { ReactNode } from 'react';
import { ShieldCheck, CheckCircle2 } from 'lucide-react';

/** Split-screen frame shared by login, password reset and forced password change. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      <div className="login-left">
        <div className="row">
          <div className="brand-mark">L</div>
          <div className="brand-text">
            <strong style={{ color: 'var(--ink-900)' }}>Ledgerly Books</strong>
            <span>GST BILLING &amp; ACCOUNTING</span>
          </div>
        </div>
        <div className="login-form-wrap">{children}</div>
        <div className="login-foot">
          <span>© {new Date().getFullYear()} Ledgerly Books. All rights reserved.</span>
          <span className="row" style={{ gap: 6 }}><ShieldCheck size={14} /> Encrypted sessions · bcrypt-hashed passwords</span>
        </div>
      </div>
      <div className="login-right" aria-hidden>
        <div className="login-hero">
          <h2>Billing, inventory and GST accounting for growing businesses.</h2>
          <p>One place to invoice customers, manage stock and purchases, and prepare your GST returns.</p>
          <ul className="login-points">
            <li><CheckCircle2 size={18} /><div><strong>GST-compliant invoicing</strong>Tax invoices, bills of supply and credit notes with CGST, SGST and IGST worked out for you.</div></li>
            <li><CheckCircle2 size={18} /><div><strong>Inventory and purchasing</strong>Barcode items, purchase orders, batch and expiry tracking across branches.</div></li>
            <li><CheckCircle2 size={18} /><div><strong>Returns ready to file</strong>GSTR-1, GSTR-3B and HSN summaries prepared from your transactions.</div></li>
          </ul>
          <div className="login-quote">Financial year runs 1 April – 31 March. Invoice numbering resets automatically.</div>
        </div>
      </div>
    </div>
  );
}
