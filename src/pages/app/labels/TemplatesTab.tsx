import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Barcode, Copy, Minus, Pencil, Plus, QrCode, Square, Star, Trash2, Type, Upload, Wand2 } from 'lucide-react';
import { api } from '@/api/client';
import { useItems, useOrg, usePrintSettings } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui';
import { withPrintDefaults } from '../../../../shared/printSettings';
import {
  FIELD_LABEL, LABEL_FIELDS, STOCK_PRESETS, fitBarcode, validateJob, elementCode, elementSymbology,
  type LabelElement, type LabelField, type LabelTemplateBody,
} from '../../../../shared/labelEngine';
import { LabelView } from '@/components/labels/LabelView';
import { LABEL_KEYS, SAMPLE_DATA, autoFromSettings, labelDataFor, useLabelSetup, type TemplateRow } from '@/components/labels/labelsApi';

const PX_PER_MM = 3.7795;
const r1 = (n: number) => Math.round(n * 10) / 10;
const snapTo = (n: number, s: number) => (s ? Math.round(n / s) * s : n);
let n = 0; const id = () => `e${Date.now().toString(36)}${(n++).toString(36)}`;
const SIZES = [...new Map(STOCK_PRESETS.map((p) => [`${p.stock.w}x${p.stock.h}`, { w: p.stock.w, h: p.stock.h }])).values()];

