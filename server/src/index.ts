import './tz';
import { createApp } from './app';
import { config } from './config';
import { query } from './db';
import { startJobs } from './jobs';
import { mailStatus } from './mailer';
import { migrate } from './migrate';
import { runBackup } from './services/backup';
import { hashPassword } from './auth';
import { isStrongPassword } from '../../shared/permissions';

/**
 * First start on an empty database:
 *  - SEED_DEMO=1 loads the demo shops (passwords = DEMO_PASSWORD when set), or
 *  - SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD create the platform owner account.
 * Never touches a database that already has a super admin.
 */
async function bootstrap() {
  const [{ n }] = await query<{ n: number }>('SELECT count(*)::int AS n FROM super_admins');
  if (n > 0) return;
  if (process.env.SEED_DEMO === '1') {
    const { seed } = await import('./seed');
    await seed();
    return;
  }
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('[bootstrap] No super admin yet. Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD (or SEED_DEMO=1) and restart.');
    return;
  }
  if (!isStrongPassword(password)) throw new Error('SUPERADMIN_PASSWORD must be at least 8 characters with a letter and a number');
  await query("INSERT INTO super_admins (name, email, password_hash) VALUES ('Platform Admin', lower($1), $2)", [email, await hashPassword(password)]);
  console.log(`[bootstrap] Created super admin ${email}`);
}

/** Before changing the schema of a database that has data, take a backup so a bad release can be rolled back. */
async function backupBeforeMigrating(pending: string[]) {
  if (pending.includes('001_init.sql')) return; // brand-new database, nothing to save yet
  if (!config.backups.enabled) {
    console.warn(`[migrate] Applying ${pending.join(', ')} without a backup first: backups are off (BACKUPS_ENABLED=0). Make sure the database host keeps daily backups.`);
    return;
  }
  try {
    const b = await runBackup();
    console.log(`[migrate] Backup before migrating: ${b.file} (${Math.round(b.bytes / 1024)} KB)`);
  } catch (e) {
    if (process.env.MIGRATE_WITHOUT_BACKUP === '1') console.warn(`[migrate] Backup failed, continuing because MIGRATE_WITHOUT_BACKUP=1: ${(e as Error).message}`);
    else throw new Error(`Backup before migrating failed, so the database was not changed. Fix the backup or set MIGRATE_WITHOUT_BACKUP=1 once: ${(e as Error).message}`);
  }
}

async function main() {
  await migrate(undefined, console.log, { beforeApply: backupBeforeMigrating });
  await bootstrap();
  if (config.demoSimplePasswords) {
    const { resetDemoPasswords } = await import('./seed');
    await resetDemoPasswords();
    console.log('[bootstrap] Demo mode: demo accounts use their simple passwords (owner123, admin123 …). Set DEMO_SIMPLE_PASSWORDS=0 to turn off.');
  }
  const mail = mailStatus();
  if (mail.configured) console.log(`[mail] Sending email via ${mail.provider} from ${mail.from}`);
  else if (config.isProd) console.warn('[mail] No email provider configured: password-reset and invoice emails will NOT be sent. Set BREVO_API_KEY (or RESEND_API_KEY, or SMTP_HOST) and MAIL_FROM.');
  const app = createApp();
  app.listen(config.port, () => console.log(`[server] Corpus360 API listening on :${config.port} (${config.env})`));
  startJobs();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
