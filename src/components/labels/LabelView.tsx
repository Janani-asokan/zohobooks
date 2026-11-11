import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import {
  QUIET, badChar, elementCode, elementSymbology, elementText, fitBarcode, fitText, type LabelData, type LabelElement, type LabelTemplateBody, type Symbology,
} from '../../../shared/labelEngine';

/** A linear barcode at a whole-dot narrow bar, with quiet zones, never stretched (ML-11). */
function Bars({ code, sym, el, dpi, showQuiet }: { code: string; sym: Exclude<Symbology, 'QR'>; el: LabelElement; dpi: number; showQuiet?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const fit = fitBarcode(code, sym, el.w, dpi);
  const valueH = el.showValue ? Math.min(Math.max(2.6, el.h * 0.09), 5, el.h * 0.25) : 0;
  const barsH = Math.max(1, el.h - valueH);
  useLayoutEffect(() => {
    const svg = ref.current; if (!svg || !fit.ok) return;
    try {
      JsBarcode(svg, code, { format: sym === 'UPC' ? 'UPC' : sym, width: 1, height: 50, margin: 0, marginLeft: QUIET[sym][0], marginRight: QUIET[sym][1], displayValue: false, flat: true });
      svg.removeAttribute('width'); svg.removeAttribute('height'); svg.setAttribute('preserveAspectRatio', 'none');
      svg.style.width = `${fit.widthMm}mm`; svg.style.height = `${barsH}mm`;
    } catch { /* validator reports it */ }
  }, [code, sym, fit.widthMm, barsH, fit.ok]);
  if (!fit.ok) return <div className="lv-err">Barcode too long for this space</div>;
  const just = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center';
  return (
    <div className="lv-bars" style={{ alignItems: just }}>
      <svg ref={ref} className={showQuiet ? 'lv-quiet' : ''} role="img" aria-label={`Barcode ${code}`} data-module-mm={fit.moduleMm} data-modules={fit.modules} />
      {el.showValue && <div className="lv-value" style={{ fontSize: `${valueH * 0.82}mm`, width: `${fit.widthMm}mm` }}>{code}</div>}
    </div>
  );
}

/** A QR code drawn as squares on whole dots. */
function Qr({ code, el, dpi }: { code: string; el: LabelElement; dpi: number }) {
  const side = Math.min(el.w, el.h);
  const fit = fitBarcode(code, 'QR', side, dpi);
  const path = useMemo(() => {
    try {
      const q = QRCode.create(code, { errorCorrectionLevel: 'M' });
      const n = q.modules.size; let d = '';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules.get(x, y)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      return { d, n: n + 8 };
    } catch { return null; }
  }, [code]);
  if (!fit.ok || !path) return <div className="lv-err">QR too big for this space</div>;
  const mm = path.n * fit.moduleMm;
  return <svg className="lv-qrsvg" viewBox={`0 0 ${path.n} ${path.n}`} style={{ width: `${mm}mm`, height: `${mm}mm` }} shapeRendering="crispEdges" role="img" aria-label={`QR code ${code}`}><path d={path.d} fill="#000" /></svg>;
}

export interface LabelViewProps {
  tpl: LabelTemplateBody; data: LabelData; dpi?: number;
  /** Designer: show safe area, quiet zones, element outlines, and highlight the selected element. */
  design?: { safe: number; selected?: string | null; onPick?: (id: string, e: React.PointerEvent) => void };
}
/** One label, drawn at its real size in mm from a template and an item's data. Same layout on screen and paper. */
export const LabelView = memo(function LabelView({ tpl, data, dpi = 203, design }: LabelViewProps) {
  return (
    <div className={`lv ${design ? 'lv-design' : ''}`} style={{ width: `${tpl.w}mm`, height: `${tpl.h}mm` }}>
      {design && <div className="lv-safe" style={{ inset: `${design.safe}mm` }} aria-hidden="true" />}
      {tpl.elements.map((el) => {
        const box: React.CSSProperties = { left: `${el.x}mm`, top: `${el.y}mm`, width: `${el.w}mm`, height: `${el.h}mm` };
        const pick = design?.onPick ? { onPointerDown: (e: React.PointerEvent) => design.onPick!(el.id, e) } : {};
        const cls = `lv-el lv-${el.type} ${design?.selected === el.id ? 'sel' : ''}`;
        if (el.type === 'barcode' || el.type === 'qr') {
          const code = elementCode(el, data);
          const sym = elementSymbology(el, code);
          const bad = !code ? 'No barcode' : badChar(code, sym) ? `“${badChar(code, sym)}” can’t go in a barcode` : '';
          return (
            <div key={el.id} className={cls} style={{ ...box, justifyContent: el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center' }} {...pick} data-el={el.id}>
              {bad ? <div className="lv-err">{bad}</div> : sym === 'QR' ? <Qr code={code} el={el} dpi={dpi} /> : <Bars code={code} sym={sym} el={el} dpi={dpi} showQuiet={!!design} />}
            </div>
          );
        }
        if (el.type === 'line') return <div key={el.id} className={cls} style={{ ...box, height: el.h ? `${el.h}mm` : `${el.stroke ?? 0.3}mm`, width: el.w ? `${el.w}mm` : `${el.stroke ?? 0.3}mm`, background: '#000' }} {...pick} data-el={el.id} />;
        if (el.type === 'box') return <div key={el.id} className={cls} style={{ ...box, border: `${el.stroke ?? 0.3}mm solid #000` }} {...pick} data-el={el.id} />;
        const text = elementText(el, data);
        const f = fitText(text, el);
        return (
          <div key={el.id} className={cls} {...pick} data-el={el.id} data-overflow={f.overflow || undefined}
            style={{ ...box, fontSize: `${f.size}mm`, fontWeight: el.bold ? 800 : 500, textAlign: el.align ?? 'left', WebkitLineClamp: el.maxLines ?? 1, lineHeight: 1.15 }}>
            {el.overflow === 'truncate' ? f.text : text}
          </div>
        );
      })}
    </div>
  );
});
