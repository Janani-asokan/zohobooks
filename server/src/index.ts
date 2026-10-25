import './tz';
import { createApp } from './app';
import { config } from './config';
import { query } from './db';
import { startJobs } from './jobs';
import { migrate } from './migrate';
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

async function main() {
  await migrate();
  await bootstrap();
  if (config.demoSimplePasswords) {
    const { resetDemoPasswords } = await import('./seed');
    await resetDemoPasswords();
    console.log('[bootstrap] Demo mode: demo accounts use their simple passwords (owner123, admin123 …). Set DEMO_SIMPLE_PASSWORDS=0 to turn off.');
  }
  const app = createApp();
  app.listen(config.port, () => console.log(`[server] Corpus360 API listening on :${config.port} (${config.env})`));
  startJobs();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
