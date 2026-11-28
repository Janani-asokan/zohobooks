import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import { csrfGuard, loadSession, requireShopUser } from './auth';
import { config } from './config';
import { query } from './db';
import { errorHandler, HttpError } from './http';
import { auditWrites } from './audit';
import { authRouter } from './routes/auth';
import { platformRouter } from './routes/platform';
import { publicRouter } from './routes/public';
import { idempotency } from './idempotency';
import { smsRouter } from './routes/shop/sms';
import { ANDROID_PATH, androidFile } from './services/appDownloads';
import { catalogRouter } from './routes/shop/catalog';
import { labelsRouter } from './routes/shop/labels';
import { appDevicesRouter } from './routes/shop/appDevices';
import { supportRouter } from './routes/shop/support';
import { licensesRouter } from './routes/shop/licenses';
import { transfersRouter } from './routes/shop/transfers';
import { billingRouter, coreRouter } from './routes/shop/core';
import { moneyRouter } from './routes/shop/money';
import { purchasingRouter } from './routes/shop/purchasing';
import { reportsRouter } from './routes/shop/reports';
import { salesRouter } from './routes/shop/sales';
import { filesRouter } from './routes/shop/files';
import { challansRouter } from './routes/shop/challans';
import { offersRouter } from './routes/shop/offers';
import { dataRouter } from './routes/shop/dataTransfer';
import { fieldRouter } from './routes/shop/field';
import { attendanceRouter } from './routes/shop/attendance';
import { gstinRouter } from './routes/shop/gstin';
import { briefingRouter } from './routes/shop/briefing';
import { inventoryRouter } from './routes/shop/inventory';
import { accountingRouter } from './routes/shop/accounting';
import { adminRouter } from './routes/shop/admin';
import { featuresRouter } from './routes/shop/features';
import { featureGate } from './services/features';
import { aiContext } from './services/aiUsage';
import { outboundStore } from './services/outbound';
import { whatsappWebhookRouter } from './routes/whatsappWebhook';

