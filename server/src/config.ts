import path from 'node:path';

const env = process.env;
const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

export const config = {
  env: env.NODE_ENV ?? 'development',
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://ledgerly:ledgerly@localhost:5432/ledgerly',
  /** Public base URL used in emails, reset links and shared invoice links. */
  /** Render sets RENDER_EXTERNAL_URL automatically. */
  appUrl: (env.APP_URL ?? env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  allowedOrigins: [
    ...(env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4000,http://localhost:4173').split(',').map((s) => s.trim()),
    ...[env.APP_URL, env.RENDER_EXTERNAL_URL].filter((v): v is string => !!v).map((v) => v.replace(/\/$/, '')),
  ],
  cookieSecure: bool(env.COOKIE_SECURE, env.NODE_ENV === 'production'),
  sessionDays: Number(env.SESSION_DAYS ?? 7),
  /** In development, password-reset links are returned in the API response so the flow is testable without SMTP. */
  exposeDevResetLinks: bool(env.EXPOSE_DEV_RESET_LINKS, env.NODE_ENV !== 'production'),
  lockout: { maxAttempts: Number(env.LOCKOUT_ATTEMPTS ?? 5), minutes: Number(env.LOCKOUT_MINUTES ?? 15) },
  backups: {
    dir: env.BACKUP_DIR ?? path.resolve(process.cwd(), 'backups'),
    keep: Number(env.BACKUP_KEEP ?? 14),
    enabled: bool(env.BACKUPS_ENABLED, env.NODE_ENV === 'production'),
  },
  jobs: { enabled: bool(env.JOBS_ENABLED, env.NODE_ENV !== 'test') },
  smtp: env.SMTP_HOST
    ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 587), user: env.SMTP_USER ?? '', pass: env.SMTP_PASS ?? '', from: env.SMTP_FROM ?? 'Ledgerly Books <no-reply@ledgerly.in>' }
    : null,
  razorpay: env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET } : null,
  /** E-invoice (IRP) provider credentials — when absent, the app generates the JSON for manual upload only. */
  einvoice: env.EINVOICE_API_URL ? { url: env.EINVOICE_API_URL, clientId: env.EINVOICE_CLIENT_ID ?? '', clientSecret: env.EINVOICE_CLIENT_SECRET ?? '' } : null,
  whatsapp: env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID ? { token: env.WHATSAPP_TOKEN, phoneId: env.WHATSAPP_PHONE_ID } : null,
  staticDir: env.STATIC_DIR ?? path.resolve(process.cwd(), 'dist'),
};
