import { ExternalLink, MonitorSmartphone } from 'lucide-react';
import { API_BASE } from '@/lib/platform';

/** CorpusLite keeps the shop essentials on the phone; this part of Corpus360 is on the website. */
export default function WebOnly() {
  const url = `${API_BASE}${window.location.pathname}`;
  return (
    <div className="page"><div className="card" style={{ maxWidth: 520, margin: '48px auto', padding: 28, textAlign: 'center' }}>
      <MonitorSmartphone size={34} style={{ color: 'var(--accent)' }} />
      <h2 style={{ margin: '10px 0 6px' }}>This is on the website</h2>
      <p className="muted">CorpusLite has billing, items, stock, customers, purchases, invoices and labels. Accounting, AI, field staff and microfinance are on the Corpus360 website.</p>
      <a className="btn btn-primary" style={{ marginTop: 14 }} href={url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open the website</a>
    </div></div>
  );
}
