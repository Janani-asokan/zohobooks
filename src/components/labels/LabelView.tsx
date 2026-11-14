import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import {
  QUIET, badChar, dotsPerMm, elementCode, elementSymbology, elementText, fitBarcode, fitText, type LabelData, type LabelElement, type LabelTemplateBody, type Symbology,
  withLonePrices,
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
  // The bars start on a whole printer dot: a barcode centred by a fraction of a dot prints its 2-dot bars as 1 and 3
  // dots wide (and stops scanning). Offset from the element, snapped to the printer's dot grid.
  const dpm = dotsPerMm(dpi);
  const free = Math.max(0, el.w - fit.widthMm);
  // Centred = the bars centred (EAN keeps a wider blank on the left than the right; both stay inside the box).
  const ql = QUIET[sym][0] * fit.moduleMm, qr = QUIET[sym][1] * fit.moduleMm;
  const barsMm = fit.widthMm - ql - qr;
  const want = el.align === 'left' ? 0 : el.align === 'right' ? free : Math.min(free, Math.max(0, (el.w - barsMm) / 2 - ql));
  const off = Math.max(0, Math.min(free, Math.round((el.x + want) * dpm) / dpm - el.x));
  return (
    // Exactly the barcode's width, moved by the snapped offset (a full-width box would centre it a second time).
    <div className="lv-bars" style={{ alignItems: 'center', width: `${fit.widthMm}mm`, marginLeft: `${off}mm`, alignSelf: 'flex-start' }} data-bars-off={off}>
      <svg ref={ref} className={showQuiet ? 'lv-quiet' : ''} role="img" aria-label={`Barcode ${code}`} data-module-mm={fit.moduleMm} data-modules={fit.modules} />
      {el.showValue && <div className="lv-value" style={{ fontSize: `${valueH * 0.82}mm`, width: `${fit.widthMm}mm` }}>{code}</div>}
    </div>
  );
}

/**
 * A text field that always stays inside its box. The engine's estimate picks the starting size; then the real text is
 * measured and shrunk in 0.1 mm steps (down to the field's smallest size) until it fits its lines and its box. Text
 * that still does not fit at the smallest size is cut with an ellipsis, never drawn over the next label.
 */
function FitField({ el, text, cls, box, pick }: { el: LabelElement; text: string; cls: string; box: React.CSSProperties; pick: Record<string, unknown> }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const f = fitText(text, el);
  const lines = Math.max(1, el.maxLines ?? 1);
  const min = Math.min(f.size, el.minSize ?? 1.4);
  const one = lines === 1;
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current; if (!o || !i) return;
    let size = f.size;
    // Measure the text unclipped (no ellipsis, no line clamp: they hide what does not fit from the measurement),
    // then put the clip back as a last resort for text that is still too long at the smallest size.
    const saved = { width: i.style.width, display: i.style.display, clamp: i.style.webkitLineClamp, maxH: i.style.maxHeight, overflow: i.style.overflow, ws: i.style.whiteSpace };
    // Measured against 96 % of the width: text is drawn a little wider at print and high screen resolutions than it
    // measures here, and a name that only just fits would lose its last word there.
    const SAFE = 0.96;
    i.style.overflow = 'visible'; i.style.maxHeight = 'none'; i.style.webkitLineClamp = 'unset';
    if (one) i.style.display = 'inline-block'; else i.style.width = `${SAFE * 100}%`;
    const fits = () => {
      const lineH = parseFloat(getComputedStyle(i).fontSize) * 1.15;
      return (one ? i.scrollWidth <= o.clientWidth * SAFE : i.scrollWidth <= i.clientWidth + 0.5) && i.getBoundingClientRect().height <= Math.min(o.getBoundingClientRect().height, lineH * lines) + 0.25;
    };
    i.style.fontSize = `${size}mm`;
    for (let n = 0; n < 80 && !fits() && size - 0.1 >= min - 1e-9; n++) { size = Math.round((size - 0.1) * 10) / 10; i.style.fontSize = `${size}mm`; }
    const ok = fits();
    Object.assign(i.style, { width: saved.width, display: saved.display, maxHeight: saved.maxH, overflow: saved.overflow, whiteSpace: saved.ws }); i.style.webkitLineClamp = saved.clamp;
    if (!ok) o.dataset.overflow = 'true'; else delete o.dataset.overflow;
  }, [text, f.size, min, el.w, el.h, lines, el.bold]);
  return (
    <div className={cls} ref={outer} {...pick} data-el={el.id}
      style={{ ...box, fontWeight: el.bold ? 800 : 500, justifyContent: el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center', alignItems: 'center', overflow: 'hidden' }}>
      <span ref={inner} className="lv-fit" style={{ fontSize: `${f.size}mm`, textAlign: el.align ?? 'left', lineHeight: 1.15, maxWidth: '100%', maxHeight: '100%',
        ...(one ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' } : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines, overflow: 'hidden', overflowWrap: 'anywhere', width: '100%' }) }}>
        {el.overflow === 'truncate' ? f.text : text}
      </span>
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
      {(design ? tpl.elements : withLonePrices(tpl, data)).map((el) => {
        const box: React.CSSProperties = { left: `${el.x}mm`, top: `${el.y}mm`, width: `${el.w}mm`, height: `${el.h}mm` };
        const pick = design?.onPick ? { onPointerDown: (e: React.PointerEvent) => design.onPick!(el.id, e) } : {};
        const cls = `lv-el lv-${el.type} ${design?.selected === el.id ? 'sel' : ''}`;
        if (el.type === 'barcode' || el.type === 'qr') {
          const code = elementCode(el, data);
          const sym = elementSymbology(el, code);
          const bad = !code ? 'No barcode' : badChar(code, sym) ? `“${badChar(code, sym)}” can’t go in a barcode` : '';
          return (
            <div key={el.id} className={cls} style={{ ...box, justifyContent: el.type === 'barcode' && !bad ? 'flex-start' : el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center' }} {...pick} data-el={el.id}>
              {bad ? <div className="lv-err">{bad}</div> : sym === 'QR' ? <Qr code={code} el={el} dpi={dpi} /> : <Bars code={code} sym={sym} el={el} dpi={dpi} showQuiet={!!design} />}
            </div>
          );
        }
        if (el.type === 'line') return <div key={el.id} className={cls} style={{ ...box, height: el.h ? `${el.h}mm` : `${el.stroke ?? 0.3}mm`, width: el.w ? `${el.w}mm` : `${el.stroke ?? 0.3}mm`, background: '#000' }} {...pick} data-el={el.id} />;
        if (el.type === 'box') return <div key={el.id} className={cls} style={{ ...box, border: `${el.stroke ?? 0.3}mm solid #000` }} {...pick} data-el={el.id} />;
        const text = elementText(el, data);
        return <FitField key={el.id} el={el} text={text} cls={cls} box={box} pick={pick} />;
      })}
    </div>
  );
});
