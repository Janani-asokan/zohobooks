import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Plus, ShieldCheck, UserPlus, Users, XCircle } from 'lucide-react';
import { ApiError, api, fieldErrors } from '@/api/client';
import { useMut } from '@/api/hooks';
import { BORROWER_TONE, LENDING_KEYS, RISK_TONE, type Borrower, useBorrowers, useLendingSettings } from '@/api/lending';
import { useShopUser } from '@/context/AuthContext';
import { Badge, EmptyState, Field, Modal, PageHeader, SearchInput } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { fmtDate, money } from '@/lib/format';

const STATUS_FILTERS = ['All', 'Pending Verification', 'Verified', 'Manual Verification Approved', 'Verification Failed'] as const;
const emptyForm = (area = '') => ({ name: '', fatherName: '', mobile: '', address: '', areaCode: area, guarantor: '', aadhaar: '', aadhaarConsent: false });

/** Borrower register: everyone the business lends to, with verification status and a risk score. */
export default function Borrowers() {
  const me = useShopUser();
  const canWrite = me.can('lending.write');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data = [], isLoading } = useBorrowers();
  const settings = useLendingSettings().data;
  const areas = (settings?.areas ?? []).filter((a) => a.active);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('All');
  const [area, setArea] = useState('');
  const [form, setForm] = useState<ReturnType<typeof emptyForm> | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [dupe, setDupe] = useState<{ id: string; name: string; code: string } | null>(null);
  const [verify, setVerify] = useState<{ b: Borrower; status: string; note: string } | null>(null);

  useEffect(() => { if (canWrite && params.get('new') && settings) { setForm(emptyForm(areas[0]?.code)); setParams({}, { replace: true }); } }, [params, settings]);
  const create = useMut((b: Record<string, unknown>) => api.post<Borrower>('/shop/lending/borrowers', b), LENDING_KEYS, { success: (b) => `${b.name} registered as ${b.code}`, silentError: true });
  const setStat = useMut((v: { id: string; status: string; note: string }) => api.post(`/shop/lending/borrowers/${v.id}/status`, v), LENDING_KEYS, { success: (_r, v) => `Marked ${v.status.toLowerCase()}` });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((b) => (status === 'All' || b.status === status) && (!area || b.areaCode === area))
      .filter((b) => !s || [b.code, b.name, b.fatherName, b.mobile, b.areaName, b.guarantor].join(' ').toLowerCase().includes(s));
  }, [data, q, status, area]);

  const submit = () => {
    if (!form) return;
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = 'Enter the name';
    if (!/^[6-9]\d{9}$/.test(form.mobile.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))) e.mobile = '10-digit mobile number';
    if (form.address.trim().length < 5) e.address = 'Enter the address';
    if (!form.areaCode) e.areaCode = 'Choose an area';
    if (form.aadhaar && form.aadhaar.replace(/\D/g, '').length !== 12) e.aadhaar = 'Aadhaar has 12 digits';
    if (form.aadhaar && !form.aadhaarConsent) e.aadhaarConsent = 'Tick to record the borrower’s consent';
    setErr(e); setDupe(null);
    if (Object.keys(e).length) return;
    create.mutate(form, {
      onSuccess: (b) => { setForm(null); navigate(`/app/microfinance/borrowers/${b.id}`); },
      onError: (x) => {
        if (x instanceof ApiError && x.status === 409 && (x.details as any)?.borrower) { const b = (x.details as any).borrower; setDupe({ id: b.id, name: b.name, code: b.code }); return; }
        setErr({ ...fieldErrors(x), form: x.message });
      },
    });
  };

  return (
    <div className="page">
      <PageHeader title="Borrowers" crumbs={<><Link to="/app/microfinance">Microfinance</Link> <span>/</span> Borrowers</>} icon={Users}
        subtitle="Register and verify borrowers. Aadhaar is stored encrypted and shown only as the last four digits."
        actions={<><ExportMenu disabled={!rows.length} table={() => ({
          title: 'Borrowers', subtitle: `${rows.length} borrowers`, filename: 'borrowers',
          columns: [{ label: 'Code' }, { label: 'Name' }, { label: 'Father' }, { label: 'Mobile' }, { label: 'Area' }, { label: 'Status' }, { label: 'Risk' }, { label: 'Loans' }, { label: 'Outstanding', money: true }],
          rows: rows.map((b) => ({ cells: [b.code, b.name, b.fatherName, b.mobile, b.areaName, b.status, `${b.riskScore} ${b.riskBand}`, b.loanCount, b.outstanding] })),
        })} />{canWrite && <button className="btn btn-primary" onClick={() => { setErr({}); setDupe(null); setForm(emptyForm(areas[0]?.code)); }}><UserPlus size={16} /> New borrower</button>}</>} />

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-left">
            <SearchInput value={q} onChange={setQ} placeholder="Search name, code, mobile, father, guarantor…" />
            <select id="b-area" className="select" style={{ width: 160 }} value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area"><option value="">All areas</option>{areas.map((a) => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}</select>
          </div>
          <div className="filter-chips" style={{ padding: 0 }}>
            {STATUS_FILTERS.map((s) => <button key={s} className={`filter-chip ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>{s === 'Manual Verification Approved' ? 'Manually approved' : s === 'Pending Verification' ? 'Pending' : s === 'Verification Failed' ? 'Failed' : s} <span className="n">{s === 'All' ? data.length : data.filter((b) => b.status === s).length}</span></button>)}
          </div>
        </div>
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 220 }} /></div> : !rows.length ? (
            <EmptyState icon={Users} title={data.length ? 'No borrowers match' : 'No borrowers yet'} text="Register a borrower to give them a loan." action={canWrite && <button className="btn btn-primary" onClick={() => setForm(emptyForm(areas[0]?.code))}><Plus size={15} /> New borrower</button>} />
          ) : (
            <table className="table">
              <thead><tr><th>Borrower</th><th>Area</th><th>Status</th><th>Risk</th><th className="num">Loans</th><th className="num">Outstanding</th><th /></tr></thead>
              <tbody>{rows.map((b) => (
                <tr key={b.id} className="clickable" onClick={() => navigate(`/app/microfinance/borrowers/${b.id}`)}>
                  <td><span className="strong">{b.name}</span> <span className="muted small">{b.code}</span><div className="muted small">{b.mobile}{b.fatherName ? ` · S/o, D/o ${b.fatherName}` : ''} · Aadhaar {b.aadhaarMasked}</div></td>
                  <td>{b.areaName}</td>
                  <td><Badge tone={BORROWER_TONE[b.status]}>{b.status === 'Manual Verification Approved' ? 'Manually approved' : b.status}</Badge></td>
                  <td><Badge tone={RISK_TONE(b.riskScore)}>{b.riskScore} · {b.riskBand}</Badge></td>
                  <td className="num">{b.activeLoans}<span className="muted small"> / {b.loanCount}</span></td>
                  <td className="num strong">{b.outstanding ? money(b.outstanding) : '—'}</td>
                  <td className="num" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                    {canWrite && b.status === 'Pending Verification' && <>
                      <button className="btn btn-primary btn-sm" disabled={setStat.isPending} onClick={() => setStat.mutate({ id: b.id, status: 'Verified', note: 'Documents checked' })}><BadgeCheck size={14} /> Approve</button>
                      <button className="icon-btn danger" title="Mark verification failed" onClick={() => setVerify({ b, status: 'Verification Failed', note: '' })}><XCircle size={15} /></button>
                    </>}
                    {canWrite && (b.status === 'Verified' || b.status === 'Manual Verification Approved') && <Link className="btn btn-secondary btn-sm" to={`/app/microfinance/loans/new?borrower=${b.id}`}>Give loan</Link>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title="New borrower" subtitle="Approve them after you have checked their documents; only approved borrowers can get a loan." size="lg"
        footer={<><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={create.isPending}><UserPlus size={15} /> Register</button></>}>
        {form && (
          <div className="form-grid">
            {dupe && <div className="span-all lend-dupe">Already registered: <strong>{dupe.name}</strong> ({dupe.code}). <Link to={`/app/microfinance/borrowers/${dupe.id}`} onClick={() => setForm(null)}>Open their record</Link></div>}
            {err.form && <div className="span-all error-state">{err.form}</div>}
            <Field label="Name" required error={err.name}><input id="nb-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
            <Field label="Father’s / husband’s name"><input id="nb-father" className="input" value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} /></Field>
            <Field label="Mobile" required error={err.mobile}><input id="nb-mobile" className="input" inputMode="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="98765 43210" /></Field>
            <Field label="Area" required error={err.areaCode}><select id="nb-area" className="select" value={form.areaCode} onChange={(e) => setForm({ ...form, areaCode: e.target.value })}><option value="">Choose…</option>{areas.map((a) => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}</select></Field>
            <Field label="Address" required error={err.address} className="span-all"><textarea id="nb-addr" className="textarea" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="Guarantor" hint="Name and relation; a guarantor improves the risk score"><input id="nb-guar" className="input" value={form.guarantor} onChange={(e) => setForm({ ...form, guarantor: e.target.value })} /></Field>
            <Field label="Aadhaar (optional)" error={err.aadhaar} hint={settings?.aadhaarAvailable ? 'Stored encrypted; only the last 4 digits are shown' : 'Not set up on this server yet'}>
              <input id="nb-aadhaar" className="input" inputMode="numeric" disabled={!settings?.aadhaarAvailable} value={form.aadhaar} onChange={(e) => setForm({ ...form, aadhaar: e.target.value.replace(/[^\d ]/g, '').slice(0, 14) })} placeholder="1234 5678 9012" />
            </Field>
            {!!form.aadhaar && (
              <label className="span-all check-line" htmlFor="nb-consent">
                <input id="nb-consent" type="checkbox" checked={form.aadhaarConsent} onChange={(e) => setForm({ ...form, aadhaarConsent: e.target.checked })} />
                <span><ShieldCheck size={13} /> The borrower agreed to share their Aadhaar for identity verification on this loan.{err.aadhaarConsent && <span className="field-error"> {err.aadhaarConsent}</span>}</span>
              </label>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!verify} onClose={() => setVerify(null)} title="Verification failed" subtitle={verify?.b.name}
        footer={<><button className="btn btn-secondary" onClick={() => setVerify(null)}>Cancel</button><button className="btn btn-danger" onClick={() => verify && setStat.mutate({ id: verify.b.id, status: verify.status, note: verify.note }, { onSuccess: () => setVerify(null) })}>Mark failed</button></>}>
        <Field label="What was wrong?"><textarea id="vf-note" className="textarea" rows={3} value={verify?.note ?? ''} onChange={(e) => verify && setVerify({ ...verify, note: e.target.value })} placeholder="For example: address did not match the ration card" /></Field>
      </Modal>
    </div>
  );
}

export const borrowerSince = (b: Borrower) => fmtDate(String(b.createdAt).slice(0, 10));
