import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { csrfGuard, loadSession, requireShopUser } from './auth';
import { config } from './config';
import { query } from './db';
import { errorHandler, HttpError } from './http';
import { authRouter } from './routes/auth';
import { platformRouter } from './routes/platform';
import { publicRouter } from './routes/public';
import { catalogRouter } from './routes/shop/catalog';
import { billingRouter, coreRouter } from './routes/shop/core';
import { moneyRouter } from './routes/shop/money';
import { reportsRouter } from './routes/shop/reports';
import { salesRouter } from './routes/shop/sales';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
          frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
          mediaSrc: ["'self'", 'blob:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '3mb' }));

  app.get('/api/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ ok: true });
  });

  app.use('/api', loadSession, csrfGuard);
  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/platform', platformRouter);
  app.use('/api/billing', requireShopUser({ allowExpired: true }), billingRouter);
  app.use('/api/shop', requireShopUser(), coreRouter, catalogRouter, salesRouter, moneyRouter, reportsRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found', 'not_found')));
  app.use('/api', errorHandler);

  // Production: serve the built SPA with history-API fallback.
  const index = path.join(config.staticDir, 'index.html');
  if (fs.existsSync(index)) {
    app.use(express.static(config.staticDir, { index: false, maxAge: '1h', setHeaders: (res, p) => p.endsWith('sw.js') && res.setHeader('Cache-Control', 'no-cache') }));
    app.get('*', (_req, res) => res.sendFile(index));
  }
  app.use(errorHandler);
  return app;
}
