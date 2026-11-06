import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Pencil, Wand2, X } from 'lucide-react';
import { api } from '@/api/client';
import { useShopUser } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { SearchInput, Segmented } from '@/components/ui';
import { DEFAULT_GENERATOR, isGs1Prefix, type GeneratorSettings } from '../../../../shared/barcode';
import { detectSymbology } from '../../../../shared/labelEngine';
import { LABEL_KEYS, useLabelSetup } from '@/components/labels/labelsApi';

interface Row { id: string; name: string; sku: string; barcode: string; category: string; type: string; aliases: string[]; duplicate: boolean }
interface Coverage { total: number; withBarcode: number; missing: number; duplicates: number; items: Row[] }
const SYM_LABEL = { EAN13: 'EAN-13', EAN8: 'EAN-8', UPC: 'UPC-A', CODE128: 'Code 128', QR: 'QR' } as const;

/** Barcodes (spec 2.1, 2.2): coverage across the catalogue, missing and duplicates, bulk generation, replace, import. */
export default function BarcodesTab() {
  const me = useShopUser();
  const toast = useToast();
  const qc = useQueryClient();
  const setup = useLabelSetup();
  const cov = useQuery({ queryKey: LABEL_KEYS.barcodes, queryFn: () => api.get<Coverage>('/shop/label/barcodes') });
  const [f, setF] = useState<'all' | 'missing' | 'duplicate' | 'alias'>('missing');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null);
  const canManage = me.can('items.write');
  const refresh = () => { qc.invalidateQueries({ queryKey: LABEL_KEYS.barcodes }); qc.invalidateQueries({ queryKey: ['items'] }); };
  const rows = useMemo(() => (cov.data?.items ?? []).filter((r) => r.type === 'Goods')
    .filter((r) => (f === 'missing' ? !r.barcode : f === 'duplicate' ? r.duplicate : f === 'alias' ? r.aliases.length > 0 : true))
    .filter((r) => !q || `${r.name} ${r.sku} ${r.barcode}`.toLowerCase().includes(q.toLowerCase())), [cov.data, f, q]);
  const generate = async (ids?: string[]) => {
    setBusy(true);
    try {
      const r = await api.post<{ generated: number; conflicts: Array<{ error: string }> }>('/shop/label/barcodes/bulk-generate', ids ? { ids } : {});
      toast(r.conflicts.length ? 'info' : 'success', `${r.generated} barcode${r.generated === 1 ? '' : 's'} made`, r.conflicts[0]?.error);
      refresh();
    } catch (e) { toast('error', 'Could not make barcodes', (e as Error).message); } finally { setBusy(false); }
  };
  const replace = async () => {
    if (!edit) return;
    try { await api.post(`/shop/label/barcodes/${edit.id}/replace`, { value: edit.value.trim() }); toast('success', 'Barcode replaced', 'The old one still scans, so labels on the shelf keep working.'); setEdit(null); refresh(); }
    catch (e) { toast('error', 'Could not replace it', (e as Error).message); }
  };
  const dropAlias = async (id: string, v: string) => { await api.del(`/shop/label/barcodes/${id}/aliases/${encodeURIComponent(v)}`).catch(() => undefined); refresh(); };
  const [csv, setCsv] = useState('');
  const importCsv = async () => {
    const rowsIn = csv.split(/\r?\n/).map((l) => l.split(',').map((x) => x.trim())).filter((r) => r[0] && r[1] && !/^sku$/i.test(r[0]));
    const items = cov.data?.items ?? []; let ok = 0; const bad: string[] = [];
    for (const [sku, code] of rowsIn) {
      const it = items.find((i) => i.sku.toLowerCase() === sku!.toLowerCase());
      if (!it) { bad.push(`${sku}: no such SKU`); continue; }
      try { await api.post(`/shop/label/barcodes/${it.id}/replace`, { value: code }); ok++; } catch (e) { bad.push(`${sku}: ${(e as Error).message}`); }
    }
    toast(bad.length ? 'info' : 'success', `${ok} barcode${ok === 1 ? '' : 's'} imported`, bad.slice(0, 3).join(' · '));
    setCsv(''); refresh();
  };

  return (
    <div className="lb-two">
      <section className="card ls-panel" aria-label="Barcode coverage">
        <h3>Barcodes across your items</h3>
        {cov.data ? (
          <div className="lb-stats">
            <div><strong>{cov.data.withBarcode}</strong><span>of {cov.data.total} goods have a barcode</span></div>
            <div className={cov.data.missing ? 'warn' : ''}><strong>{cov.data.missing}</strong><span>missing</span></div>
            <div className={cov.data.duplicates ? 'bad' : ''}><strong>{cov.data.duplicates}</strong><span>could scan as another item</span></div>
          </div>
        ) : <Loader2 className="spin" size={18} />}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
          <Segmented value={f} onChange={setF} options={[{ value: 'missing', label: 'Missing' }, { value: 'duplicate', label: 'Duplicates' }, { value: 'alias', label: 'With old barcodes' }, { value: 'all', label: 'All' }]} />
          <SearchInput value={q} onChange={setQ} placeholder="Find items" />
          {canManage && (cov.data?.missing ?? 0) > 0 && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void generate()}><Wand2 size={14} /> Make barcodes for all {cov.data!.missing} missing</button>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Item</th><th>Barcode</th><th>Prints as</th><th>Old barcodes (still scan)</th><th /></tr></thead>
            <tbody>
              {rows.slice(0, 300).map((r) => (
                <tr key={r.id} className={r.duplicate ? 'lb-dup' : ''}>
                  <td><div className="strong">{r.name}</div><div className="small muted mono">{r.sku}</div></td>
                  <td>{edit?.id === r.id ? (
                    <span className="row" style={{ gap: 4 }}>
                      <input className="input mono" autoFocus value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} aria-label={`New barcode for ${r.name}`} onKeyDown={(e) => { if (e.key === 'Enter') void replace(); if (e.key === 'Escape') setEdit(null); }} />
                      <button className="icon-btn sm" aria-label="Save" onClick={() => void replace()}><Check size={14} /></button>
                      <button className="icon-btn sm" aria-label="Cancel" onClick={() => setEdit(null)}><X size={14} /></button>
                    </span>
                  ) : r.barcode ? <span className="mono">{r.barcode}</span> : <span className="muted small">none</span>}
                    {r.duplicate && <div className="small ls-err"><AlertTriangle size={12} /> another item scans the same</div>}</td>
                  <td className="small">{r.barcode ? SYM_LABEL[detectSymbology(r.barcode)] : ''}</td>
                  <td>{r.aliases.map((a) => <span key={a} className="lb-alias mono">{a}{canManage && <button aria-label={`Stop ${a} scanning`} onClick={() => void dropAlias(r.id, a)}><X size={11} /></button>}</span>)}</td>
                  <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    {canManage && !r.barcode && <button className="btn btn-soft btn-sm" disabled={busy} onClick={() => void generate([r.id])}>Make one</button>}
                    {canManage && r.barcode && edit?.id !== r.id && <button className="icon-btn sm" aria-label={`Replace barcode of ${r.name}`} title="Replace (the old one keeps scanning)" onClick={() => setEdit({ id: r.id, value: '' })}><Pencil size={13} /></button>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="muted">{f === 'missing' ? 'Every item has a barcode.' : 'Nothing here.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <aside className="card ls-panel" aria-label="Generator">
        <Generator gen={setup.data?.generator ?? DEFAULT_GENERATOR} admin={me.can('admin')} onSaved={() => qc.invalidateQueries({ queryKey: LABEL_KEYS.setup })} />
        {canManage && (
          <div style={{ marginTop: 18 }}>
            <h3>Import barcodes</h3>
            <p className="small muted">One line per item: <span className="mono">sku,barcode</span>. A replaced barcode keeps scanning.</p>
            <textarea className="input mono" rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'LOG-M331,5099206066861'} aria-label="Barcodes CSV" />
            <button className="btn btn-soft btn-sm" style={{ marginTop: 6 }} disabled={!csv.trim()} onClick={() => void importCsv()}>Import</button>
          </div>
        )}
      </aside>
    </div>
  );
}

/** How new barcodes are made (BL-03, BL-04). Admin only. */
function Generator({ gen, admin, onSaved }: { gen: GeneratorSettings; admin: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [g, setG] = useState<GeneratorSettings>(gen);
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api.put('/shop/label/generator', g); toast('success', 'Barcode generator saved'); onSaved(); } catch (e) { toast('error', 'Could not save', (e as Error).message); } finally { setBusy(false); } };
  const example = g.mode === 'series' ? `${g.prefix}${String(g.next).padStart(g.digits, '0')}` : g.mode === 'sku' ? 'the item’s SKU (e.g. LOG-M331)' : g.mode === 'gs1' ? (isGs1Prefix(g.gs1Prefix) ? `${g.gs1Prefix}${String(g.next).padStart(12 - g.gs1Prefix.length, '0')}…` : 'enter your GS1 prefix') : '2xxxxxxxxxxxx (EAN-13)';
  return (
    <div>
      <h3>How new barcodes are made</h3>
      <fieldset disabled={!admin} style={{ border: 0, padding: 0, margin: 0 }}>
        {([['shop-ean', 'Shop barcode (EAN-13 starting with 2)', 'For loose and unbranded goods. The 2 range is kept for in-store use, so it never clashes with a maker’s barcode.'],
          ['sku', 'The item’s SKU, as Code 128', 'Short SKUs print small; long ones need wider labels.'],
          ['series', 'A number series, as Code 128', 'Prefix and a running number.'],
          ['gs1', 'EAN-13 under your GS1 company prefix', 'Only if your business holds a prefix from GS1 India; needed to sell through supermarkets.']] as const).map(([v, l, h]) => (
          <label key={v} className={`lb-genopt ${g.mode === v ? 'active' : ''}`}><input type="radio" name="gen" checked={g.mode === v} onChange={() => setG({ ...g, mode: v })} /><span><strong>{l}</strong><span className="small muted">{h}</span></span></label>
        ))}
        {g.mode === 'series' && <div className="ls-two" style={{ marginTop: 8 }}>
          <div className="field"><label htmlFor="gen-prefix">Prefix</label><input id="gen-prefix" className="input mono" value={g.prefix} onChange={(e) => setG({ ...g, prefix: e.target.value.replace(/[^\x21-\x7e]/g, '').slice(0, 10) })} /></div>
          <div className="field"><label htmlFor="gen-digits">Digits</label><input id="gen-digits" className="input" type="number" min={3} max={10} value={g.digits} onChange={(e) => setG({ ...g, digits: Math.max(3, Math.min(10, Number(e.target.value) || 6)) })} /></div>
        </div>}
        {g.mode === 'gs1' && <div className="field" style={{ marginTop: 8 }}><label htmlFor="gen-gs1">GS1 company prefix</label><input id="gen-gs1" className="input mono" inputMode="numeric" value={g.gs1Prefix} onChange={(e) => setG({ ...g, gs1Prefix: e.target.value.replace(/\D/g, '').slice(0, 11) })} placeholder="e.g. 8904123" /></div>}
        {(g.mode === 'series' || g.mode === 'gs1') && <div className="field"><label htmlFor="gen-next">Next number</label><input id="gen-next" className="input" type="number" min={0} value={g.next} onChange={(e) => setG({ ...g, next: Math.max(0, Number(e.target.value) || 0) })} /></div>}
      </fieldset>
      <p className="small muted" style={{ margin: '8px 0' }}>Next one: <span className="mono">{example}</span></p>
      {admin ? <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void save()}>Save generator</button> : <p className="small muted">Only the owner can change this.</p>}
    </div>
  );
}
