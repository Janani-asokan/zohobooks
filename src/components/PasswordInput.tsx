import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

export const passwordScore = (p: string) => {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
};

export function PasswordInput({ value, onChange, invalid, autoComplete = 'current-password', placeholder, meter, autoFocus, id }: {
  value: string; onChange: (v: string) => void; invalid?: boolean; autoComplete?: string; placeholder?: string; meter?: boolean; autoFocus?: boolean; id?: string;
}) {
  const [show, setShow] = useState(false);
  const score = passwordScore(value);
  const colors = ['var(--red-500)', 'var(--red-500)', 'var(--amber-600)', 'var(--green-600)', 'var(--green-600)'];
  const labels = ['Too weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
  return (
    <div>
      <div className="input-group trail-pad">
        <span className="lead"><Lock size={16} /></span>
        <input id={id} className={`input ${invalid ? 'invalid' : ''}`} type={show ? 'text' : 'password'} autoComplete={autoComplete} placeholder={placeholder ?? 'Enter your password'} value={value} onChange={(e) => onChange(e.target.value)} style={{ height: 44 }} autoFocus={autoFocus} />
        <span className="trail">
          <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </span>
      </div>
      {meter && value && (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {[0, 1, 2, 3].map((i) => <span key={i} style={{ height: 4, flex: 1, borderRadius: 4, background: i < score ? colors[score] : 'var(--ink-150)' }} />)}
          </div>
          <span className="small" style={{ color: colors[score], fontWeight: 600, minWidth: 74, textAlign: 'right' }}>{labels[score]}</span>
        </div>
      )}
    </div>
  );
}
