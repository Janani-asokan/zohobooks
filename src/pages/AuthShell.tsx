import type { ReactNode } from 'react';
import { ShieldCheck, BadgeCheck, Zap, Smile } from 'lucide-react';

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
          <h2>Simplify Your<br />Billing Process</h2>
          <p>Create invoices, track payments, manage inventory and grow your business — all in one place.</p>
          <HeroScene />
          <div className="hero-features">
            <div><span><Zap size={18} /></span>Fast &amp; Secure</div>
            <div><span><BadgeCheck size={18} /></span>GST Compliant</div>
            <div><span><Smile size={18} /></span>Easy to Use</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Illustrated desk scene: laptop with a live-looking dashboard, a plant and warm lamp light. */
function HeroScene() {
  return (
    <svg className="hero-scene" viewBox="0 0 520 330" role="img" aria-label="Laptop showing the Ledgerly dashboard">
      <defs>
        <radialGradient id="lamp" cx="72%" cy="34%" r="38%"><stop offset="0%" stopColor="#ffd9a0" stopOpacity=".55" /><stop offset="100%" stopColor="#ffd9a0" stopOpacity="0" /></radialGradient>
        <linearGradient id="screen" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#f7f9fd" /><stop offset="100%" stopColor="#eef3fb" /></linearGradient>
        <linearGradient id="desk" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#3b2a1e" /><stop offset="100%" stopColor="#24180f" /></linearGradient>
        <linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity=".35" /><stop offset="100%" stopColor="#2563eb" stopOpacity="0" /></linearGradient>
      </defs>
      <rect width="520" height="330" fill="url(#lamp)" />
      <rect x="0" y="268" width="520" height="62" rx="4" fill="url(#desk)" />
      {/* plant */}
      <g transform="translate(418 150)">
        <path d="M30 18c-18-30-4-58 6-66 2 26 10 44-6 66z" fill="#3f8f5a" />
        <path d="M34 22c8-34 34-46 46-46-8 24-20 40-46 46z" fill="#2f7a4a" />
        <path d="M28 26c-22-12-34-34-34-52 20 10 32 24 34 52z" fill="#4fa36a" />
        <path d="M32 30c4-28 22-44 30-48-2 22-10 38-30 48z" fill="#5cb878" />
        <path d="M10 52h46l-6 66H16z" fill="#e9e3d7" />
        <path d="M10 52h46l-1.5 10H11.5z" fill="#d8d0c0" />
      </g>
      {/* laptop */}
      <g transform="translate(70 70)">
        <rect x="0" y="0" width="320" height="196" rx="12" fill="#1b2433" />
        <rect x="10" y="10" width="300" height="176" rx="6" fill="url(#screen)" />
        <rect x="10" y="10" width="62" height="176" rx="6" fill="#0d1b2e" />
        <rect x="20" y="22" width="40" height="7" rx="3.5" fill="#2563eb" />
        {[44, 60, 76, 92, 108, 124].map((y, i) => <rect key={y} x="20" y={y} width={i === 0 ? 42 : 34} height="6" rx="3" fill={i === 0 ? '#1b3253' : '#24344d'} />)}
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(${82 + i * 56} 22)`}>
            <rect width="50" height="34" rx="5" fill="#fff" stroke="#e3e8f2" />
            <rect x="6" y="7" width="10" height="10" rx="3" fill={['#16a34a', '#2563eb', '#e07b00', '#7c3aed'][i]} opacity=".85" />
            <rect x="6" y="22" width="30" height="5" rx="2.5" fill="#1b2433" opacity=".8" />
          </g>
        ))}
        <g transform="translate(82 64)">
          <rect width="136" height="112" rx="6" fill="#fff" stroke="#e3e8f2" />
          <path d="M10 92 L30 80 L50 84 L70 62 L90 66 L110 44 L126 36 L126 100 L10 100 Z" fill="url(#area)" />
          <path d="M10 92 L30 80 L50 84 L70 62 L90 66 L110 44 L126 36" fill="none" stroke="#2563eb" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="10" y="10" width="54" height="6" rx="3" fill="#1b2433" opacity=".75" />
        </g>
        <g transform="translate(226 64)">
          <rect width="76" height="112" rx="6" fill="#fff" stroke="#e3e8f2" />
          {[16, 36, 56, 76, 96].map((y, i) => (
            <g key={y}><rect x="8" y={y} width="34" height="5" rx="2.5" fill="#c7d2e3" /><rect x="48" y={y - 2} width="20" height="9" rx="4.5" fill={['#dcfce7', '#dcfce7', '#fef3c7', '#dcfce7', '#fee2e2'][i]} /></g>
          ))}
        </g>
        <path d="M-26 196h372l-14 14H-12z" fill="#2a3446" />
        <rect x="128" y="196" width="64" height="5" rx="2.5" fill="#3a4559" />
      </g>
      {/* coffee mug */}
      <g transform="translate(26 226)"><rect width="30" height="38" rx="6" fill="#f2efe9" /><path d="M30 10c12 0 12 18 0 18" fill="none" stroke="#f2efe9" strokeWidth="5" /></g>
    </svg>
  );
}
