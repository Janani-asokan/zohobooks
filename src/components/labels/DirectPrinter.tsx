import { useEffect, useState } from 'react';
import { Bluetooth, Loader2, Printer, Wifi } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { listBtDevices, type BtDevice } from '@/lib/btPrinter';
import { btLabelSupported, directConn, directSupported, setDirectConn, type DirectConn } from '@/lib/labelDirect';

/** The direct connection chosen on this phone, kept in step across screens. */
export function useDirectConn() {
  const [c, setC] = useState<DirectConn | null>(() => directConn());
  useEffect(() => {
    const on = () => setC(directConn());
    window.addEventListener('c360:label-direct', on);
    return () => window.removeEventListener('c360:label-direct', on);
  }, []);
  return c;
}

/** Phone app: print labels through the print screen, or straight to a Bluetooth / Wi-Fi label printer. */
export function DirectPrinterPicker() {
  const toast = useToast();
  const conn = useDirectConn();
  const [mode, setMode] = useState<'screen' | 'bt' | 'net'>(conn?.kind ?? 'screen');
  const [devices, setDevices] = useState<BtDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState(conn?.kind === 'net' ? conn.host : '');
  const [port, setPort] = useState(conn?.kind === 'net' ? String(conn.port) : '9100');
  if (!directSupported()) return null;

  const pick = (m: 'screen' | 'bt' | 'net') => {
    setMode(m);
    if (m === 'screen') setDirectConn(null);
    if (m === 'bt') void find();
  };
  const find = async () => {
    setBusy(true);
    try { setDevices(await listBtDevices()); } catch (e) { toast('error', 'Bluetooth', (e as Error).message); } finally { setBusy(false); }
  };
  const saveNet = () => {
    const h = host.trim();
    if (!/^[a-z0-9.-]+$/i.test(h)) { toast('error', 'Enter the printer’s IP address, e.g. 192.168.1.50'); return; }
    setDirectConn({ kind: 'net', host: h, port: Math.max(1, Math.min(65535, Number(port) || 9100)) });
    toast('success', `Labels will go straight to ${h}`);
  };

  return (
    <div className="field" data-testid="label-direct">
      <label>Send labels</label>
      <div className="ls-chips" role="radiogroup" aria-label="Send labels">
        <button type="button" role="radio" aria-checked={mode === 'screen'} className={mode === 'screen' ? 'on' : ''} onClick={() => pick('screen')}><Printer size={13} /> Print screen</button>
        {btLabelSupported() && <button type="button" role="radio" aria-checked={mode === 'bt'} className={mode === 'bt' ? 'on' : ''} onClick={() => pick('bt')}><Bluetooth size={13} /> Bluetooth</button>}
        <button type="button" role="radio" aria-checked={mode === 'net'} className={mode === 'net' ? 'on' : ''} onClick={() => pick('net')}><Wifi size={13} /> Wi-Fi</button>
      </div>
      {mode === 'screen' && <p className="small muted" style={{ marginTop: 4 }}>Straight to the printer is surer: it is told the exact label size, so labels never come out sideways.</p>}
      {mode === 'bt' && (
        <div style={{ marginTop: 6 }}>
          {conn?.kind === 'bt' && <p className="small"><strong>{conn.name}</strong> · labels print straight away. <button type="button" className="lb-linkname" onClick={() => void find()}>Change</button></p>}
          {busy && <p className="small muted"><Loader2 size={13} className="spin" /> Looking for paired printers…</p>}
          {devices && (
            <ul className="dash-list" aria-label="Paired devices">
              {devices.length === 0 && <li className="small muted">No paired devices. Pair the label printer in the phone’s Bluetooth settings (PIN often 0000 or 1234), then try again.</li>}
              {devices.map((d) => (
                <li key={d.address}><button type="button" className="btn btn-ghost btn-block" style={{ justifyContent: 'space-between' }}
                  onClick={() => { setDirectConn({ kind: 'bt', address: d.address, name: d.name }); setDevices(null); toast('success', `Labels will print on ${d.name}`); }}>
                  <span><strong>{d.name}</strong> <span className="muted small">{d.address}</span></span>{d.printer && <span className="badge">printer</span>}
                </button></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {mode === 'net' && (
        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: '1 1 140px' }} inputMode="decimal" placeholder="Printer IP, e.g. 192.168.1.50" aria-label="Printer IP address" value={host} onChange={(e) => setHost(e.target.value)} />
          <input className="input" style={{ width: 80 }} inputMode="numeric" aria-label="Port" value={port} onChange={(e) => setPort(e.target.value)} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={saveNet}>Use</button>
          {conn?.kind === 'net' && <p className="small muted" style={{ width: '100%', margin: 0 }}>Sending to {conn.host}:{conn.port}. The IP is on the printer’s self-test page (hold the feed button while switching it on).</p>}
        </div>
      )}
    </div>
  );
}
