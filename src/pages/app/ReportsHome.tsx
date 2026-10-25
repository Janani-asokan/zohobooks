import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, BookOpen, Boxes, Clock4, FileText, History, Landmark, NotebookPen, Package, Percent, Scale, TrendingUp, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useShopUser } from '@/context/AuthContext';
import { PageHeader, SearchInput } from '@/components/ui';
import type { Permission } from '../../../shared/permissions';
import { REPORTS } from './ReportView';

interface Entry { to: string; title: string; description: string; icon: LucideIcon; perm: Permission; group: string }

const ICON: Record<string, LucideIcon> = {
  'profit-loss': TrendingUp, 'balance-sheet': Scale, 'cash-flow': Wallet, 'trial-balance': Landmark,
  'sales-by-customer': Users, 'sales-by-item': Package, receivables: Clock4, payables: Clock4,
};

const EXTRA: Entry[] = [
  { to: '/app/inventory/stock-summary', title: 'Stock Summary', description: 'Opening, received, issued and closing stock for any period and warehouse.', icon: Boxes, perm: 'reports.read', group: 'Inventory' },
  { to: '/app/inventory/stock-summary?view=category', title: 'Inventory Valuation', description: 'Value of stock on hand at cost, by item and category.', icon: BarChart3, perm: 'items.cost', group: 'Inventory' },
  { to: '/app/reports/gst', title: 'GST Returns', description: 'GSTR-1, GSTR-3B and the HSN summary, with JSON for the GST portal.', icon: Percent, perm: 'reports.read', group: 'Taxes' },
  { to: '/app/accounting/ledger', title: 'General Ledger', description: 'Every entry posted to an account, with the running balance.', icon: BookOpen, perm: 'accounting.read', group: 'Accountant' },
  { to: '/app/accounting/journals', title: 'Manual Journals', description: 'Opening balances, depreciation and other adjusting entries.', icon: NotebookPen, perm: 'accounting.read', group: 'Accountant' },
  { to: '/app/audit', title: 'Audit Log', description: 'Who changed what, and when.', icon: History, perm: 'audit.read', group: 'Accountant' },
];

const GROUPS = ['Business overview', 'Sales', 'Purchases', 'Inventory', 'Taxes', 'Accountant'];

/** All reports in one place, grouped the way an owner or accountant looks for them. */
export default function ReportsHome() {
  const me = useShopUser();
  const [q, setQ] = useState('');
  const entries = useMemo<Entry[]>(() => [
    ...Object.entries(REPORTS).map(([id, r]) => ({ to: `/app/reports/${id}`, title: r.title, description: r.description, icon: ICON[id] ?? FileText, perm: r.perm, group: r.group })),
    ...EXTRA,
  ].filter((e) => me.can(e.perm)), [me]);
  const s = q.trim().toLowerCase();
  const shown = entries.filter((e) => !s || `${e.title} ${e.description} ${e.group}`.toLowerCase().includes(s));

  return (
    <div className="page">
      <PageHeader title="Reports" subtitle="Every report can be filtered by date and exported to PDF, Excel or CSV." actions={<SearchInput value={q} onChange={setQ} placeholder="Find a report…" />} />
      <div className="report-cards">
        {GROUPS.map((g) => {
          const list = shown.filter((e) => e.group === g);
          if (!list.length) return null;
          return (
            <div key={g} className="card report-group" style={{ padding: 16 }}>
              <h3>{g}</h3>
              <div className="stack" style={{ gap: 2 }}>
                {list.map((e) => (
                  <Link key={e.to} to={e.to} className="report-link">
                    <e.icon size={16} />
                    <div><strong>{e.title}</strong><span>{e.description}</span></div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {!shown.length && <p className="muted" style={{ textAlign: 'center', marginTop: 32 }}>No report matches “{q}”.</p>}
    </div>
  );
}
