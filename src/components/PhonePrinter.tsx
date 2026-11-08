import { useEffect, useState } from 'react';
import { Bluetooth, Loader2, Printer, RefreshCw, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { btPrinter, btSupported, btTestPrint, listBtDevices, setBtPrinter, type BtDevice, type BtPrinter } from '@/lib/btPrinter';
import { Segmented } from './ui';

/** The printer chosen on this phone, kept in step across screens. */
export function useBtPrinter() {
  const [p, setP] = useState<BtPrinter | null>(() => btPrinter());
  useEffect(() => {
    const on = () => setP(btPrinter());
    window.addEventListener('c360:bt-printer', on);
    return () => window.removeEventListener('c360:bt-printer', on);
  }, []);
  return p;
}

/** Android app: choose the Bluetooth receipt printer paired with this phone, and print a test slip. */
export function PhonePrinterCard({ defaultWidth = 58 }: { defaultWidth?: 58 | 80 }) {
  const toast = useToast();
  const current = useBtPrinter();
  const [devices, setDevices] = useState<BtDevice[] | null>(null);
  const [busy, setBusy] = useState<'list' | 'test' | null>(null);
  const [width, setWidth] = useState<58 | 80>(current?.widthMm ?? defaultWidth);
  if (!btSupported()) return null;

  const find = async () => {
    setBusy('list');
    try { setDevices(await listBtDevices()); } catch (e) { toast('error', 'Bluetooth', (e as Error).message); } finally { setBusy(null); }
  };
  const choose = (d: BtDevice) => { setBtPrinter({ address: d.address, name: d.name, widthMm: width }); setDevices(null); toast('success', `Receipts will print on ${d.name}`); };
  const test = async () => {
    if (!current) return;
    setBusy('test');
    try { await btTestPrint(current); toast('success', 'Test slip sent'); } catch (e) { toast('error', 'Printer', (e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div className="ps-sec phone-printer" data-testid="phone-printer">
      <h3 className="row" style={{ gap: 6 }}><Bluetooth size={16} /> Bluetooth printer on this phone</h3>
      <p className="small muted" style={{ margin: '2px 0 8px' }}>
        Pair the receipt printer once in the phone’s Bluetooth settings, then choose it here. Receipts then print straight away, with no print screen.
      </p>
      <div className="field">
        <label>Roll width</label>
        <Segmented value={String(width) as '58' | '80'} onChange={(v) => { const w = Number(v) as 58 | 80; setWidth(w); if (current) setBtPrinter({ ...current, widthMm: w }); }}
          options={[{ value: '58', label: '58 mm (2 inch)' }, { value: '80', label: '80 mm (3 inch)' }]} />
      </div>
      {current ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <span className="badge badge-green"><Printer size={13} /> {current.name}</span>
          <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={test}>{busy === 'test' ? <Loader2 size={14} className="spin" /> : <Printer size={14} />} Print a test slip</button>
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={find}><RefreshCw size={14} /> Change</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setBtPrinter(null)}><X size={14} /> Use the print screen instead</button>
        </div>
      ) : (
        <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} disabled={!!busy} onClick={find}>
          {busy === 'list' ? <Loader2 size={15} className="spin" /> : <Bluetooth size={15} />} Choose a Bluetooth printer
        </button>
      )}
      {devices && (
        <ul className="dash-list" style={{ marginTop: 8 }} aria-label="Paired devices">
          {devices.length === 0 && <li className="small muted">No paired devices. Pair the printer in the phone’s Bluetooth settings (its PIN is often 0000 or 1234), then try again.</li>}
          {devices.map((d) => (
            <li key={d.address}><button type="button" className="btn btn-ghost btn-block" style={{ justifyContent: 'space-between' }} onClick={() => choose(d)}>
              <span><strong>{d.name}</strong> <span className="muted small">{d.address}</span></span>{d.printer && <span className="badge">printer</span>}
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
