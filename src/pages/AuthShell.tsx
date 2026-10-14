import type { ReactNode } from 'react';
import { ShieldCheck, BadgeCheck, Store, Receipt, TrendingUp, Landmark } from 'lucide-react';

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
          <span className="badge plain" style={{ background: 'rgba(255,255,255,.15)', color: '#fff', marginBottom: 18 }}>
            <BadgeCheck size={14} /> GST-ready billing for Indian businesses
          </span>
          <h2>Simple, secure accounting your business can trust.</h2>
          <p>Create GST invoices in seconds, bill at the counter with barcode scanning, share invoices on WhatsApp and file GSTR-1 with one download.</p>
          <div className="hero-stage">
            <div className="hero-card main light-scope">
              <div className="row between" style={{ marginBottom: 14 }}>
                <div className="row">
                  <div className="stat-icon tone-blue"><Receipt size={18} /></div>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--ink-900)' }}>INV-2026-27-0128</div>
                    <div className="small muted">Nila Textiles · GSTIN 33AAFCN5678K1Z2</div>
                  </div>
                </div>
                <span className="badge badge-green">Paid</span>
              </div>
              {[['Dell 24" FHD Monitor × 2', '₹24,998'], ['Annual Maintenance Contract', '₹5,999'], ['CGST 9% + SGST 9%', '₹5,579']].map(([a, b]) => (
                <div key={a} className="row between small" style={{ padding: '7px 0', borderBottom: '1px solid var(--ink-150)' }}>
                  <span className="muted">{a}</span>
                  <strong style={{ color: 'var(--ink-800)' }}>{b}</strong>
                </div>
              ))}
              <div className="row between" style={{ marginTop: 10 }}>
                <strong style={{ color: 'var(--ink-900)' }}>Total</strong>
                <strong style={{ fontSize: 18, color: 'var(--brand-700)' }}>₹36,576</strong>
              </div>
            </div>
            <div className="hero-card float light-scope">
              <div className="row">
                <div className="stat-icon tone-green"><TrendingUp size={18} /></div>
                <div>
                  <div className="small muted">Collections this month</div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--ink-900)' }}>₹4.8L</div>
                </div>
              </div>
            </div>
            <div className="hero-card float2 light-scope">
              <div className="row">
                <div className="stat-icon tone-violet"><Landmark size={18} /></div>
                <div>
                  <div className="small muted">GSTR-1 for September</div>
                  <div style={{ fontWeight: 700, color: 'var(--ink-900)' }}>Ready to upload</div>
                </div>
              </div>
            </div>
          </div>
          <div className="hero-badges">
            <span><ShieldCheck size={16} /> Bank-grade security</span>
            <span><BadgeCheck size={16} /> GST compliant</span>
            <span><Store size={16} /> Multi-branch ready</span>
          </div>
        </div>
      </div>
    </div>
  );
}
