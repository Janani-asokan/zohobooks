import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui';

/**
 * The app's own "type a value" box, instead of the browser's window.prompt(): the Windows app (Electron) doesn't
 * support window.prompt at all, so buttons that used it did nothing there. Mounted once at the root (AskHost).
 */
type Req = { message: string; value: string; resolve: (v: string | null) => void };
let open: ((r: Req) => void) | null = null;

export function askText(message: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => { if (open) open({ message, value, resolve }); else resolve(window.prompt(message, value)); });
}

export function AskHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [v, setV] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { open = (r) => { setReq(r); setV(r.value); }; return () => { open = null; }; }, []);
  useEffect(() => { if (req) setTimeout(() => input.current?.select(), 30); }, [req]);
  const done = (val: string | null) => { req?.resolve(val); setReq(null); };
  return (
    <Modal open={!!req} onClose={() => done(null)} title={req?.message ?? ''}
      footer={<><button className="btn btn-secondary" onClick={() => done(null)}>Cancel</button><button className="btn btn-primary" onClick={() => done(v)}>OK</button></>}>
      <input ref={input} className="input" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); done(v); } }} aria-label={req?.message} />
    </Modal>
  );
}
