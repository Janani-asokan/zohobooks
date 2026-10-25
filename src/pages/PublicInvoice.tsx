import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, FileX, Printer, Smartphone } from 'lucide-react';
import { api, download } from '@/api/client';
import { printPage } from '@/lib/report';
import type { Invoice } from '@/api/types';
import { upiLink } from '@/components/qr';
import { TaxInvoice, type PrintBranch, type PrintOrg } from '@/components/TaxInvoice';
import { EmptyState } from '@/components/ui';
import { FullPageSpinner } from '@/components/ProtectedRoute';
import { money } from '@/lib/format';
import { withPrintDefaults, type PrintSettings } from '../../shared/printSettings';

/** Customer-facing invoice page behind an unguessable link (shared via WhatsApp / email). */
export default function PublicInvoice() {
  const { token } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['public', token],
    queryFn: () => api.get<{ invoice: Invoice; org: PrintOrg; branch: PrintBranch | null; settings: PrintSettings }>(`/public/invoices/${token}`),
    retry: false,
  });
  if (isLoading) return <FullPageSpinner />;
  if (isError || !data)
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--canvas)' }}>
        <div className="card" style={{ maxWidth: 420 }}><EmptyState icon={FileX} title="Invoice not available" text="This link is invalid or the invoice was withdrawn. Please contact the seller." /></div>
      </div>
    );
  const { invoice: inv, org, branch } = data;
  const settings = withPrintDefaults(data.settings);
  document.title = `${inv.number} · ${org.companyName}`;
  const canPay = org.upiId && inv.balance > 0 && inv.status === 'Issued';
  return (
    <div style={{ background: 'var(--canvas)', minHeight: '100vh', padding: '20px 12px 40px' }}>
      <div className="card" style={{ maxWidth: 'calc(210mm + 50px)', margin: '0 auto 16px', padding: 14 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="strong" style={{ color: 'var(--ink-900)' }}>{org.companyName}</div>
            <div className="small muted">{inv.number} · {inv.balance > 0 && inv.status === 'Issued' ? `${money(inv.balance)} due` : inv.paymentStatus}</div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {canPay && <a className="btn btn-primary" href={upiLink(org, inv.balance, inv.number ?? '')}><Smartphone size={15} /> Pay {money(inv.balance)} by UPI</a>}
            <button className="btn btn-secondary" onClick={() => download(`/public/invoices/${token}/pdf`, `${inv.number}.pdf`).catch(() => printPage(`/invoices/${inv.id}/print?share=${token}&paper=${settings.invoice.paper}`))}><Download size={15} /> Download PDF</button>
            <a className="btn btn-ghost" href={`/invoices/${inv.id}/print?share=${token}&paper=${settings.invoice.paper}`}><Printer size={15} /> Print</a>
          </div>
        </div>
      </div>
      <div className="paper-stage" style={{ maxWidth: 'calc(210mm + 50px)', margin: '0 auto', padding: 24 }}>
        <TaxInvoice inv={inv} org={org} branch={branch} s={settings.invoice} />
      </div>
      <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>Sent with Corpus360</p>
    </div>
  );
}