/** Templates (spec 2.3): list, create, clone, publish, defaults per shop and category; the millimetre designer. */
export default function TemplatesTab() {
  const me = useShopUser();
  const toast = useToast();
  const qc = useQueryClient();
  const setup = useLabelSetup();
  const ps = withPrintDefaults(usePrintSettings().data);
  const items = useItems().data ?? [];
  const cats = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items]);
  const manage = me.can('items.write');
  const [editing, setEditing] = useState<{ id?: string; name: string; body: LabelTemplateBody } | null>(null);
  const [newSize, setNewSize] = useState<{ w: number; h: number } | null>(null);
  const [defaults, setDefaults] = useState<TemplateRow | null>(null);
  const [defCats, setDefCats] = useState<string[]>([]);
  const refresh = () => qc.invalidateQueries({ queryKey: LABEL_KEYS.setup });
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast('success', ok); refresh(); } catch (e) { toast('error', 'Could not do that', (e as Error).message); } };
  if (editing) return <Designer start={editing} onClose={() => { setEditing(null); refresh(); }} />;
  const list = setup.data?.templates ?? [];
  return (
    <section className="card ls-panel" aria-label="Templates">
      <div className="row between"><h3>Label templates</h3>
        {manage && <button className="btn btn-primary btn-sm" onClick={() => setNewSize(SIZES[2] ?? { w: 50, h: 25 })}><Plus size={14} /> New template</button>}</div>
      <p className="small muted">A template is the layout of one label. Publishing makes a version that print jobs use and never changes; edit freely and publish again. Without a template, labels use the auto layout from Print settings.</p>
      <div className="lb-tgrid">
        {list.map((t) => (
          <div key={t.id} className="lb-tcard">
            <div className="lb-tthumb">{(t.published ?? t.draft) && <div style={{ zoom: Math.min(2.4, 200 / ((t.published ?? t.draft).w * PX_PER_MM)) } as React.CSSProperties}><LabelView tpl={t.published ?? t.draft} data={SAMPLE_DATA} /></div>}</div>
            <div className="strong">{t.name}</div>
            <div className="small muted">{(t.published ?? t.draft).w} × {(t.published ?? t.draft).h} mm · {t.version ? `v${t.version}` : 'not published'}{t.dirty && t.version ? ' · unpublished changes' : ''}</div>
            <div className="small">{t.isDefault && <span className="badge green">Shop default</span>} {t.categories.map((c) => <span key={c} className="badge">{c}</span>)}</div>
            {manage && <div className="row" style={{ gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-soft btn-sm" onClick={() => setEditing({ id: t.id, name: t.name, body: t.draft })}><Pencil size={13} /> Edit</button>
              {t.dirty && <button className="btn btn-soft btn-sm" onClick={() => void run(() => api.post(`/shop/label/templates/${t.id}/publish`), `Published ${t.name} v${t.version + 1}`)}><Upload size={13} /> Publish</button>}
              <button className="icon-btn sm" aria-label={`Copy ${t.name}`} onClick={() => void run(() => api.post(`/shop/label/templates/${t.id}/clone`), 'Copied')}><Copy size={13} /></button>
              {t.version > 0 && <button className="icon-btn sm" aria-label={`Defaults for ${t.name}`} title="Make default" onClick={() => { setDefaults(t); setDefCats(t.categories); }}><Star size={13} /></button>}
              <button className="icon-btn sm danger" aria-label={`Delete ${t.name}`} onClick={() => void run(() => api.del(`/shop/label/templates/${t.id}`), 'Deleted')}><Trash2 size={13} /></button>
            </div>}
          </div>
        ))}
        {!list.length && <p className="muted small">No templates yet.</p>}
      </div>
      <Modal open={!!newSize} onClose={() => setNewSize(null)} title="New template" subtitle="Pick the label size; you can use it on any stock with this size, 1 to 4 across."
        footer={<><button className="btn btn-secondary" onClick={() => setNewSize(null)}>Cancel</button><button className="btn btn-primary" onClick={() => { setEditing({ name: `${newSize!.w} × ${newSize!.h} label`, body: autoFromSettings(newSize!.w, newSize!.h, ps.barcode) }); setNewSize(null); }}>Start designing</button></>}>
        {newSize && <div className="lb-form">
          <div className="ls-chips">{SIZES.map((s) => <button key={`${s.w}x${s.h}`} type="button" className={newSize.w === s.w && newSize.h === s.h ? 'on' : ''} onClick={() => setNewSize(s)}>{s.w} × {s.h}</button>)}</div>
          <div className="ls-two"><div className="field"><label htmlFor="nt-w">Width (mm)</label><input id="nt-w" className="input" type="number" min={10} max={200} value={newSize.w} onChange={(e) => setNewSize({ ...newSize, w: Math.max(10, Math.min(200, Number(e.target.value) || 10)) })} /></div>
            <div className="field"><label htmlFor="nt-h">Height (mm)</label><input id="nt-h" className="input" type="number" min={8} max={300} value={newSize.h} onChange={(e) => setNewSize({ ...newSize, h: Math.max(8, Math.min(300, Number(e.target.value) || 8)) })} /></div></div>
        </div>}
      </Modal>
      <Modal open={!!defaults} onClose={() => setDefaults(null)} title={`Defaults for ${defaults?.name ?? ''}`} subtitle="The most specific default wins: a category’s template, then the shop’s."
        footer={<><button className="btn btn-secondary" onClick={() => setDefaults(null)}>Cancel</button><button className="btn btn-primary" onClick={() => { const t = defaults!; setDefaults(null); void run(() => api.put(`/shop/label/templates/${t.id}/default`, { isDefault: (document.getElementById('def-shop') as HTMLInputElement).checked, categories: defCats }), 'Defaults saved'); }}>Save</button></>}>
        {defaults && <div className="lb-form">
          <label className="row small" style={{ gap: 6 }}><input id="def-shop" type="checkbox" defaultChecked={defaults.isDefault} /> Shop default for {defaults.published!.w} × {defaults.published!.h} mm labels</label>
          <div className="small muted" style={{ marginTop: 8 }}>Default for these categories:</div>
          <div className="ls-chips">{cats.map((c) => <button key={c} type="button" className={defCats.includes(c) ? 'on' : ''} onClick={() => setDefCats(defCats.includes(c) ? defCats.filter((x) => x !== c) : [...defCats, c])}>{c}</button>)}</div>
        </div>}
      </Modal>
    </section>
  );
}

/** The designer (BL-08..12): mm canvas with zoom, snap and guides; barcodes locked to whole dots with their quiet zone. */
function Designer({ start, onClose }: { start: { id?: string; name: string; body: LabelTemplateBody }; onClose: () => void }) {
  const toast = useToast();
  const items = useItems().data ?? [];
  const org = useOrg().data;
  const ps = withPrintDefaults(usePrintSettings().data);
  const [name, setName] = useState(start.name);
  const [body, setBody] = useState<LabelTemplateBody>(start.body);
  const [sel, setSel] = useState<string | null>(body.elements[0]?.id ?? null);
  const [zoom, setZoom] = useState(() => Math.max(4, Math.min(14, Math.floor(560 / start.body.w))));
  const [snap, setSnap] = useState(0.5);
  const [sampleId, setSampleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState(start.id);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const canvas = useRef<HTMLDivElement>(null);
  const sample = items.find((i) => i.id === sampleId);
  const data = sample ? labelDataFor(sample, org?.companyName ?? '') : { ...SAMPLE_DATA, company: org?.companyName || SAMPLE_DATA.company };
  const el = body.elements.find((e) => e.id === sel) ?? null;
  const patch = (p: Partial<LabelElement>) => setBody((b) => ({ ...b, elements: b.elements.map((e) => (e.id === sel ? { ...e, ...p } : e)) }));
  const addEl = (e: Omit<LabelElement, 'id'>) => { const x = { ...e, id: id() }; setBody((b) => ({ ...b, elements: [...b.elements, x] })); setSel(x.id); };
  const issues = useMemo(() => validateJob([{ key: 's', itemId: 's', batch: '', qty: 1, data }], body, { w: body.w, h: body.h, across: 1, gutter: 0, marginL: 0, marginR: 0, rowGap: 3, media: 'die-cut', sheet: 'roll', rows: 0, marginTop: 0, safeInset: 1 }, { language: 'tspl', dpi: 203, headMm: 220, media: 'die-cut', offsetX: 0, offsetY: 0, darkness: 8, speed: 4 }).filter((x) => x.scope === 'line' || x.code === 'safe' || x.code === 'overlap'), [body, data]);

  /* Drag to move / resize, with snap and alignment guides to the label centre and edges and other elements. */
  const drag = useRef<{ id: string; mode: 'move' | 'size'; sx: number; sy: number; start: LabelElement } | null>(null);
  const onPick = (eid: string, e: React.PointerEvent, mode: 'move' | 'size' = 'move') => {
    e.preventDefault(); e.stopPropagation(); setSel(eid);
    const start = body.elements.find((x) => x.id === eid)!; drag.current = { id: eid, mode, sx: e.clientX, sy: e.clientY, start };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current; if (!d) return;
      const dx = (e.clientX - d.sx) / zoom, dy = (e.clientY - d.sy) / zoom;
      const s = e.altKey ? 0 : snap;
      setBody((b) => {
        const others = b.elements.filter((x) => x.id !== d.id);
        const xs = [0, b.w / 2, b.w, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
        const ys = [0, b.h / 2, b.h, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
        let { x, y, w, h } = d.start;
        if (d.mode === 'move') { x = snapTo(d.start.x + dx, s); y = snapTo(d.start.y + dy, s); } else { w = Math.max(1, snapTo(d.start.w + dx, s)); h = Math.max(0, snapTo(d.start.h + dy, s)); }
        // guides: snap the element's centre/edges to a guide within 0.6 mm
        const g: { x?: number; y?: number } = {};
        if (d.mode === 'move') {
          for (const gx of xs) for (const [off, k] of [[0, 'l'], [w / 2, 'c'], [w, 'r']] as const) if (Math.abs(x + off - gx) < 0.6) { x = gx - off; g.x = gx; void k; }
          for (const gy of ys) for (const off of [0, h / 2, h]) if (Math.abs(y + off - gy) < 0.6) { y = gy - off; g.y = gy; }
        }
        setGuides(g);
        return { ...b, elements: b.elements.map((x0) => (x0.id === d.id ? { ...x0, x: r1(x), y: r1(y), w: r1(w), h: r1(h) } : x0)) };
      });
    };
    const up = () => { drag.current = null; setGuides({}); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [zoom, snap]);
  // Arrow keys nudge (0.5 mm, Shift 0.1 mm); Delete removes.
  const onKey = (e: React.KeyboardEvent) => {
    if (!el || (e.target as HTMLElement).closest('input,select,textarea')) return;
    const st = e.shiftKey ? 0.1 : 0.5;
    const m: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
    if (m[e.key]) { e.preventDefault(); patch({ x: r1(el.x + m[e.key]![0]), y: r1(el.y + m[e.key]![1]) }); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setBody((b) => ({ ...b, elements: b.elements.filter((x) => x.id !== el.id) })); setSel(null); }
  };
  const save = async (publish: boolean) => {
    setBusy(true);
    try {
      const t = savedId ? await api.put<TemplateRow>(`/shop/label/templates/${savedId}`, { name, draft: body }) : await api.post<TemplateRow>('/shop/label/templates', { name, draft: body });
      setSavedId(t.id);
      if (publish) { const p = await api.post<TemplateRow>(`/shop/label/templates/${t.id}/publish`); toast('success', `Published v${p.version}`, 'Print jobs use this version from now on.'); onClose(); }
      else toast('success', 'Draft saved');
    } catch (e) { toast('error', 'Could not save', (e as Error).message); } finally { setBusy(false); }
  };
  const fit = el && (el.type === 'barcode' || el.type === 'qr') ? (() => { const code = elementCode(el, data); const sym = elementSymbology(el, code); return { sym, f: fitBarcode(code, sym, sym === 'QR' ? Math.min(el.w, el.h) : el.w, 203) }; })() : null;

  return (
    <div className="lb-designer" onKeyDown={onKey} tabIndex={-1}>
      <div className="row between lb-dbar">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Template name" style={{ maxWidth: 280 }} />
        <span className="small muted">{body.w} × {body.h} mm</span>
        <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Back</button>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void save(false)}>Save draft</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save(true)}><Upload size={14} /> Publish</button>
        </span>
      </div>
      <div className="lb-dgrid">
        <aside className="card ls-panel" aria-label="Add elements">
          <h3>Add</h3>
          <div className="lb-palette">
            <button onClick={() => addEl({ type: 'barcode', field: 'barcode', x: 1, y: Math.min(body.h / 3, body.h - 9), w: body.w - 2, h: Math.min(10, body.h / 2.5), symbology: 'auto', showValue: true })}><Barcode size={16} /> Barcode</button>
            <button onClick={() => { const s = Math.min(14, body.h - 2, body.w - 2); addEl({ type: 'qr', field: 'barcode', x: 1, y: 1, w: s, h: s }); }}><QrCode size={16} /> QR code</button>
            <button onClick={() => addEl({ type: 'field', field: 'name', x: 1, y: 1, w: body.w - 2, h: 3.5, size: 2.8, align: 'center', maxLines: 1, overflow: 'shrink', minSize: 1.6 })}><Type size={16} /> Field</button>
            <button onClick={() => addEl({ type: 'text', text: 'Text', x: 1, y: 1, w: body.w / 2, h: 3.2, size: 2.6, align: 'left', maxLines: 1, overflow: 'truncate' })}><Type size={16} /> Text</button>
            <button onClick={() => addEl({ type: 'line', x: 1, y: body.h / 2, w: body.w - 2, h: 0, stroke: 0.3 })}><Minus size={16} /> Line</button>
            <button onClick={() => addEl({ type: 'box', x: 0.5, y: 0.5, w: body.w - 1, h: body.h - 1, stroke: 0.3 })}><Square size={16} /> Box</button>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => { setBody(autoFromSettings(body.w, body.h, ps.barcode)); setSel(null); }}><Wand2 size={14} /> Auto layout</button>
          <div className="field" style={{ marginTop: 12 }}><label htmlFor="dz">Zoom</label><input id="dz" type="range" min={3} max={16} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></div>
          <div className="field"><label htmlFor="ds">Snap</label><select id="ds" className="select" value={snap} onChange={(e) => setSnap(Number(e.target.value))}><option value={0}>Off</option><option value={0.1}>0.1 mm</option><option value={0.5}>0.5 mm</option><option value={1}>1 mm</option></select></div>
          <div className="field"><label htmlFor="dsample">Preview with</label><select id="dsample" className="select" value={sampleId} onChange={(e) => setSampleId(e.target.value)}><option value="">Sample item</option>{items.filter((i) => i.type === 'Goods').slice(0, 200).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
          <p className="small muted">Drag to move, drag the corner to resize. Arrow keys nudge 0.5 mm (Shift: 0.1 mm). Hold Alt to drag without snap.</p>
        </aside>
        <div className="lb-canvas-wrap">
          <div className="lb-ruler small muted">{body.w} mm</div>
          <div ref={canvas} className="lb-canvas" style={{ width: body.w * zoom, height: body.h * zoom }} onPointerDown={() => setSel(null)}>
            <div style={{ zoom: zoom / PX_PER_MM } as React.CSSProperties}><LabelView tpl={body} data={data} design={{ safe: 1, selected: sel, onPick: (i, e) => onPick(i, e) }} /></div>
            {el && <div className="lb-handle" style={{ left: (el.x + el.w) * zoom - 6, top: (el.y + (el.h || 0.3)) * zoom - 6 }} onPointerDown={(e) => onPick(el.id, e, 'size')} aria-label="Resize" role="button" />}
            {guides.x != null && <div className="lb-guide v" style={{ left: guides.x * zoom }} />}
            {guides.y != null && <div className="lb-guide h" style={{ top: guides.y * zoom }} />}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Dashed line: safe area (1 mm). Shaded ends of a barcode: its quiet zone, which must stay blank.</div>
          {issues.length > 0 && <div className="ls-warn" style={{ marginTop: 10 }}>{issues.map((x, i) => <div key={i}><AlertTriangle size={13} /> {x.message.replace(`${data.name}: `, '')}</div>)}</div>}
        </div>
        <aside className="card ls-panel" aria-label="Element properties">
          <h3>{el ? (el.type === 'field' ? 'Field' : el.type[0]!.toUpperCase() + el.type.slice(1)) : 'Label'}</h3>
          {!el ? <p className="small muted">Select an element on the label to change it.</p> : <div className="lb-form">
            <div className="ls-two">
              {(['x', 'y', 'w', 'h'] as const).map((k) => <div key={k} className="field ls-num"><label htmlFor={`p-${k}`}>{({ x: 'Left', y: 'Top', w: 'Width', h: 'Height' })[k]} (mm)</label><input id={`p-${k}`} className="input" type="number" step={0.1} value={el[k]} onChange={(e) => patch({ [k]: r1(Number(e.target.value) || 0) })} /></div>)}
            </div>
            {(el.type === 'field' || el.type === 'barcode' || el.type === 'qr') && <div className="field"><label htmlFor="p-field">{el.type === 'field' ? 'Shows' : 'Encodes'}</label>
              <select id="p-field" className="select" value={el.field ?? 'barcode'} onChange={(e) => patch({ field: e.target.value as LabelField })}>{LABEL_FIELDS.filter((f) => el.type === 'field' || ['barcode', 'sku', 'name', 'batch'].includes(f)).map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}</select></div>}
            {(el.type === 'field' || el.type === 'text') && <>
              <div className="field"><label htmlFor="p-text">{el.type === 'text' ? 'Text' : 'Before the value'}</label><input id="p-text" className="input" value={el.text ?? ''} onChange={(e) => patch({ text: e.target.value })} placeholder={el.type === 'field' ? 'e.g. MRP ' : ''} /></div>
              <div className="ls-two">
                <div className="field"><label htmlFor="p-size">Text height (mm)</label><input id="p-size" className="input" type="number" step={0.1} min={0.8} value={el.size ?? 2.6} onChange={(e) => patch({ size: Math.max(0.8, r1(Number(e.target.value) || 2.6)) })} /></div>
                <div className="field"><label htmlFor="p-lines">Max lines</label><input id="p-lines" className="input" type="number" min={1} max={6} value={el.maxLines ?? 1} onChange={(e) => patch({ maxLines: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })} /></div>
              </div>
              <div className="field"><label>Too long?</label><select className="select" value={el.overflow ?? 'shrink'} onChange={(e) => patch({ overflow: e.target.value as 'shrink' | 'truncate' })}><option value="shrink">Shrink the text (to a minimum)</option><option value="truncate">Cut it short with …</option></select></div>
              {el.overflow !== 'truncate' && <div className="field"><label htmlFor="p-min">Smallest text (mm)</label><input id="p-min" className="input" type="number" step={0.1} min={0.8} value={el.minSize ?? 1.6} onChange={(e) => patch({ minSize: Math.max(0.8, r1(Number(e.target.value) || 1.6)) })} /></div>}
              <div className="ls-chips" role="radiogroup" aria-label="Align">{(['left', 'center', 'right'] as const).map((a) => <button key={a} type="button" role="radio" aria-checked={(el.align ?? 'left') === a} className={(el.align ?? 'left') === a ? 'on' : ''} onClick={() => patch({ align: a })}>{a}</button>)}
                <button type="button" className={el.bold ? 'on' : ''} aria-pressed={!!el.bold} onClick={() => patch({ bold: !el.bold })}><b>B</b></button></div>
            </>}
            {el.type === 'barcode' && <>
              <div className="field"><label>Barcode type</label><select className="select" value={el.symbology ?? 'auto'} onChange={(e) => patch({ symbology: e.target.value as LabelElement['symbology'] })}><option value="auto">Automatic (EAN-13 / UPC-A if valid, else Code 128)</option><option value="CODE128">Code 128</option><option value="EAN13">EAN-13</option><option value="UPC">UPC-A</option></select></div>
              <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={!!el.showValue} onChange={(e) => patch({ showValue: e.target.checked })} /> Print the value under the bars</label>
              <div className="ls-chips" role="radiogroup" aria-label="Align barcode">{(['left', 'center', 'right'] as const).map((a) => <button key={a} type="button" role="radio" aria-checked={(el.align ?? 'center') === a} className={(el.align ?? 'center') === a ? 'on' : ''} onClick={() => patch({ align: a })}>{a}</button>)}</div>
            </>}
            {fit && <p className={`small ${fit.f.ok ? 'muted' : 'ls-err'}`}>{fit.f.ok ? `${fit.sym === 'CODE128' ? 'Code 128' : fit.sym}: narrow bar ${fit.f.moduleDots} dots (${r1(fit.f.moduleMm * 100) / 100} mm) at 203 dpi, ${r1(fit.f.widthMm)} mm wide with quiet zones.` : `Doesn’t fit: ${fit.f.reason}.`}</p>}
            {(el.type === 'line' || el.type === 'box') && <div className="field"><label htmlFor="p-stroke">Thickness (mm)</label><input id="p-stroke" className="input" type="number" step={0.1} min={0.1} value={el.stroke ?? 0.3} onChange={(e) => patch({ stroke: Math.max(0.1, r1(Number(e.target.value) || 0.3)) })} /></div>}
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => patch({ x: r1((body.w - el.w) / 2) })}>Centre across</button>
              <button className="btn btn-ghost btn-sm danger" onClick={() => { setBody((b) => ({ ...b, elements: b.elements.filter((x) => x.id !== el.id) })); setSel(null); }}><Trash2 size={13} /> Remove</button>
            </div>
          </div>}
        </aside>
      </div>
    </div>
  );
}
