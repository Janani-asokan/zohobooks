import { Router } from 'express';
import { z } from 'zod';
import { perm } from '../../auth';
import { audit } from '../../audit';
import { parse } from '../../http';
import { FEATURES } from '../../../../shared/features';
import { cancelRequest, loadEntitlements, priceList, requestFeature, shopFeatureHistory } from '../../services/features';
import { T } from './ctx';

/** The owner's Features page: what can be switched on, what it costs, what this shop has, and asking for more. */
export const featuresRouter = Router();

featuresRouter.get(
  '/features',
  perm('admin'),
  T(async (_db, _req, c) => {
    const [prices, ent, history] = await Promise.all([priceList(), loadEntitlements(c.shopId), shopFeatureHistory(c.shopId)]);
    return {
      features: FEATURES.filter((f) => f.available).map((f) => {
        const current = history.find((h) => h.feature === f.key && h.status === 'active' && h.live);
        const request = history.find((h) => h.feature === f.key && h.status === 'requested');
        return {
          key: f.key, name: f.name, group: f.group, summary: f.summary, includes: f.includes,
          levels: f.levels.map((l) => ({ ...l, ...prices.find((p) => p.feature === f.key && p.level === l.key)! })),
          on: !!ent[f.key],
          level: ent[f.key] ?? null,
          source: current?.source ?? null,
          endsOn: current?.endsOn ?? null,
          requested: request ? { level: request.level, at: request.createdAt } : null,
        };
      }),
      history: history.slice(0, 50),
    };
  }),
);

featuresRouter.post(
  '/features/:key/request',
  perm('admin'),
  T(async (db, req, c) => {
    const b = parse(z.object({ level: z.string().min(1).max(40), note: z.string().trim().max(300).default('') }), req.body);
    const id = await requestFeature(c.shopId, req.params.key!, b.level, c.email, b.note);
    await audit(db, req, c.shopId, 'request_feature', 'feature', id, { feature: req.params.key, level: b.level });
    return { ok: true };
  }),
);

featuresRouter.delete(
  '/features/:key/request',
  perm('admin'),
  T(async (db, req, c) => {
    await cancelRequest(c.shopId, req.params.key!, c.email);
    await audit(db, req, c.shopId, 'withdraw_feature_request', 'feature', c.shopId, { feature: req.params.key });
  }),
);
