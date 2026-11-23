import { emailSuggestion } from '../../shared/contact';

/** "Did you mean name@gmail.com?" under an email field when the domain looks mistyped; one tap fixes it. */
export function EmailFix({ value, onChange, fix = emailSuggestion(value) }: { value: string; onChange: (v: string) => void; fix?: string | null }) {
  if (!fix) return null;
  return (
    <button type="button" onClick={() => onChange(fix)}
      style={{ display: 'block', marginTop: 4, padding: 0, border: 0, background: 'none', color: 'var(--amber-700)', font: 'inherit', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
      Did you mean <strong style={{ textDecoration: 'underline' }}>{fix}</strong>?
    </button>
  );
}
