import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, 'bad_request', details);
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`, 'not_found');
export const forbidden = (m = 'You don’t have permission to do this') => new HttpError(403, m, 'forbidden');
export const conflict = (m: string) => new HttpError(409, m, 'conflict');

/** Express 4 doesn't catch rejected promises — wrap async handlers. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join('.') || '_'] = i.message;
    throw badRequest(r.error.issues[0]?.message ?? 'Invalid input', fields);
  }
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues[0]?.message, code: 'bad_request' });
  const pgErr = err as { code?: string; constraint?: string; detail?: string };
  if (pgErr?.code === '23505') return res.status(409).json({ error: uniqueMessage(pgErr.constraint), code: 'conflict' });
  if (pgErr?.code === '23503') return res.status(409).json({ error: 'This record is referenced by other records', code: 'conflict' });
  if (pgErr?.code === '23514') return res.status(400).json({ error: 'Invalid value: ' + (pgErr.constraint ?? 'check failed'), code: 'bad_request' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'internal' });
}

function uniqueMessage(constraint?: string) {
  const map: Record<string, string> = {
    users_email_uq: 'A user with this email already exists',
    items_barcode_uq: 'Barcode already assigned to another item',
    items_sku_uq: 'SKU already exists',
    tax_slabs_rate_key: 'A slab with this rate already exists',
  };
  return (constraint && map[constraint]) || 'Duplicate value';
}
