import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Minus, Plus, Loader2, Printer, Tag, Upload } from 'lucide-react';
import { api } from '@/api/client';
import { useItems, useMut, useOrg, usePrintSettings } from '@/api/hooks';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { BarcodeLabel, SAMPLE_LABEL_ITEM, SAMPLE_RECEIPT, ThermalReceipt, printReceipt } from '@/components/printing';
import {
  BARCODE_FIELD_LABEL, LABEL_SIZES, MAX_BARCODE_FIELDS, labelSize, withPrintDefaults,
  type BarcodeSettings, type PrintSettings as PS, type ThermalSettings, type ThermalTheme,
} from '../../../shared/printSettings';

const THEMES: Array<{ id: ThermalTheme; label: string; tip: string; isNew?: boolean }> = [
  { id: 'compact', label: 'Compact', tip: 'For businesses with shorter item names and fewer columns; clean and efficient.' },
  { id: 'advanced', label: 'Advanced', tip: 'Item table with HSN, GST rate, MRP and a tax breakup — best for GST-registered shops.', isNew: true },
  { id: 'simple', label: 'Simple', tip: 'Minimal bill with a large total — fast to read at the counter.' },
  { id: 'classic', label: 'Classic', tip: 'Boxed header and ruled totals in a traditional serif style.' },
];

function Mini({ theme }: { theme: ThermalTheme }) {
  return (
    <div className="mini" aria-hidden>
      {theme === 'classic' ? <i className="box" /> : <i className="d s" />}
      <i className="s" />
      <i />
      {theme === 'advanced' ? <><i className="d" /><i /><i /><i className="d" /><i /></> : theme === 'simple' ? <><i /><i /><i className="d s" style={{ height: 6 }} /></> : <><i /><i /><i /><i className="d" /></>}
      <i className="s" />
    </div>
  );
}

