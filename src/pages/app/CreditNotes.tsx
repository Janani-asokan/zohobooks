import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Undo2 } from 'lucide-react';
import { useCreditNotes } from '@/api/hooks';
import { usePrefs } from '@/context/PrefsContext';
import { Badge, EmptyState, PageHeader, Pagination, SearchInput, usePagination } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { Hint } from '@/components/kit';
import { ExportMenu } from '@/components/ExportMenu';
import { PdfButton } from '@/components/PdfButton';
import { AttachButton } from '@/components/AttachButton';
import { creditNoteTable } from '@/lib/docPdf';

export default function CreditNotes() {
  const { t } = usePrefs();
  const { data = [], isLoading } = useCreditNotes();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.filter((c) => !s || [c.number, c.invoiceNumber, c.customer.name, c.customer.companyName].some((v) => v.toLowerCase().includes(s)));
  }, [data, q]);
  const pg = usePagination(rows, 15);
  return (
    <div className="page">
      <PageHeader title={t('nav.creditNotes')} crumbs={<>{t('nav.sales')} <span>/</span> {t('nav.creditNotes')}</>} subtitle="Returns and post-sale corrections. Raise one from the invoice’s “More” menu; they’re reported in GSTR-1 (CDNR) automatically."
        actions={<ExportMenu disabled={!rows.length} table={() => ({
          title: 'Credit notes', subtitle: `${rows.length} credit notes`, filename: 'credit-notes',
          columns: [{ label: 'Date' }, { label: 'Number' }, { label: 'Invoice' }, { label: 'Customer' }, { label: 'Reason' }, { label: 'GST', money: true }, { label: 'Total', money: true }],
          rows: [...rows.map((c) => ({ cells: [fmtDate(c.date), c.number, c.invoiceNumber, c.customer.companyName || c.customer.name, c.reason, c.taxTotal, c.total] })), { cells: ['Total', '', '', '', '', rows.reduce((a, c) => a + c.taxTotal, 0), rows.reduce((a, c) => a + c.total, 0)], kind: 'total' as const }],
        })} />} />
      <Hint id="creditnotes" title="Returns & corrections">
        <p>Open an issued invoice and choose <strong>More → Credit note</strong> to return goods or correct a price. Returned goods can go back into stock, and the note reduces what the customer owes.</p>
      </Hint>
      <div className="card">
        <div className="toolbar"><div className="toolbar-left"><SearchInput value={q} onChange={setQ} placeholder="Search credit note, invoice, customer…" /></div></div>
        <div className="table-wrap">
          {isLoading ? <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 160 }} /></div> : rows.length === 0 ? <EmptyState icon={Undo2} title="No credit notes" text="Open an issued invoice → More → Create credit note." /> : (
            <table className="table">
              <thead><tr><th>{t('common.date')}</th><th>Credit note #</th><th>Against invoice</th><th>{t('common.customer')}</th><th>Reason</th><th>Stock</th><th className="num">GST</th><th className="num">{t('common.total')}</th><th style={{ width: 84 }} /></tr></thead>
              <tbody>
                {pg.slice.map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDate(c.date)}</td>
                    <td className="strong">{c.number}</td>
                    <td><Link to={`/app/sales/invoices/${c.invoiceId}`}>{c.invoiceNumber}</Link><div className="muted">{fmtDate(c.invoiceDate)}</div></td>
                    <td>{c.customer.companyName || c.customer.name}{c.customer.gstin && <div className="muted">{c.customer.gstin}</div>}</td>
                    <td>{c.reason}</td>
                    <td>{c.restock ? <Badge tone="green" plain>Restocked</Badge> : <Badge tone="gray" plain>—</Badge>}</td>
                    <td className="num">{money(c.taxTotal)}</td>
                    <td className="num strong">{money(c.total)}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}><PdfButton iconOnly table={() => creditNoteTable(c)} /><AttachButton entity="credit_note" entityId={c.id} title={c.number} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination {...pg} />
      </div>
    </div>
  );
}
