import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { IS_APP, IS_DESKTOP } from '@/lib/platform';

/** Google's "G", for the Super admin card. */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * "Continue with Google" is on when the super admin has set it up, and only on the website: Google refuses its
 * sign-in inside app web views (the phone app) and embedded browsers (the Windows app).
 */
export function useGoogleSignIn(): { on: boolean; clientId: string } {
  const q = useQuery({ queryKey: ['authGoogle'], queryFn: () => api.get<{ on: boolean; clientId?: string }>('/auth/google'), staleTime: 5 * 60_000, retry: false, enabled: !IS_APP && !IS_DESKTOP });
  return { on: !IS_APP && !IS_DESKTOP && !!q.data?.on && !!q.data.clientId, clientId: q.data?.clientId ?? '' };
}

type Gsi = { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } };
let loading: Promise<Gsi> | null = null;
function loadGsi(): Promise<Gsi> {
  const w = window as unknown as { google?: Gsi };
  if (w.google?.accounts?.id) return Promise.resolve(w.google);
  return (loading ??= new Promise<Gsi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (w.google ? resolve(w.google) : reject(new Error('Google sign-in didn’t load')));
    s.onerror = () => { loading = null; reject(new Error('Google sign-in couldn’t load. Check the internet connection.')); };
    document.head.appendChild(s);
  }));
}

/** Google's own button (their rules ask for it). Calls onCredential with Google's signed ID token. */
export function GoogleButton({ clientId, text = 'continue_with', onCredential }: { clientId: string; text?: 'signin_with' | 'signup_with' | 'continue_with'; onCredential: (credential: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [err, setErr] = useState('');
  useEffect(() => {
    let gone = false;
    loadGsi().then((g) => {
      if (gone || !box.current) return;
      g.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => cb.current(r.credential), ux_mode: 'popup', auto_select: false, context: text === 'signup_with' ? 'signup' : 'signin' });
      g.accounts.id.renderButton(box.current, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text, logo_alignment: 'center', width: Math.min(400, box.current.clientWidth || 320) });
    }).catch((e: Error) => !gone && setErr(e.message));
    return () => { gone = true; };
  }, [clientId, text]);
  return (
    <div className="google-btn">
      <div ref={box} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
      {err && <div className="small muted" style={{ textAlign: 'center' }}>{err}</div>}
    </div>
  );
}