const Check = ({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) => (
  <label className="ps-check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>
);

export default function PrintSettings() {
  const me = useShopUser();
  const toast = useToast();
  const org = useOrg().data;
  const items = useItems().data ?? [];
  const q = usePrintSettings();
  const [tab, setTab] = useState<'thermal' | 'barcode'>('thermal');
  const [draft, setDraft] = useState<PS | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ details: true });
  const [hoverTheme, setHoverTheme] = useState<ThermalTheme | null>(null);
  const canEdit = me.can('admin');

  useEffect(() => { if (q.data && !draft) setDraft(withPrintDefaults(q.data)); }, [q.data]);
  const dirty = useMemo(() => !!draft && !!q.data && JSON.stringify(draft) !== JSON.stringify(withPrintDefaults(q.data)), [draft, q.data]);
  const save = useMut((b: PS) => api.put<PS>('/shop/print-settings', b), [['printSettings']], { success: 'Print settings saved' });

  if (!draft || !org) return <div className="page"><div className="skeleton" style={{ height: 480 }} /></div>;
  const th = draft.thermal;
  const bc = draft.barcode;
  const setT = (p: Partial<ThermalSettings>) => setDraft({ ...draft, thermal: { ...th, ...p } });
  const setB = (p: Partial<BarcodeSettings>) => setDraft({ ...draft, barcode: { ...bc, ...p } });
  const enabledCount = bc.fields.filter((f) => f.enabled).length;
  const size = labelSize(bc.labelSize);
  const sizes = LABEL_SIZES.filter((l) => l.printer === bc.printer);
  const sampleItem = items.find((i) => i.barcode && i.mrp) ?? null;
  const previewItem = sampleItem ? { ...sampleItem, category: sampleItem.category, brand: sampleItem.brand } : SAMPLE_LABEL_ITEM;

  const field = (key: string, p: Partial<BarcodeSettings['fields'][number]>) =>
    setB({ fields: bc.fields.map((f) => (f.key === key ? { ...f, ...p } : f)) });

  return (
    <div className="page">
      <div className="page-header">
        <div><h1>Print Settings</h1><p>Choose how thermal receipts and barcode labels look. The preview updates as you change things.</p></div>
        <div className="row" style={{ gap: 8 }}>
          {dirty && <button className="btn btn-secondary" onClick={() => setDraft(withPrintDefaults(q.data))}>Discard</button>}
          <button className="btn btn-primary" disabled={!canEdit || !dirty || save.isPending} onClick={() => save.mutate(draft, { onSuccess: (r) => setDraft(withPrintDefaults(r)) })} title={canEdit ? undefined : 'Only the owner can change print settings'}>
            {save.isPending && <Loader2 size={15} className="spin" />} Save Settings
          </button>
        </div>
      </div>

      <div className="ps-layout">
        <div className="ps-preview">
          {tab === 'thermal' ? (
            <>
              <div className="ps-paper-tag">{th.paper === '2in' ? '2 inch (58 mm) roll' : '3 inch (80 mm) roll'} · {THEMES.find((x) => x.id === th.theme)!.label} theme · sample bill</div>
              <ThermalReceipt data={SAMPLE_RECEIPT} org={org} s={th} />
              <div className="ps-help">Print from <strong>POS</strong> after a sale, or from any invoice with <strong>Print / PDF → Thermal receipt</strong>.</div>
            </>
          ) : (
            <>
              <div className="ps-dim" style={{ marginTop: 30 }}>
                <div className="w"><span>{size.w}mm</span></div>
                {/* Shown enlarged for readability; prints at the real label size. */}
                <div style={{ zoom: Math.min(3, 320 / (size.w * 3.78)) } as React.CSSProperties}>
                  <BarcodeLabel item={previewItem} shop={org.companyName} s={bc} preview />
                </div>
                <div className="h"><span>{size.h}mm</span></div>
              </div>
              <div className="ps-paper-tag" style={{ marginTop: 10 }}>{bc.printer === 'a4' ? `${size.perRow * (size.rowsPerPage ?? 1)} labels per A4 sheet` : `${size.perRow} Label(s) / Row`}</div>
              <div className="ps-help" style={{ marginTop: 40, textAlign: 'center' }}>
                <Tag size={14} style={{ verticalAlign: -2, marginRight: 6 }} />To print, select items on the <Link to="/app/items">Items</Link> page and choose <strong>Print barcode labels</strong>.
              </div>
            </>
          )}
        </div>

        <div>
          <div className="tabs" style={{ marginBottom: 14 }}>
            <button className={tab === 'thermal' ? 'active' : ''} onClick={() => setTab('thermal')}>Thermal Settings</button>
            <button className={tab === 'barcode' ? 'active' : ''} onClick={() => setTab('barcode')}>Barcode Print</button>
          </div>

          {tab === 'thermal' ? (
            <div className="card ps-panel">
              <div className="ps-sec">
                <div className="ps-themes">
                  {THEMES.map((x) => (
                    <div key={x.id} style={{ position: 'relative' }}>
                      <button className={`ps-theme ${th.theme === x.id ? 'active' : ''}`} style={{ width: '100%' }} onClick={() => setT({ theme: x.id })} onMouseEnter={() => setHoverTheme(x.id)} onMouseLeave={() => setHoverTheme(null)} aria-pressed={th.theme === x.id}>
                        {x.isNew && <span className="tag">NEW</span>}
                        <Mini theme={x.id} />
                        {x.label}
                      </button>
                      {hoverTheme === x.id && <div className="ps-tip" role="tooltip">{x.tip}</div>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="ps-sec">
                <h3>Print Settings</h3>
                <div className="small muted" style={{ marginBottom: 6 }}>Select Paper Size</div>
                <div className="ps-radios">
                  {(['2in', '3in'] as const).map((p) => (
                    <label key={p} className={`ps-radio ${th.paper === p ? 'active' : ''}`}>{p === '2in' ? '2 inch' : '3 inch'}<input type="radio" name="paper" checked={th.paper === p} onChange={() => setT({ paper: p })} /></label>
                  ))}
                </div>
              </div>
              <div className="ps-sec">
                <button className={`ps-acc ${open.logo ? 'open' : ''}`} onClick={() => setOpen({ ...open, logo: !open.logo })}>Upload Logo <ChevronDown size={18} /></button>
                {open.logo && (
                  <div style={{ marginTop: 12 }}>
                    <Check checked={th.showLogo} onChange={(v) => setT({ showLogo: v })}>Show business logo on receipts</Check>
                    <div className="row" style={{ gap: 12, marginTop: 6 }}>
                      {org.logo ? <img src={org.logo} alt="Logo" style={{ width: 56, height: 56, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8 }} /> : <span className="small muted">No logo yet.</span>}
                      <Link to="/app/organization" className="btn btn-secondary btn-sm"><Upload size={14} /> {org.logo ? 'Change logo' : 'Upload logo'}</Link>
                    </div>
                    <p className="small muted" style={{ marginTop: 8 }}>Logos print in black & white on thermal paper.</p>
                  </div>
                )}
              </div>
              <div className="ps-sec">
                <h3>Theme Settings</h3>
                <Check checked={th.showPartyBalance} onChange={(v) => setT({ showPartyBalance: v })}>Show party balance in invoice</Check>
                <Check checked={th.showItemDescription} onChange={(v) => setT({ showItemDescription: v })}>Show item description in invoice</Check>
                <Check checked={th.showTime} onChange={(v) => setT({ showTime: v })}>Show time on invoices</Check>
                <Check checked={th.showSavings} onChange={(v) => setT({ showSavings: v })}>Show “You saved” (MRP − selling price)</Check>
              </div>
              <div className="ps-sec">
                <button className={`ps-acc ${open.details ? 'open' : ''}`} onClick={() => setOpen({ ...open, details: !open.details })}>Invoice Details <ChevronDown size={18} /></button>
                {open.details && (
                  <div style={{ marginTop: 10 }}>
                    <Check checked={th.showGstin} onChange={(v) => setT({ showGstin: v })}>Show GSTIN (yours and the customer’s)</Check>
                    <Check checked={th.showHsn} onChange={(v) => setT({ showHsn: v })}>Show HSN / SAC code per item</Check>
                    <Check checked={th.showTaxBreakup} onChange={(v) => setT({ showTaxBreakup: v })}>Show GST breakup by rate</Check>
                    <Check checked={th.showUpiQr} onChange={(v) => setT({ showUpiQr: v })}>Show UPI QR when a balance is due{!org.upiId && <span className="small muted"> · add a UPI ID in Business profile</span>}</Check>
                    <div className="field" style={{ marginTop: 10 }}>
                      <label>Receipt footer</label>
                      <input className="input" maxLength={200} value={th.footer} onChange={(e) => setT({ footer: e.target.value })} placeholder={org.invoiceFooter || 'Thank you, visit again!'} />
                      <span className="field-hint">Leave empty to use the footer from your Business profile.</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="ps-sec">
                <button className="btn btn-secondary btn-block" onClick={() => printReceipt(th)}><Printer size={15} /> Print a test receipt</button>
              </div>
            </div>
          ) : (
            <div className="card ps-panel">
              <div className="ps-sec">
                <h3>Print Settings</h3>
                <div className="small muted" style={{ marginBottom: 6 }}>Select Printer Type</div>
                <div className="ps-radios">
                  {(['a4', 'label'] as const).map((p) => (
                    <label key={p} className={`ps-radio ${bc.printer === p ? 'active' : ''}`}>{p === 'a4' ? 'A4' : 'Label'}
                      <input type="radio" name="printer" checked={bc.printer === p} onChange={() => setB({ printer: p, labelSize: LABEL_SIZES.find((l) => l.printer === p)!.id })} />
                    </label>
                  ))}
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>Label Sizes</label>
                  <select className="select" value={bc.labelSize} onChange={(e) => setB({ labelSize: e.target.value })}>
                    {sizes.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </div>
                <div className="field" style={{ marginTop: 12 }}>
                  <label>Barcode height · {bc.barcodeHeight}% of the label</label>
                  <input type="range" min={20} max={70} value={bc.barcodeHeight} onChange={(e) => setB({ barcodeHeight: Number(e.target.value) })} style={{ accentColor: '#1c1917' }} />
                </div>
              </div>
              <div className="ps-sec">
                <h3 style={{ marginBottom: 4 }}>Show or hide details</h3>
                <div className="strong" style={{ fontSize: 14, marginTop: 10 }}>Fixed Columns</div>
                <p className="small muted" style={{ margin: '2px 0 10px' }}>Select up to {MAX_BARCODE_FIELDS} columns to display on the barcode. {enabledCount}/{MAX_BARCODE_FIELDS} selected.</p>
                <div className="ps-fields">
                  {bc.fields.map((f) => {
                    const blocked = !f.enabled && enabledCount >= MAX_BARCODE_FIELDS;
                    return (
                      <div key={f.key} className={`ps-field ${f.enabled ? '' : 'off'}`}>
                        <label title={blocked ? `Up to ${MAX_BARCODE_FIELDS} columns` : undefined}>
                          <input type="checkbox" checked={f.enabled} disabled={blocked} onChange={(e) => { if (e.target.checked && enabledCount >= MAX_BARCODE_FIELDS) return toast('info', `Select up to ${MAX_BARCODE_FIELDS} columns`); field(f.key, { enabled: e.target.checked }); }} />
                          {BARCODE_FIELD_LABEL[f.key]}
                        </label>
                        <div className="ps-step" aria-label={`${BARCODE_FIELD_LABEL[f.key]} font size`}>
                          <button onClick={() => field(f.key, { size: Math.max(8, f.size - 1) })} disabled={f.size <= 8} aria-label="Smaller"><Minus size={13} /></button>
                          <span>{f.size}</span>
                          <button onClick={() => field(f.key, { size: Math.min(40, f.size + 1) })} disabled={f.size >= 40} aria-label="Larger"><Plus size={13} /></button>
                        </div>
                        <button className={`ps-bold ${f.bold ? 'on' : ''}`} onClick={() => field(f.key, { bold: !f.bold })} aria-pressed={f.bold} title="Bold">B</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
