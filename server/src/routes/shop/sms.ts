import { Router } from 'express';
import { z } from 'zod';
import { perm, rateLimit } from '../../auth';
import { audit } from '../../audit';
import { one } from '../../db';
import { badRequest, HttpError, parse } from '../../http';
import { sendBillSms, smsSentToday, smsSettings } from '../../services/sms';
import { getInvoice } from '../../services/documents';
import { T } from './ctx';

/** Bills by SMS (MSG91): whether it is on and how many are left today; send one bill to a mobile number. */
export const smsRouter = Router();

smsRouter.get('/sms/status', T(async (db, _req, c) => {
  const s = await smsSettings();
  if (!s?.enabled) return { on: false, leftToday: 0 };
  return { on: true, leftToday: Math.max(0, s.dailyPerShop - (await smsSentToday(db, c.shopId))) };
}));

smsRouter.post('/invoices/:id/sms', perm('sales.write'), rateLimit('sms-invoice', 30, 60_000), T(async (db, req, c) => {
  const b = parse(z.object({ phone: z.string().trim().max(20) }), req.body);
  const s = await smsSettings();
  if (!s?.enabled) throw badRequest('Sending bills by SMS isn’t switched on yet.');
  if ((await smsSentToday(db, c.shopId)) >= s.dailyPerShop) throw new HttpError(429, `Today’s SMS limit (${s.dailyPerShop}) is used up. Share the bill on WhatsApp instead, or try tomorrow.`, 'sms_limit');
  const inv = await getInvoice(db, c.shopId, req.params.id!);
  if (inv.status !== 'Issued' || !inv.publicToken) throw badRequest('Only an issued invoice can be sent by SMS.');
  const org = await one(db, 'SELECT company_name FROM organizations WHERE shop_id = $1', [c.shopId]);
  const r = await sendBillSms({ phone: b.phone, customer: inv.customer.name || inv.customer.companyName, shop: org?.company_name || 'our shop',
    bill: inv.number ?? '', amount: inv.total, linkToken: inv.publicToken });
  await audit(db, req, c.shopId, 'sms_sent', 'invoice', inv.id, { to: `…${r.to.slice(-4)}` });
  return { sent: true, to: r.to };
}));
