import type { Request, Response } from 'express';
import { userCtx, type UserCtx } from '../../auth';
import { withTenant, type Db } from '../../db';
import { h } from '../../http';
import type { Permission } from '../../../../shared/permissions';

/** Handler that runs inside a tenant-scoped transaction. Returning a value sends it as JSON. */
export const T = (fn: (db: Db, req: Request, c: UserCtx, res: Response) => Promise<unknown>) =>
  h(async (req, res) => {
    const c = userCtx(req);
    const out = await withTenant(c.shopId, (db) => fn(db, req, c, res));
    if (!res.headersSent) res.json(out ?? { ok: true });
  });

export const allowed = (c: UserCtx, p: Permission) => c.permissions.includes(p);
