/**
 * Meta's webhook for the WhatsApp Business (Cloud) API. Public (Meta has no session): every POST must carry a valid
 * X-Hub-Signature-256 made with WHATSAPP_APP_SECRET, and GET only answers Meta's verification with the right
 * WHATSAPP_VERIFY_TOKEN. Mounted before the JSON body parser, because the signature is over the exact raw bytes.
 */
import express, { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config';
import { handleWebhook, validSignature } from '../services/whatsappCloud';

export const whatsappWebhookRouter = Router();

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Meta checks the webhook URL once, when it is saved in the Meta app. */
whatsappWebhookRouter.get('/', (req, res) => {
  const token = config.whatsapp?.verifyToken ?? '';
  if (req.query['hub.mode'] === 'subscribe' && token && same(String(req.query['hub.verify_token'] ?? ''), token)) {
    return res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  }
  res.sendStatus(403);
});

whatsappWebhookRouter.post('/', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!validSignature(raw, req.header('x-hub-signature-256'))) return res.sendStatus(401);
  let payload: unknown;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.sendStatus(400); }
  try {
    await handleWebhook(payload);
    res.sendStatus(200);
  } catch (e) {
    // A 5xx makes Meta retry later; storing is idempotent, so a retry can't duplicate anything.
    console.error('[whatsapp] webhook failed:', (e as Error).message);
    res.sendStatus(500);
  }
});
