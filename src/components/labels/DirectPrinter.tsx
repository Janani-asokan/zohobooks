import { useEffect, useState } from 'react';
import { Bluetooth, Check, Download, Loader2, Monitor, Printer, RefreshCw, Wifi } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { listBtDevices, type BtDevice } from '@/lib/btPrinter';
import { btLabelSupported, directConn, directSupported, setDirectConn, type DirectConn } from '@/lib/labelDirect';
import { HELPER_DOWNLOAD, helperStatus, likelyLabelPrinter, type HelperStatus } from '@/lib/pcHelper';

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
  const [mode, setMode] = useState<'screen' | 'bt' | 'net'>(conn?.kind === 'bt' || conn?.kind === 'net' ? conn.kind : 'screen');
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

/**
 * Website on a Windows PC: print through the Print window (needs the printer's paper size set in Windows), or
 * straight to the label printer through the Corpus360 Print Helper (exact label size, nothing to set in Windows).
 */
export function PcHelperPicker() {
  const toast = useToast();
  const conn = useDirectConn();
  const pc = conn?.kind === 'pc' ? conn : null;
  const [mode, setMode] = useState<'screen' | 'pc'>(pc ? 'pc' : 'screen');
  const [status, setStatus] = useState<HelperStatus | null | 'checking'>(null);
  const [pick, setPick] = useState(pc?.printer ?? '');
  const isWindows = /Windows/i.test(navigator.userAgent);
  const check = async () => {
    setStatus('checking');
    const s = await helperStatus();
    setStatus(s);
    if (s && !pick) setPick(likelyLabelPrinter(s.printers));
  };
  useEffect(() => { if (mode === 'pc') void check(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode]);
  const choose = (m: 'screen' | 'pc') => { setMode(m); if (m === 'screen') setDirectConn(null); };
  const use = () => { if (!pick) return; setDirectConn({ kind: 'pc', printer: pick }); toast('success', `Labels go straight to ${pick}`); };

  return (
    <div className="field" data-testid="label-direct">
      <label>Send labels</label>
      <div className="ls-chips" role="radiogroup" aria-label="Send labels">
        <button type="button" role="radio" aria-checked={mode === 'screen'} className={mode === 'screen' ? 'on' : ''} onClick={() => choose('screen')}><Printer size={13} /> Print window</button>
        <button type="button" role="radio" aria-checked={mode === 'pc'} className={mode === 'pc' ? 'on' : ''} onClick={() => choose('pc')}><Monitor size={13} /> Straight to the printer</button>
      </div>
      {mode === 'screen' && <p className="small muted" style={{ marginTop: 4 }}>Labels on A4 or sideways? Choose <b>Straight to the printer</b>: the printer is told the exact label size, with nothing to set in Windows.</p>}
      {mode === 'pc' && status === 'checking' && <p className="small muted" style={{ marginTop: 6 }}><Loader2 size={13} className="spin" /> Looking for the Corpus360 Print Helper on this computer…</p>}
      {mode === 'pc' && status === null && (
        <div className="lp-card" data-testid="helper-install">
          <div className="lp-head">
            <span className="lp-icon" aria-hidden="true"><Download size={18} /></span>
            <div className="lp-title"><strong>Install the print helper once</strong><span>A small free program for {isWindows ? 'this Windows PC' : 'Windows PCs'}. It sends labels straight to the label printer.</span></div>
          </div>
          <ol className="lp-steps">
            <li><span className="lp-n">1</span><div><strong>Download and open it</strong>
              <span><a className="btn btn-primary btn-sm" href={HELPER_DOWNLOAD} download style={{ margin: '4px 0' }}><Download size={14} /> Download Corpus360PrintHelper.exe</a><br />If Windows says <i>“Windows protected your PC”</i>, click <b>More info → Run anyway</b>.</span></div></li>
            <li><span className="lp-n">2</span><div><strong>It says “The print helper is running”</strong>
              <span>Click OK. It starts by itself with Windows from now on; nothing else to install.</span></div></li>
            <li><span className="lp-n">3</span><div><strong>Come back here</strong>
              <span><button type="button" className="btn btn-secondary btn-sm" onClick={() => void check()} style={{ margin: '4px 0' }}><RefreshCw size={14} /> Check again</button><br />If Chrome asks to let this site use <i>apps on this device</i>, click <b>Allow</b>.</span></div></li>
          </ol>
        </div>
      )}
      {mode === 'pc' && status && status !== 'checking' && (
        <div style={{ marginTop: 6 }} data-testid="helper-ready">
          {status.printers.length === 0 ? <p className="small">The print helper is running, but Windows has no printers. Connect the label printer and install its driver, then <button type="button" className="lb-linkname" onClick={() => void check()}>check again</button>.</p> : <>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <select className="select" style={{ flex: '1 1 180px' }} aria-label="Label printer" value={pick} onChange={(e) => setPick(e.target.value)}>
                {status.printers.map((p) => <option key={p.name} value={p.name}>{p.name}{p.default ? ' (default)' : ''}</option>)}
              </select>
              <button type="button" className="btn btn-secondary btn-sm" onClick={use} disabled={!pick || pc?.printer === pick}>{pc?.printer === pick ? <><Check size={14} /> In use</> : 'Use this printer'}</button>
            </div>
            <p className="small muted" style={{ marginTop: 4 }}>{pc ? <>Labels go straight to <b>{pc.printer}</b> at the exact label size. Press <b>Test print</b> to check.</> : 'Pick the label printer, then Use this printer.'}</p>
          </>}
        </div>
      )}
    </div>
  );
}
