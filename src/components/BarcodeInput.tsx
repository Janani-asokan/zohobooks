import { useEffect, useRef, useState } from 'react';
import { Camera, ScanBarcode, X } from 'lucide-react';

interface DetectorLike {
  detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => DetectorLike;
  }
}

/**
 * Barcode field. USB/Bluetooth scanners behave like keyboards and finish with Enter,
 * so the field autofocuses and fires onScan on Enter. Devices with a camera and the
 * BarcodeDetector API can also scan through the webcam.
 */
export function BarcodeInput({
  value,
  onChange,
  onScan,
  autoFocus,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  onScan?: (code: string) => void;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);
  const [camError, setCamError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (autoFocus) setTimeout(() => ref.current?.focus(), 60);
  }, [autoFocus]);

  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
        setCamError('Camera scanning isn’t supported in this browser. Use a USB scanner or type the code.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await det.detect(v);
            if (codes[0]?.rawValue) {
              onChange(codes[0].rawValue);
              onScan?.(codes[0].rawValue);
              setCamera(false);
              return;
            }
          } catch {
            /* frame not ready */
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setCamError('Camera permission was denied.');
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera]);

  return (
    <div>
      <div className="input-group trail-pad">
        <span className="lead" style={{ color: 'var(--brand-600)' }}>
          <ScanBarcode size={17} />
        </span>
        <input
          ref={ref}
          className={`input ${invalid ? 'invalid' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (value) onScan?.(value);
            }
          }}
          placeholder="Scan or type barcode, then press Enter"
          style={{ fontFamily: 'ui-monospace, Menlo, monospace', letterSpacing: '.04em', height: 44, borderStyle: 'dashed', borderColor: invalid ? undefined : 'var(--brand-200)', background: 'var(--brand-50)' }}
        />
        <span className="trail">
          <button type="button" className="icon-btn" title="Scan with camera" onClick={() => { setCamError(''); setCamera((c) => !c); }}>
            {camera ? <X size={16} /> : <Camera size={16} />}
          </button>
        </span>
      </div>
      {camera && (
        <div style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', background: '#18181b', position: 'relative' }}>
          {camError ? (
            <div className="small" style={{ color: '#fecaca', padding: 14 }}>{camError}</div>
          ) : (
            <>
              <video ref={videoRef} style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }} muted playsInline />
              <div style={{ position: 'absolute', left: '10%', right: '10%', top: '50%', height: 2, background: '#ef4444', boxShadow: '0 0 12px #ef4444' }} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
