/**
 * Sales leads: visitors and shops that haven't paid yet asking the sales team to get in touch (Help → Talk to sales).
 *
 * A lead must reach a person quickly, whatever is or isn't set up:
 *  1. It is saved first (nothing is lost if email fails).
 *  2. The sales inbox is emailed; with no sales email set, the support email; with neither, every super admin.
 *  3. The Super admin console shows new leads live (badge, sound, browser notification): see GET /leads/summary.
 *  4. A lead still "new" after 2 hours gets one reminder email (jobs: runLeadReminders).
 *  5. The visitor gets a confirmation email when they gave one, with the sales phone / WhatsApp to reach us sooner.
 */
import { query } from '../db';
import { badRequest } from '../http';
import { config } from '../config';
import { sendMail } from '../mailer';
import { salesContact } from '../../../shared/support';

export interface LeadInput { name: string; phone: string; email: string; business: string; city: string; message: string; source: string; page: string; ip?: string; shopId?: string | null; suspectedSpam?: boolean }

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Who hears about leads: the sales inbox, else support, else every super admin. */
export async function leadRecipients(): Promise<string[]> {
  const [c] = await query('SELECT support_email, sales_email FROM platform_config WHERE id = 1');
  const to = salesContact({ salesEmail: c?.sales_email, email: c?.support_email }).email;
  if (to) return [to];
  return (await query<{ email: string }>('SELECT email FROM super_admins ORDER BY created_at')).map((r) => r.email).filter(validEmail);
}

const leadLines = (l: { name: string; business: string; city: string; phone: string; email: string; message: string; source: string }) => [
  l.business && `Business: ${l.business}`, l.city && `City: ${l.city}`, l.phone && `Phone: ${l.phone}`, l.email && `Email: ${l.email}`,
  l.message && `Message: ${l.message}`, `Asked from: ${l.source} page`,
].filter(Boolean).join('\n');

export async function saveLead(l: LeadInput) {
  const digits = l.phone.replace(/\D/g, '');
  if (!digits && !l.email) throw badRequest('Give us a phone number or an email so we can reach you');
  if (l.phone && (digits.length < 10 || digits.length > 13)) throw badRequest('Enter a 10-digit phone number');
  if (l.email && !validEmail(l.email)) throw badRequest('Enter a valid email');
  // The same person pressing the button twice (or coming back the same day) is one lead, not two.
  const [dup] = await query<{ id: string }>(`SELECT id FROM sales_leads WHERE status = 'new' AND created_at > now() - interval '24 hours'
      AND ((phone <> '' AND $1 <> '' AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = right($1, 10)) OR (email <> '' AND lower(email) = lower($2))) LIMIT 1`, [digits, l.email]);
  if (dup) {
    if (l.message) await query("UPDATE sales_leads SET message = trim(both E'\\n' from message || E'\\n' || $2), updated_at = now() WHERE id = $1", [dup.id, l.message]);
    return dup;
  }
  const [lead] = await query<{ id: string }>(`INSERT INTO sales_leads (name, phone, email, business, city, message, source, page, shop_id, ip, suspected_spam)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
  [l.name, l.phone, l.email, l.business, l.city, l.message, l.source, l.page, l.shopId ?? null, l.ip ?? '', !!l.suspectedSpam]);
  if (l.suspectedSpam) return lead!;
  const to = await leadRecipients();
  if (to.length) {
    await query('UPDATE sales_leads SET notified_to = $2 WHERE id = $1', [lead!.id, to.join(', ')]);
    for (const addr of to) {
      void sendMail({
        kind: 'sales_lead', shopId: l.shopId ?? undefined, to: addr,
        subject: `New sales lead: ${l.business || l.name}${l.phone ? ` · ${l.phone}` : ''}`,
        text: [`${l.name} asked the sales team to get in touch. Please call them soon: people who are called back within an hour buy far more often.`, '',
          leadLines(l), '', `Open the lead: ${config.appUrl}/super-admin/support?view=leads`].join('\n'),
      }).catch(() => undefined);
    }
  }
  if (l.email) {
    const [c] = await query('SELECT support_email, support_phone, sales_email, sales_phone, sales_whatsapp FROM platform_config WHERE id = 1');
    const s = salesContact({ salesEmail: c?.sales_email, email: c?.support_email, salesPhone: c?.sales_phone, phone: c?.support_phone, salesWhatsapp: c?.sales_whatsapp });
    void sendMail({
      kind: 'sales_lead_ack', shopId: l.shopId ?? undefined, to: l.email,
      subject: 'We got your request: Corpus360 sales team',
      text: [`Hi ${l.name},`, '', 'Thank you for your interest in Corpus360. Our sales team will call you within one working day.', '',
        ...(s.phone ? [`Want to talk sooner? Call ${s.phone}.`] : []), ...(s.whatsapp ? [`WhatsApp us: https://wa.me/${s.whatsapp}`] : []),
        `Start a free trial any time: ${config.appUrl}/signup`, '', 'Corpus360 team'].join('\n'),
    }).catch(() => undefined);
  }
  return lead!;
}

/** Leads still "new" 2 hours after they came in get one reminder to the same people (hourly job). */
export async function runLeadReminders() {
  const rows = await query(`SELECT * FROM sales_leads WHERE status = 'new' AND NOT suspected_spam AND reminded_at IS NULL
      AND created_at < now() - interval '2 hours' AND created_at > now() - interval '3 days' ORDER BY created_at`);
  if (!rows.length) return 0;
  const to = await leadRecipients();
  for (const addr of to) {
    await sendMail({
      kind: 'sales_lead', to: addr,
      subject: `${rows.length} sales lead${rows.length === 1 ? ' is' : 's are'} still waiting for a call`,
      text: [`These people asked us to call and nobody has marked them as contacted yet:`, '',
        ...rows.map((r) => `• ${r.name}${r.business ? ` (${r.business})` : ''}: ${r.phone || r.email} · asked ${new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`),
        '', `Mark them as contacted after the call: ${config.appUrl}/super-admin/support?view=leads`].join('\n'),
    }).catch(() => undefined);
  }
  await query('UPDATE sales_leads SET reminded_at = now() WHERE id = ANY($1)', [rows.map((r) => r.id)]);
  return rows.length;
}
