import { useMemo, useState } from 'react';
import { Plus, Landmark, Wallet, CreditCard, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { api } from '@/api/client';
import { useBankAccounts, useBankTxns, useMut } from '@/api/hooks';
import type { BankAccount } from '@/api/types';
import { useShopUser } from '@/context/AuthContext';
import { EmptyState, Field, Modal, PageHeader, Segmented } from '@/components/ui';
import { fmtDate, money, todayISO } from '@/lib/format';
import { Hint } from '@/components/kit';

const ICON = { Bank: Landmark, Cash: Wallet, Card: CreditCard };
const CATEGORIES = ['Customer Receipt', 'Sales', 'Vendor Payment', 'Rent', 'Salaries', 'Utilities', 'Office Expense', 'Other'];

export default function Banking() {
  const me = useShopUser();
  const canWrite = me.can('banking.write');
  const accounts = useBankAccounts().data ?? [];
  const allTxns = useBankTxns().data ?? [];
  const keys = [['bankAccounts'], ['bankTxns']];
  const addTxn = useMut((b: Record<string, unknown>) => api.post('/shop/bank-transactions', b), keys, { success: 'Transaction recorded' });
  const addAcc = useMut((b: Record<string, unknown>) => api.post('/shop/bank-accounts', b), keys, { success: 'Account added' });
  const [selected, setSelected] = useState<string>('all');
  const [txOpen, setTxOpen] = useState(false);
  const [accOpen, setAccOpen] = useState(false);
  const [tx, setTx] = useState({ accountId: '', date: todayISO(), description: '', amount: '', dir: 'in' as 'in' | 'out', category: 'Sales' });
  const [acc, setAcc] = useState<Omit<BankAccount, 'id' | 'openingBalance' | 'balance'> & { openingBalance: string }>({ name: '', bank: '', accountNo: '', type: 'Bank', openingBalance: '' });
  const [touched, setTouched] = useState(false);

  const balance = (id: string) => accounts.find((x) => x.id === id)?.balance ?? 0;
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const txns = useMemo(() => allTxns.filter((t) => selected === 'all' || t.accountId === selected), [allTxns, selected]);

  const txErr = { accountId: !tx.accountId ? 'Select account' : '', description: !tx.description.trim() ? 'Required' : '', amount: !(Number(tx.amount) > 0) ? 'Enter amount' : '' };

  return (
    <div className="page">
      <PageHeader
        title="Banking"
        subtitle="Bank, cash and card accounts with every deposit and withdrawal."
        actions={canWrite && (
          <>
            <button className="btn btn-secondary" onClick={() => { setAcc({ name: '', bank: '', accountNo: '', type: 'Bank', openingBalance: '' }); setTouched(false); setAccOpen(true); }}><Plus size={16} /> Add Account</button>
            <button className="btn btn-primary" onClick={() => { setTx({ accountId: selected !== 'all' ? selected : accounts[0]?.id ?? '', date: todayISO(), description: '', amount: '', dir: 'in', category: 'Sales' }); setTouched(false); setTxOpen(true); }}><Plus size={16} /> Record Transaction</button>
          </>
        )}
      />
      <Hint id="banking" title="All your money in one place">
        <p>Add each bank account, cash box or card. Customer payments, bill payments and expenses post here automatically; add anything else (like owner drawings) as a manual entry.</p>
      </Hint>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
        <button className="card" onClick={() => setSelected('all')} style={{ textAlign: 'left', padding: 18, cursor: 'pointer', background: selected === 'all' ? 'var(--ink-900)' : 'var(--surface)', color: selected === 'all' ? '#fff' : 'var(--ink-800)', border: selected === 'all' ? 'none' : undefined, fontFamily: 'inherit' }}>
          <div className="small" style={{ opacity: 0.8, fontWeight: 600 }}>Total cash &amp; bank balance</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{money(total)}</div>
          <div className="small" style={{ opacity: 0.75, marginTop: 4 }}>{accounts.length} accounts</div>
        </button>
        {accounts.map((a) => {
          const I = ICON[a.type];
          const active = selected === a.id;
          return (
            <button key={a.id} className="card" onClick={() => setSelected(a.id)} style={{ textAlign: 'left', padding: 18, cursor: 'pointer', borderColor: active ? 'var(--brand-500)' : undefined, boxShadow: active ? '0 0 0 3px rgba(61,107,245,.15)' : undefined, fontFamily: 'inherit', color: 'var(--ink-800)' }}>
              <div className="row between">
                <span className="stat-icon tone-blue" style={{ width: 34, height: 34 }}><I size={17} /></span>
                <span className="chip">{a.type}</span>
              </div>
              <div style={{ fontWeight: 700, color: 'var(--ink-900)', marginTop: 10 }}>{a.name}</div>
              <div className="small muted">{a.bank} · {a.accountNo}</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink-900)', marginTop: 8 }}>{money(balance(a.id))}</div>
            </button>
          );
        })}
      </div>

      <div className="card mt-16">
        <div className="card-header">
          <div>
            <h3>Transactions</h3>
            <p>{selected === 'all' ? 'All accounts' : accounts.find((a) => a.id === selected)?.name}</p>
          </div>
        </div>
        <div className="table-wrap">
          {txns.length === 0 ? <EmptyState icon={Landmark} title="No transactions" text="Record deposits and withdrawals to keep balances accurate." /> : (
            <table className="table">
              <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th className="num">Deposit</th><th className="num">Withdrawal</th></tr></thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id}>
                    <td>{fmtDate(t.date)}</td>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <span className={`stat-icon ${t.amount >= 0 ? 'tone-green' : 'tone-red'}`} style={{ width: 28, height: 28, borderRadius: 8 }}>{t.amount >= 0 ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span>
                        <span className="strong">{t.description}</span>{t.refType === 'payment' && <span className="chip">Auto</span>}
                      </div>
                    </td>
                    <td className="muted">{accounts.find((a) => a.id === t.accountId)?.name}</td>
                    <td><span className="chip">{t.category}</span></td>
                    <td className="num" style={{ color: 'var(--green-700)', fontWeight: 600 }}>{t.amount >= 0 ? money(t.amount) : ''}</td>
                    <td className="num" style={{ color: 'var(--red-600)', fontWeight: 600 }}>{t.amount < 0 ? money(-t.amount) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal
        open={txOpen}
        onClose={() => setTxOpen(false)}
        title="Record transaction"
        footer={<><button className="btn btn-secondary" onClick={() => setTxOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={() => {
          setTouched(true);
          if (Object.values(txErr).some(Boolean)) return;
          addTxn.mutate({ accountId: tx.accountId, date: tx.date, description: tx.description.trim(), amount: (tx.dir === 'in' ? 1 : -1) * Number(tx.amount), category: tx.category }, { onSuccess: () => setTxOpen(false) });
        }}>Save</button></>}
      >
        <div style={{ marginBottom: 16 }}>
          <Segmented value={tx.dir} onChange={(v) => setTx({ ...tx, dir: v })} options={[{ value: 'in', label: 'Money in', icon: ArrowDownLeft }, { value: 'out', label: 'Money out', icon: ArrowUpRight }]} />
        </div>
        <div className="form-grid">
          <Field label="Account" required error={touched ? txErr.accountId : ''}>
            <select className="select" value={tx.accountId} onChange={(e) => setTx({ ...tx, accountId: e.target.value })}>
              <option value="">Select…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Date"><input className="input" type="date" value={tx.date} onChange={(e) => setTx({ ...tx, date: e.target.value })} /></Field>
          <Field label="Description" required error={touched ? txErr.description : ''} className="span-all"><input className={`input ${touched && txErr.description ? 'invalid' : ''}`} value={tx.description} onChange={(e) => setTx({ ...tx, description: e.target.value })} /></Field>
          <Field label="Amount" required error={touched ? txErr.amount : ''}><div className="input-addon"><span>₹</span><input className={`input ${touched && txErr.amount ? 'invalid' : ''}`} type="number" value={tx.amount} onChange={(e) => setTx({ ...tx, amount: e.target.value })} /></div></Field>
          <Field label="Category"><select className="select" value={tx.category} onChange={(e) => setTx({ ...tx, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        </div>
      </Modal>

      <Modal
        open={accOpen}
        onClose={() => setAccOpen(false)}
        title="Add account"
        footer={<><button className="btn btn-secondary" onClick={() => setAccOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={() => {
          setTouched(true);
          if (!acc.name.trim()) return;
          addAcc.mutate({ ...acc, name: acc.name.trim(), openingBalance: Number(acc.openingBalance) || 0 }, { onSuccess: () => setAccOpen(false) });
        }}>Save account</button></>}
      >
        <div className="form-grid">
          <Field label="Account type" className="span-all">
            <Segmented value={acc.type} onChange={(v) => setAcc({ ...acc, type: v })} options={[{ value: 'Bank', label: 'Bank', icon: Landmark }, { value: 'Cash', label: 'Cash', icon: Wallet }, { value: 'Card', label: 'Card', icon: CreditCard }]} />
          </Field>
          <Field label="Account name" required error={touched && !acc.name.trim() ? 'Required' : ''}><input className={`input ${touched && !acc.name.trim() ? 'invalid' : ''}`} value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} placeholder="e.g. ICICI Current A/c" /></Field>
          <Field label="Bank name"><input className="input" value={acc.bank} onChange={(e) => setAcc({ ...acc, bank: e.target.value })} /></Field>
          <Field label="Account number"><input className="input" value={acc.accountNo} onChange={(e) => setAcc({ ...acc, accountNo: e.target.value })} /></Field>
          <Field label="Opening balance"><div className="input-addon"><span>₹</span><input className="input" type="number" value={acc.openingBalance} onChange={(e) => setAcc({ ...acc, openingBalance: e.target.value })} /></div></Field>
        </div>
      </Modal>
    </div>
  );
}
