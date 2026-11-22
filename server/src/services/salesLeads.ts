/**
 * Sales leads: visitors and shops that haven't paid yet asking the sales team to get in touch (Help → Talk to sales).
 * Each lead is saved for Super admin → Customer care → Sales leads, and the sales inbox gets an email about it when
 * email is set up (best effort: the lead is saved either way).
 */
import { query } from '../db';
import { badRequest } from '../http';
import { sendMail } from '../mailer';
import { salesContact } from '../../../shared/support';

export interface LeadInput { name: string; phone: string; email: string; business: string; city: string; message: string; source: string; page: string; ip?: string; shopId?: string | null }

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function saveLead(l: LeadInput) {
  const digits = l.phone.replace(/\D/g, '');
  if (!digits && !l.email) throw badRequest('Give us a phone number or an email so we can reach you');
  if (l.phone && (digits.length < 10 || digits.length > 13)) throw badRequest('Enter a 10-digit phone number');
  if (l.email && !validEmail(l.email)) throw badRequest('Enter a valid email');
  const [lead] = await query<{ id: string }>(`INSERT INTO sales_leads (name, phone, email, business, city, message, source, page, shop_id, ip)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
  [l.name, l.phone, l.email, l.business, l.city, l.message, l.source, l.page, l.shopId ?? null, l.ip ?? '']);
  const [c] = await query('SELECT support_email, sales_email FROM platform_config WHERE id = 1');
  const to = salesContact({ salesEmail: c?.sales_email, email: c?.support_email }).email;
  if (to) {
    void sendMail({
      kind: 'sales_lead', shopId: l.shopId ?? undefined, to,
      subject: `New sales lead: ${l.business || l.name}`,
      text: [`${l.name} asked the sales team to get in touch (from the ${l.source} page).`, '',
        l.business && `Business: ${l.business}`, l.city && `City: ${l.city}`, l.phone && `Phone: ${l.phone}`, l.email && `Email: ${l.email}`,
        l.message && `\nMessage: ${l.message}`, '', 'See all leads in Super admin → Customer care → Sales leads.'].filter(Boolean).join('\n'),
    }).catch(() => undefined);
  }
  return lead!;
}
