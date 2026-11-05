import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, RefreshCw, X } from 'lucide-react';

interface DetectorLike { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> }
type DetectorCtor = new (opts?: { formats?: string[] }) => DetectorLike;
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];

/**
 * Bill with the phone or tablet camera instead of a USB scanner: point it at each item, one after another. Every
 * barcode read goes to onCode (the same path as a scanner), so quantities, IMEIs and offline billing all work.
 * Uses the browser's own barcode reader where it has one (Chrome on Android, Mac, ChromeOS), and a built-in reader
 * everywhere else (iPhone, Windows, Linux). The same code held in view is read once; move it away (or wait a moment)
 * to add another.
 */
export function CameraScanner({ open, onCode, onClose, mode, onMode, waitingFor }: { open: boolean; onCode: (code: string) => void; onClose: () => void; mode?: 'all' | 'imei'; onMode?: (m: 'all' | 'imei') => void; waitingFor?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [last, setLast] = useState('');
  const [engine, setEngine] = useState('');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopZxing: (() => void) | null = null;
    const seen = new Map<string, number>(); // code → last time read
    const got = (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const now = Date.now();
      // The same barcode stays in view for many frames: read it once, again only after 1.5 s out of view.
      const t = seen.get(code);
      seen.set(code, now);
      if (t && now - t < 1500) return;
      setLast(code);
      if (navigator.vibrate) navigator.vibrate(40);
      onCodeRef.current(code);
    };
    (async () => {
      setError(''); setLast('');
      if (!navigator.mediaDevices?.getUserMedia) { setError('This browser can’t open the camera. Use a USB scanner, type the code, or tap the item.'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        const name = (e as DOMException).name;
        setError(name === 'NotAllowedError' ? 'Camera permission was refused. Allow the camera for this site in the browser settings, then try again.'
          : name === 'NotFoundError' ? 'No camera found on this device.' : 'The camera could not be started. Close other apps using it and try again.');
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
      let native: DetectorLike | null = null;
      if (Native) {
        try {
          const supported = (await Native.getSupportedFormats?.()) ?? FORMATS;
          const formats = FORMATS.filter((f) => supported.includes(f));
          if (formats.length) native = new Native({ formats });
        } catch { native = null; }
      }
      if (native) {
        setEngine('device');
        const tick = async () => {
          if (stopped) return;
          try { if (v.readyState >= 2) for (const r of await native!.detect(v)) got(r.rawValue); } catch { /* frame not ready */ }
          raf = window.setTimeout(() => requestAnimationFrame(() => void tick()), 120) as unknown as number;
        };
        void tick();
        return;
      }
      // No barcode reader in this browser: use the built-in one (loaded only when needed, kept for offline use).
      setEngine('built-in');
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const { DecodeHintType, BarcodeFormat } = await import('@zxing/library');
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 300 });
        if (stopped) return;
        const controls = await reader.decodeFromVideoElement(v, (res) => { if (res) got(res.getText()); });
        stopZxing = () => controls.stop();
        if (stopped) stopZxing();
      } catch {
        setError('The barcode reader could not start. Use a USB scanner, type the code, or tap the item.');
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(raf);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, facing]);

  if (!open) return null;
  return (
    <div className="cam-scan" role="region" aria-label="Camera scanner">
      <div className="cam-head">
        <strong className="row" style={{ gap: 6 }}><Camera size={15} /> Camera scanner</strong>
        {onMode && (
          <span className="cam-mode" role="radiogroup" aria-label="What the camera reads">
            <button type="button" role="radio" aria-checked={mode !== 'imei'} className={mode !== 'imei' ? 'on' : ''} onClick={() => onMode('all')}>Items &amp; IMEI</button>
            <button type="button" role="radio" aria-checked={mode === 'imei'} className={mode === 'imei' ? 'on' : ''} onClick={() => onMode('imei')}>IMEI only</button>
          </span>
        )}
        <span className="small muted">{error ? '' : waitingFor ? <>Now the IMEI of <strong>{waitingFor}</strong></> : <>
          {mode === 'imei' ? 'IMEI labels only, model barcodes ignored' : last ? '' : 'Point the camera at a barcode or IMEI label'}
          {last && <>{mode === 'imei' ? ' · ' : ''}Read <span className="mono">{last.length > 40 ? `${last.slice(0, 40)}…` : last}</span></>}
        </>}</span>
        <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
          <button type="button" className="icon-btn sm" title="Switch camera" aria-label="Switch camera" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}><RefreshCw size={14} /></button>
          <button type="button" className="icon-btn sm" title="Close camera" aria-label="Close camera" onClick={onClose}><X size={15} /></button>
        </span>
      </div>
      {error ? (
        <div className="cam-error"><CameraOff size={18} /> {error}</div>
      ) : (
        <div className="cam-view">
          <video ref={videoRef} muted playsInline aria-label="Camera view" />
          <div className="cam-aim" aria-hidden="true" />
        </div>
      )}
      {engine && !error && <div className="small muted cam-foot">Each barcode is added once; move it away and back to add another.</div>}
    </div>
  );
}
