import { CheckCircle2, ExternalLink } from 'lucide-react';
import { useShopUser } from '@/context/AuthContext';
import { Badge, PageHeader } from '@/components/ui';
import { LicenseCard } from '@/components/LicenseCard';
import { LicenseIncludes, licenseOf } from '@/components/LicenseWelcome';
import { API_BASE } from '@/lib/platform';
import { daysUntil } from '@/lib/fy';
import { fmtDate } from '@/lib/format';
import '@/styles/license.css';

/**
 * The phone app's Subscription screen: the licence card and what it includes. Plans are chosen and paid on the
 * website (store rules for apps), so renewing opens it in the browser.
 */
export default function AppLicense() {
  const me = useShopUser();
  const l = licenseOf(me);
  const days = daysUntil(me.shop.licenseEnd);
  return (
    <div className="page">
      <PageHeader title="Your licence" subtitle="Your Corpus360 software licence." />
      <section className="card card-body stack" style={{ gap: 14 }}>
        <LicenseCard l={l} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {days < 0 ? <Badge tone="red">Expired on {fmtDate(me.shop.licenseEnd)}</Badge> : days <= 30 ? <Badge tone="amber">{days} days left</Badge> : <Badge tone="green"><CheckCircle2 size={12} /> Active · {days} days left</Badge>}
          <span className="small muted">Valid {fmtDate(me.shop.licenseStart)} – {fmtDate(me.shop.licenseEnd)}</span>
        </div>
        {me.can('admin') && (
          <a className="btn btn-primary" href={`${API_BASE}/app/billing`} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> {days < 0 || l.planId === 'trial' ? 'Choose a plan on the website' : 'Renew or change plan on the website'}
          </a>
        )}
        <div className="divider" />
        <LicenseIncludes l={l} />
      </section>
    </div>
  );
}
