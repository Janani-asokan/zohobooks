import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUp, Check, Printer, RotateCw, Scissors, X, ZoomOut } from 'lucide-react';
import { usePrintSettings } from '@/api/hooks';
import { withPrintDefaults, type PaperSize } from '../../shared/printSettings';
import { RECEIPT_PRINTED, receiptMemory, receiptWidth, rememberReceipt, type ReceiptPrinted } from '@/lib/printerMemory';

/** The card: one question, big buttons, then what was done about it. Never printed. */
export function CheckCard({ title, children, onClose, inline }: { title: string; children: ReactNode; onClose: () => void; inline?: boolean }) {
  return (
    <div className={`print-check no-print ${inline ? 'inline' : ''}`} role="region" aria-label={title}>
      <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
        <strong className="row" style={{ gap: 6 }}><Printer size={16} /> {title}</strong>
        <button type="button" className="icon-btn sm" aria-label="Close" onClick={onClose}><X size={15} /></button>
      </div>
      {children}
    </div>
  );
}
export const Choice = ({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint?: string; onClick: () => void }) => (
  <button type="button" className="pc-choice" onClick={onClick}>{icon}<span><span className="strong">{label}</span>{hint && <span className="small muted">{hint}</span>}</span></button>
);

/** Steps for the one thing no web page can change: the paper size set in the printer's Windows driver. */
export function DriverSteps({ paper, children }: { paper: string; children?: ReactNode }) {
  return (
    <div className="pc-steps">
      <p className="small">The printer’s own settings on this computer are still set to a bigger paper (usually A4), so it shrinks everything to fit. This is set in Windows, which a web page can’t change. It takes a minute, once:</p>
      <ol className="small">
        <li>Windows <strong>Start → Settings → Bluetooth &amp; devices → Printers &amp; scanners</strong>, pick the printer, then <strong>Printing preferences</strong>.</li>
        <li>Set <strong>Paper size</strong> to <strong>{paper}</strong> and press OK.</li>
        <li>Print again. In Chrome’s print box, open <em>More settings</em> and pick the same paper size if it asks.</li>
      </ol>
      {children}
    </div>
  );
}

/**
 * After the first receipt printed on this computer (per roll size): "How did it come out?" One tap fixes the page
 * width for this printer and prints it again; if it still comes out small, the driver steps. Mounted in the app shell.
 */
export function ReceiptCheck() {
  const shop = withPrintDefaults(usePrintSettings().data).thermal.pageWidth;
  const [job, setJob] = useState<ReceiptPrinted | null>(null);
  const [step, setStep] = useState<'ask' | 'fixed' | 'driver' | 'thanks'>('ask');
  useEffect(() => {
    let t = 0;
    const on = (e: Event) => {
      const d = (e as CustomEvent<ReceiptPrinted>).detail;
      if (receiptMemory(d.paper)?.ok) return;
      // Give the print box time to close before asking.
      window.clearTimeout(t);
      t = window.setTimeout(() => { setJob(d); setStep('ask'); }, 1500);
    };
    window.addEventListener(RECEIPT_PRINTED, on);
    return () => { window.removeEventListener(RECEIPT_PRINTED, on); window.clearTimeout(t); };
  }, []);
  if (!job) return null;
  const paper: PaperSize = job.paper;
  const now = receiptWidth(paper, shop);
  const roll = paper === '2in' ? 58 : 80;
  const narrow = paper === '2in' ? 48 : 72;
  const close = () => setJob(null);
  const bad = () => {
    if (now === 'roll') { rememberReceipt(paper, { width: 'printable' }); setStep('fixed'); }
    else { rememberReceipt(paper, { width: 'printable', small: (receiptMemory(paper)?.small ?? 0) + 1 }); setStep('driver'); }
  };
  return (
    <CheckCard title={step === 'thanks' ? 'Receipt printer is set up' : 'Quick check, only this once'} onClose={close}>
      {step === 'ask' && <>
        <p className="small" style={{ margin: '6px 0 10px' }}>How did the {roll} mm receipt come out of the printer?</p>
        <div className="pc-choices">
          <Choice icon={<Check size={18} />} label="Looks right" hint="Full width, easy to read" onClick={() => { rememberReceipt(paper, { width: now, ok: true }); setStep('thanks'); setTimeout(close, 1800); }} />
          <Choice icon={<ZoomOut size={18} />} label="Small or squeezed" hint="Tiny text, or only part of the paper used" onClick={bad} />
          <Choice icon={<Scissors size={18} />} label="Cut off at the sides" hint="Letters missing at the edges" onClick={bad} />
        </div>
      </>}
      {step === 'fixed' && <>
        <p className="small" style={{ margin: '6px 0 10px' }}>Fixed for this printer: receipts now fit its {narrow} mm print width. Print it again to check.</p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => { setJob(null); job.reprint(); }}><Printer size={15} /> Print again</button>
      </>}
      {step === 'driver' && <DriverSteps paper={`${roll} mm roll (it may be called “${roll}(${narrow}) x 3276 mm” or “Roll paper ${roll} x 297 mm”)`}>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-primary" onClick={() => { rememberReceipt(paper, { width: 'roll' }); setJob(null); job.reprint(); }}><Printer size={15} /> Done, print again</button>
          <button type="button" className="btn btn-ghost" onClick={close}>Later</button>
        </div>
      </DriverSteps>}
      {step === 'thanks' && <p className="small" style={{ margin: '6px 0 0' }}>Thanks. This computer won’t ask again.</p>}
    </CheckCard>
  );
}

/** The next turn to try for a label that came out sideways or upside down. */
export const nextTurn = (turn: 0 | 90 | 180 | 270, how: 'sideways' | 'upside') => ((turn + (how === 'sideways' ? 90 : 180)) % 360) as 0 | 90 | 180 | 270;
export const TurnIcons = { right: <ArrowUp size={18} />, sideways: <RotateCw size={18} /> };
