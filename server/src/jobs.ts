import { config } from './config';
import { query, withTenant } from './db';
import { sendMail } from './mailer';
import { runBackup } from './services/backup';
import { createInvoice } from './services/documents';
import { getOrg } from './services/common';
import { emailReminder } from './routes/shop/sales';
import { todayISO } from './auth';

const addPeriod = (iso: string, f: string) => {
  const d = new Date(iso + 'T00:00:00');
  if (f === 'weekly') d.setDate(d.getDate() + 7);
  else if (f === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (f === 'quarterly') d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Generates invoices for every recurring profile that is due (catches up missed periods). */
export async function runRecurring(today = todayISO()) {
  const shops = await query('SELECT id FROM shops WHERE active AND license_end >= $1', [today]);
  let created = 0;
  for (const s of shops) {
    await withTenant(s.id, async (db) => {
      const due = (await db.query("SELECT * FROM recurring_profiles WHERE shop_id = $1 AND active AND next_date <= $2 AND (end_date IS NULL OR next_date <= end_date) FOR UPDATE SKIP LOCKED", [s.id, today])).rows;
      for (const p of due) {
        let next = p.next_date as string;
        while (next <= today && (!p.end_date || next <= p.end_date)) {
          await db.query('SAVEPOINT rec');
          try {
            await createInvoice(db, null, s.id, {
              customerId: p.customer_id, date: next, dueDate: addDays(next, p.terms_days),
              branchId: p.branch_id, lines: p.lines, withGst: p.with_gst, reverseCharge: false, tcsRate: 0, notes: p.notes,
            }, { issue: p.auto_issue, source: 'recurring', recurringId: p.id });
            await db.query('RELEASE SAVEPOINT rec');
            created++;
          } catch (e) {
            await db.query('ROLLBACK TO SAVEPOINT rec');
            console.error(`[recurring] profile ${p.id} failed:`, (e as Error).message);
            await db.query('UPDATE recurring_profiles SET active = false WHERE id = $1', [p.id]);
            break;
          }
          next = addPeriod(next, p.frequency);
        }
        await db.query('UPDATE recurring_profiles SET next_date = $2, last_run_at = now() WHERE id = $1', [p.id, next]);
      }
    });
  }
  return created;
}

/** Emails overdue-invoice reminders for shops that turned on auto reminders (at most every N days per invoice). */
export async function runReminders() {
  const shops = await query('SELECT id FROM shops WHERE active AND license_end >= current_date');
  let sent = 0;
  for (const s of shops) {
    await withTenant(s.id, async (db) => {
      const org = await getOrg(db, s.id);
      if (!org.auto_reminders) return;
      const invs = (await db.query(
        `SELECT * FROM invoices WHERE shop_id = $1 AND status = 'Issued' AND due_date < current_date AND total - amount_paid - amount_credited > 0
           AND (last_reminder_at IS NULL OR last_reminder_at < now() - make_interval(days => $2)) LIMIT 200`,
        [s.id, org.reminder_days],
      )).rows;
      for (const inv of invs) {
        const r = await emailReminder(db, s.id, inv, org);
        await db.query("INSERT INTO reminder_log (shop_id, invoice_id, channel, status, detail) VALUES ($1,$2,'email',$3,$4)", [s.id, inv.id, r.status, `Auto: ${r.detail}`]);
        await db.query('UPDATE invoices SET last_reminder_at = now() WHERE id = $1', [inv.id]);
        if (r.status === 'sent') sent++;
      }
    });
  }
  return sent;
}

/** Emails shop owners 15, 7 and 1 day(s) before their license expires. */
export async function runLicenseReminders() {
  const rows = await query(
    `SELECT s.id, s.name, s.license_end, u.email, u.name AS owner, s.license_end - current_date AS days
       FROM shops s JOIN users u ON u.shop_id = s.id AND u.role = 'Owner'
      WHERE s.active AND s.license_end - current_date IN (15, 7, 1) AND (s.last_expiry_reminder IS NULL OR s.last_expiry_reminder < current_date)`,
  );
  for (const r of rows) {
    await sendMail({
      to: r.email,
      subject: `Your Corpus360 license expires in ${r.days} day${r.days > 1 ? 's' : ''}`,
      text: `Hi ${r.owner},\n\nThe license for "${r.name}" expires on ${r.license_end}. Renew from ${config.appUrl}/app/billing to avoid interruption.`,
    });
    await query('UPDATE shops SET last_expiry_reminder = current_date WHERE id = $1', [r.id]);
  }
  return rows.length;
}

export function startJobs() {
  if (!config.jobs.enabled) return;
  const safe = (name: string, fn: () => Promise<unknown>) => () => fn().catch((e) => console.error(`[job:${name}]`, e));
  const hourly = () => {
    safe('recurring', runRecurring)();
    safe('reminders', runReminders)();
    safe('license', runLicenseReminders)();
    safe('sessions', () => query("DELETE FROM sessions WHERE expires_at < now(); DELETE FROM password_resets WHERE expires_at < now() - interval '7 days'"))();
  };
  setTimeout(hourly, 10_000);
  setInterval(hourly, 60 * 60_000);
  if (config.backups.enabled) setInterval(safe('backup', runBackup), 24 * 60 * 60_000);
}
