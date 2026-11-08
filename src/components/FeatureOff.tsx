import { isWebOnly } from '@/layouts/nav';
import { Link } from 'react-router-dom';
import { Check, Sparkles } from 'lucide-react';
import { useShopUser } from '@/context/AuthContext';
import { featureForPage, type FeatureDef } from '../../shared/features';

/**
 * Shown instead of a page whose add-on feature this shop doesn't have. It says what the feature does in plain
 * words and how to get it, so a locked page never looks broken. Nothing is deleted when a feature is off.
 */
export function FeatureOff({ feature, isOwner }: { feature: FeatureDef; isOwner: boolean }) {
  return (
    <div className="page">
      <div className="card feature-off">
        <span className="feature-off-icon"><Sparkles size={22} /></span>
        <h2>{feature.name} isn’t turned on</h2>
        <p className="muted">{feature.summary}</p>
        <ul className="feature-includes">
          {feature.includes.map((i) => <li key={i}><Check size={15} /> {i}</li>)}
        </ul>
        {isOwner ? (
          <div className="row" style={{ gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to={`/app/features?f=${feature.key}`} className="btn btn-primary">See price and turn on</Link>
            <Link to="/app" className="btn btn-secondary">Back to dashboard</Link>
          </div>
        ) : (
          <>
            <p className="small muted">Ask the shop owner to turn it on in Settings → Features.</p>
            <Link to="/app" className="btn btn-primary">Back to dashboard</Link>
          </>
        )}
        <p className="small muted" style={{ marginTop: 14 }}>Anything saved here before is kept, and appears again as soon as it is turned on.</p>
      </div>
    </div>
  );
}

/** For core screens that link to add-on pages: true when the page at `to` is available to this shop. */
export function usePageOk() {
  const me = useShopUser();
  return (to: string) => {
    if (isWebOnly(to)) return false;
    const f = featureForPage(to.split('?')[0]!);
    return !f || me.has(f.key);
  };
}
