import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck, Landmark, Receipt, TrendingUp, BadgeCheck, Loader2, Store, KeyRound } from 'lucide-react';
import { homeFor, useAuth } from '@/context/AuthContext';
import { useStore } from '@/context/StoreContext';
import { useToast } from '@/context/ToastContext';
import { EMAIL_RE } from '@/lib/format';
import type { Role } from '@/lib/types';
import { Field, Modal } from '@/components/ui';

export default function Login() {
  const { session, login, logout } = useAuth();
  const { db } = useStore();
  const toast = useToast();
  const navigate = useNavigate();

  const [role, setRole] = useState<Role>('CustomerAdmin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotTouched, setForgotTouched] = useState(false);

  const sessionValid =
    session && (session.role === 'SuperAdmin' || db.shops.some((s) => s.id === session.shopId && s.active));
  useEffect(() => {
    if (session && !sessionValid) logout();
  }, [session, sessionValid, logout]);
  if (sessionValid) return <Navigate to={homeFor(session.role)} replace />;

  const emailErr = !email ? 'Email is required' : !EMAIL_RE.test(email) ? 'Enter a valid email address' : '';
  const passErr = !password ? 'Password is required' : password.length < 6 ? 'Password must be at least 6 characters' : '';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    setError('');
    if (emailErr || passErr) return;
    setLoading(true);
    // Simulated network latency so the button's loading state is visible.
    setTimeout(() => {
      const res = login(email, password, role, remember);
      setLoading(false);
      if (!res.ok) return setError(res.error);
      toast('success', 'Welcome back!', role === 'SuperAdmin' ? 'Signed in to the platform console.' : 'Signed in to your workspace.');
      navigate(res.redirect, { replace: true });
    }, 650);
  };

  const fill = (r: Role) => {
    setRole(r);
    setEmail(r === 'SuperAdmin' ? 'admin@ledgerly.in' : 'owner@shop.com');
    setPassword(r === 'SuperAdmin' ? 'admin123' : 'owner123');
    setError('');
  };

  const forgotErr = !forgotEmail ? 'Email is required' : !EMAIL_RE.test(forgotEmail) ? 'Enter a valid email address' : '';

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

        <div className="login-form-wrap">
          <h1>Sign in to your account</h1>
          <p className="lead">Manage invoices, inventory and GST compliance from one secure workspace.</p>

          <form className="login-form" onSubmit={submit} noValidate>
            <Field label="Sign in as" hint="Temporary selector for testing — production resolves the role from your account.">
              <div className="radio-cards">
                {(
                  [
                    ['CustomerAdmin', 'Customer Admin', 'Shop owner workspace', Store],
                    ['SuperAdmin', 'Super Admin', 'SaaS platform console', ShieldCheck],
                  ] as const
                ).map(([value, title, sub, Icon]) => (
                  <div key={value} className={`radio-card ${role === value ? 'active' : ''}`} onClick={() => setRole(value)} role="radio" aria-checked={role === value} tabIndex={0} onKeyDown={(e) => e.key === ' ' && setRole(value)}>
                    <span className="dot" />
                    <div>
                      <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon size={14} /> {title}
                      </strong>
                      <span>{sub}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Field>

            <Field label="Email address" required error={touched.email ? emailErr : ''}>
              <div className="input-group">
                <span className="lead">
                  <Mail size={16} />
                </span>
                <input
                  className={`input ${touched.email && emailErr ? 'invalid' : ''}`}
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  style={{ height: 44 }}
                />
              </div>
            </Field>

            <Field label="Password" required error={touched.password ? passErr : ''}>
              <div className="input-group trail-pad">
                <span className="lead">
                  <Lock size={16} />
                </span>
                <input
                  className={`input ${touched.password && passErr ? 'invalid' : ''}`}
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  style={{ height: 44 }}
                />
                <span className="trail">
                  <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
              </div>
            </Field>

            <div className="row between small">
              <label className="row" style={{ gap: 8, cursor: 'pointer', color: 'var(--ink-600)' }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me signed in
              </label>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setForgotEmail(email);
                  setForgotTouched(false);
                  setForgotOpen(true);
                }}
                style={{ fontWeight: 600 }}
              >
                Forgot password?
              </a>
            </div>

            {error && (
              <div className="login-alert" role="alert">
                <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            )}

            <button className="btn btn-primary btn-block login-btn" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 size={18} className="spin" /> Signing in…
                </>
              ) : (
                <>
                  Sign in <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="demo-creds">
            <div style={{ fontWeight: 700, color: 'var(--ink-800)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <KeyRound size={14} /> Demo accounts
            </div>
            <div className="row between">
              <span>Shop owner · owner@shop.com / owner123</span>
              <button type="button" onClick={() => fill('CustomerAdmin')}>Use</button>
            </div>
            <div className="row between" style={{ marginTop: 4 }}>
              <span>Super admin · admin@ledgerly.in / admin123</span>
              <button type="button" onClick={() => fill('SuperAdmin')}>Use</button>
            </div>
          </div>
        </div>

        <div className="login-foot">
          <span>© {new Date().getFullYear()} Ledgerly Books. All rights reserved.</span>
          <span className="row" style={{ gap: 6 }}>
            <ShieldCheck size={14} /> 256-bit SSL secured
          </span>
        </div>
      </div>

      <div className="login-right" aria-hidden>
        <div className="login-hero">
          <span className="badge plain" style={{ background: 'rgba(255,255,255,.15)', color: '#fff', marginBottom: 18 }}>
            <BadgeCheck size={14} /> GST-ready billing for Indian businesses
          </span>
          <h2>Simple, secure accounting your business can trust.</h2>
          <p>Create GST invoices in seconds, track stock with barcode scanning, and close every financial year with confidence.</p>

          <div className="hero-stage">
            <div className="hero-card main">
              <div className="row between" style={{ marginBottom: 14 }}>
                <div className="row">
                  <div className="stat-icon tone-blue">
                    <Receipt size={18} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--ink-900)' }}>INV-2026-27-0128</div>
                    <div className="small muted">Nila Textiles · GSTIN 33AAFCN5678K1Z2</div>
                  </div>
                </div>
                <span className="badge badge-green">Paid</span>
              </div>
              {[
                ['Dell 24" FHD Monitor × 2', '₹24,998'],
                ['Annual Maintenance Contract', '₹5,999'],
                ['CGST 9% + SGST 9%', '₹5,579'],
              ].map(([a, b]) => (
                <div key={a} className="row between small" style={{ padding: '7px 0', borderBottom: '1px solid var(--ink-150)' }}>
                  <span className="muted">{a}</span>
                  <strong style={{ color: 'var(--ink-800)' }}>{b}</strong>
                </div>
              ))}
              <div className="row between" style={{ marginTop: 10 }}>
                <strong>Total</strong>
                <strong style={{ fontSize: 18, color: 'var(--brand-700)' }}>₹36,576</strong>
              </div>
            </div>
            <div className="hero-card float">
              <div className="row">
                <div className="stat-icon tone-green">
                  <TrendingUp size={18} />
                </div>
                <div>
                  <div className="small muted">Collections this month</div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--ink-900)' }}>₹4.8L</div>
                </div>
              </div>
            </div>
            <div className="hero-card float2">
              <div className="row">
                <div className="stat-icon tone-violet">
                  <Landmark size={18} />
                </div>
                <div>
                  <div className="small muted">FY 2026-27</div>
                  <div style={{ fontWeight: 700, color: 'var(--ink-900)' }}>Apr 1 – Mar 31</div>
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

      <Modal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        title="Reset your password"
        subtitle="We’ll email you a secure link to set a new password."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setForgotOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setForgotTouched(true);
                if (forgotErr) return;
                setForgotOpen(false);
                toast('success', 'Reset link sent', `If an account exists for ${forgotEmail}, you’ll receive an email shortly.`);
              }}
            >
              Send reset link
            </button>
          </>
        }
      >
        <Field label="Email address" required error={forgotTouched ? forgotErr : ''}>
          <input className={`input ${forgotTouched && forgotErr ? 'invalid' : ''}`} value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@company.com" autoFocus />
        </Field>
      </Modal>
    </div>
  );
}
