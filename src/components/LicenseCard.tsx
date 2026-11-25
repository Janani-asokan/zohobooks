import { BadgeCheck, GitBranch, Users } from 'lucide-react';
import { FEATURES } from '../../shared/features';
import { fmtDate } from '@/lib/format';

/** The licence number printed on the card: from the business's ID, so it never changes. */
export function licenseNumber(shopId: string, planId: string) {
  const h = shopId.replace(/[^0-9a-f]/gi, '').toUpperCase().padEnd(16, '0');
  const code = planId === 'premium' ? 'PRM' : planId === 'standard' ? 'STD' : planId === 'trial' ? 'TRL' : planId.slice(0, 3).toUpperCase();
  return `C360-${code}-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(-4)}`;
}

export interface LicenseInfo {
  shopId: string; shopName: string; planId: string; planName: string; licenseStart: string; licenseEnd: string; expired: boolean;
  users: number; branches: number; features: Record<string, string>;
}

/** The add-ons this business owns, by name (and level when there are several). */
export function ownedAddOns(features: Record<string, string>) {
  return Object.entries(features).map(([k, level]) => {
    const f = FEATURES.find((x) => x.key === k);
    if (!f || f.retired) return null;
    const lv = f.levels.length > 1 ? f.levels.find((l) => l.key === level)?.name : null;
    return { key: k, name: f.name, level: lv ?? null };
  }).filter((x): x is { key: string; name: string; level: string | null } => !!x);
}

/**
 * The Corpus360 licence as a card, like a membership or a software key you own: the plan as its edition, the
 * business it is licensed to, its licence number, valid dates, seats and the add-ons that come with it.
 * Trial is silver, Standard teal, Premium black and gold; an expired licence is greyed with a stamp.
 */
export function LicenseCard({ l, compact }: { l: LicenseInfo; compact?: boolean }) {
  const tier = l.planId === 'premium' ? 'premium' : l.planId === 'trial' ? 'trial' : 'standard';
  const addOns = ownedAddOns(l.features);
  const thru = new Date(l.licenseEnd);
  const mmYY = Number.isNaN(thru.getTime()) ? '' : `${String(thru.getMonth() + 1).padStart(2, '0')}/${String(thru.getFullYear()).slice(-2)}`;
  return (
    <div className={`lic-card lic-${tier} ${l.expired ? 'expired' : ''} ${compact ? 'compact' : ''}`} role="img"
      aria-label={`Corpus360 ${l.planName} licence for ${l.shopName}, number ${licenseNumber(l.shopId, l.planId)}, valid till ${fmtDate(l.licenseEnd)}${l.expired ? ', expired' : ''}`}>
      <div className="lic-shine" aria-hidden="true" />
      <div className="lic-top">
        <span className="lic-brand">corpus<b>360</b></span>
        <span className="lic-edition">{l.planName}{addOns.length ? ' +' : ''}</span>
      </div>
      <div className="lic-mid">
        <span className="lic-chip" aria-hidden="true"><i /><i /><i /><i /></span>
        <span className="lic-seal">{l.expired ? 'Expired' : <><BadgeCheck size={14} /> Licensed</>}</span>
      </div>
      <div className="lic-number">{licenseNumber(l.shopId, l.planId)}</div>
      <div className="lic-bottom">
        <div className="lic-holder">
          <small>Licensed to</small>
          <strong>{l.shopName}</strong>
        </div>
        <div className="lic-thru">
          <small>Valid thru</small>
          <strong>{mmYY}</strong>
        </div>
      </div>
      {!compact && (
        <div className="lic-perks">
          <span><Users size={12} /> {l.users} users</span>
          <span><GitBranch size={12} /> {l.branches} {l.branches === 1 ? 'branch' : 'branches'}</span>
          {addOns.slice(0, 4).map((a) => <span key={a.key}>{a.name}</span>)}
          {addOns.length > 4 && <span>+{addOns.length - 4} more</span>}
        </div>
      )}
      {l.expired && <div className="lic-stamp" aria-hidden="true">Expired</div>}
    </div>
  );
}