/** Lets the email and API-call logs record which shop and person a request was for. */
const shopOutboundCtx = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
  const c = req.ctx as { shopId?: string; id?: string } | undefined;
  outboundStore.run({ shopId: c?.shopId ?? null, userId: c?.id ?? null }, next);
};

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Gzip JSON, HTML, JS and CSS: about a quarter of the bytes on slow mobile connections.
  app.use(compression({ threshold: 1024 }));
  // Security headers. Requests that arrived over https (behind Render's or Caddy's proxy, which says so in
  // X-Forwarded-Proto; "trust proxy" above makes req.secure read it) get HSTS and upgrade-insecure-requests. Plain-http
  // requests (the server's IP address, the PDF renderer on 127.0.0.1) don't: there the browser would rewrite every
  // script request to https, nothing answers, and the page stays blank.
  const securityHeaders = (https: boolean, desktop = false) => helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // wasm-unsafe-eval: voice billing's speech recogniser in the Windows app runs as WebAssembly in a worker.
        // The Windows app only (it says so in its user agent): its speech engine builds small functions at run time.
        scriptSrc: ["'self'", "'wasm-unsafe-eval'", ...(desktop ? ["'unsafe-eval'"] : []), 'https://checkout.razorpay.com', 'https://www.googletagmanager.com'],
        workerSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        // Map tiles for the field staff map (OpenStreetMap).
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://tile.openstreetmap.de',
          'https://*.google-analytics.com', 'https://www.googletagmanager.com'],
        // The Corpus360 Print Helper on the shop's own PC (label printing straight to the printer).
        connectSrc: ["'self'", 'blob:', 'https://api.razorpay.com', 'https://lumberjack.razorpay.com', 'http://127.0.0.1:17361',
          // Google Analytics (website only; src/lib/analytics.ts).
          'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'],
        frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
        mediaSrc: ["'self'", 'blob:'],
        ...(https ? {} : { upgradeInsecureRequests: null }),
      },
    },
    hsts: https,
    crossOriginEmbedderPolicy: false,
    // Map tile servers (OpenStreetMap) refuse requests without a referrer; send only our origin, never the path.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  const httpsHeaders = securityHeaders(true);
  const httpHeaders = securityHeaders(false);
  const desktopHttps = securityHeaders(true, true);
  const desktopHttp = securityHeaders(false, true);
  app.use((req, res, next) => {
    const desktop = /CorpusLiteDesktop\//.test(req.get('user-agent') ?? '');
    return (req.secure ? (desktop ? desktopHttps : httpsHeaders) : (desktop ? desktopHttp : httpHeaders))(req, res, next);
  });
  // Meta's WhatsApp webhook: before the JSON parser and the session/CSRF checks (it signs the raw body instead).
  app.use('/api/webhooks/whatsapp', whatsappWebhookRouter);
  // Uploads (files sent as base64) get a larger body limit than everything else.
  const smallJson = express.json({ limit: '3mb' });
  const uploadJson = express.json({ limit: '15mb' });
  const dataJson = express.json({ limit: '32mb' }); // Tally master exports and big item lists
  app.use((req, res, next) => (/^\/api\/shop\/(tally\/(preview|import)|data-import)$|^\/api\/platform\/app-downloads\//.test(req.path) ? dataJson : /^\/api\/shop\/(extract|attachments)$/.test(req.path) ? uploadJson : smallJson)(req, res, next));

  app.get('/api/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ ok: true });
  });

  // CorpusLite phone app: its web view calls the API from its own origin (capacitor://localhost on iOS,
  // https://localhost on Android). Allowed for those origins only, without cookies (the app sends a bearer token).
  app.use('/api', (req, res, next) => {
    const o = req.headers.origin;
    if (o && config.appOrigins.includes(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, x-requested-with, authorization, x-client, idempotency-key, x-made-offline-at');
      // The app compares its clock with the server's (offline bills are dated by the device clock).
      res.setHeader('Access-Control-Expose-Headers', 'Date');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });
  app.use('/api', loadSession, csrfGuard);
  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/platform', platformRouter);
  app.use('/api/billing', requireShopUser({ allowExpired: true }), billingRouter);
  app.use('/api/shop', requireShopUser(), idempotency, featureGate, aiContext, shopOutboundCtx, auditWrites, featuresRouter, coreRouter, catalogRouter, labelsRouter, appDevicesRouter, supportRouter, licensesRouter, transfersRouter, salesRouter, moneyRouter, purchasingRouter, reportsRouter, filesRouter, challansRouter, offersRouter, dataRouter, fieldRouter, attendanceRouter, gstinRouter, smsRouter, briefingRouter, inventoryRouter, accountingRouter, adminRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found', 'not_found')));
  app.use('/api', errorHandler);

  // The Android app the super admin uploaded (kept in the database, so it survives every update of the server).
  app.get(ANDROID_PATH, async (req, res, next) => {
    try {
      const f = await androidFile();
      if (!f) { res.status(404).type('text/plain').send('The Android app isn’t available for download yet.'); return; }
      if (req.headers['if-none-match'] === `"${f.sha256}"`) { res.status(304).end(); return; }
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', `attachment; filename="CorpusLite-${f.version || 'app'}.apk"`);
      res.setHeader('ETag', `"${f.sha256}"`); res.setHeader('Cache-Control', 'no-cache');
      res.send(f.file);
    } catch (e) { next(e); }
  });

  // Production: serve the built SPA with history-API fallback.
  const index = path.join(config.staticDir, 'index.html');
  if (fs.existsSync(index)) {
    app.use(express.static(config.staticDir, {
      index: false,
      maxAge: '1h',
      setHeaders: (res, p) => {
        if (p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
        // The print helper for Windows: always a download, always the latest build.
        else if (p.includes(`${path.sep}downloads${path.sep}`)) { res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Content-Disposition', `attachment; filename="${path.basename(p)}"`); }
        // Vite names these by content hash, so a changed file always gets a new name: cache for a year.
        else if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
    // A missing download must not fall through to the web page (it would save the page as an .exe).
    app.get('/downloads/*', (_req, res) => { res.status(404).type('text/plain').send('This download is not ready yet. Please try again in a few minutes.'); });
    app.get('*', (_req, res) => res.sendFile(index));
  }
  app.use(errorHandler);
  return app;
}
