/**
 * WhatsApp Business (Cloud) API from Meta, for the support inbox in Customer care.
 *
 * In:  Meta calls our webhook (routes/whatsappWebhook.ts) with new messages and with delivery/read statuses of the
 *      messages we sent. Every call is checked against WHATSAPP_APP_SECRET (X-Hub-Signature-256); repeated deliveries
 *      are harmless because each message is stored once, by Meta's id.
 * Out: agents reply as text while the 24-hour customer-service window is open (it starts with the shop's last
 *      message); after that Meta only allows an approved template (WHATSAPP_TEMPLATE).
 * Every call to Meta goes through trackedFetch, so it shows in Super admin → Logs → API calls.
 */
import crypto from 'node:crypto';
import { config } from '../config';
import { query, tx } from '../db';
import { HttpError } from '../http';
import { trackedFetch } from './outbound';
import { waDigits } from '../../../shared/support';

export const WINDOW_HOURS = 24;
export const waEnabled = () => !!config.whatsapp;
const graph = (path: string) => `https://graph.facebook.com/${config.whatsapp!.version}/${path}`;
const auth = () => ({ Authorization: `Bearer ${config.whatsapp!.token}` });

/** True when the body really came from Meta (HMAC-SHA256 of the raw body with the app secret). */
export function validSignature(raw: Buffer, header: string | undefined) {
  const secret = config.whatsapp?.appSecret;
  if (!secret || !header?.startsWith('sha256=')) return false;
  const want = Buffer.from(`sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`);
  const got = Buffer.from(header);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const STATUS_RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3 };

interface WaInbound {
  from: string; id: string; timestamp?: string; type: string;
  text?: { body: string }; image?: { id: string; mime_type?: string; caption?: string }; document?: { id: string; mime_type?: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type?: string }; video?: { id: string; mime_type?: string; caption?: string }; sticker?: { id: string; mime_type?: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
}

/** What we store for one incoming message: its kind, the text to show, and the media to fetch if any. */
export function describeInbound(m: WaInbound) {
  const media = m.image ?? m.document ?? m.audio ?? m.video ?? m.sticker;
  switch (m.type) {
    case 'text': return { kind: 'text', body: m.text?.body ?? '' };
    case 'image': return { kind: 'image', body: m.image?.caption ?? '', mediaId: m.image!.id, mime: m.image!.mime_type ?? 'image/jpeg' };
    case 'document': return { kind: 'document', body: m.document?.caption ?? '', mediaId: m.document!.id, mime: m.document!.mime_type ?? '', name: m.document!.filename ?? 'document' };
    case 'audio': case 'video': case 'sticker': return { kind: m.type, body: (m.video?.caption ?? ''), mediaId: media!.id, mime: media!.mime_type ?? '' };
    case 'location': return { kind: 'location', body: [m.location?.name, m.location?.address, `${m.location?.latitude},${m.location?.longitude}`].filter(Boolean).join(' · ') };
    case 'button': return { kind: 'text', body: m.button?.text ?? '' };
    case 'interactive': return { kind: 'text', body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '' };
    default: return { kind: 'other', body: `(${m.type} message: open WhatsApp on the phone to see it)` };
  }
}

const previewOf = (d: { kind: string; body: string }) => (d.body || ({ image: 'Photo', document: 'Document', audio: 'Voice message', video: 'Video', sticker: 'Sticker' } as Record<string, string>)[d.kind] || '').slice(0, 140);

/** The shop a sender belongs to: their number is the shop's phone, or their message names the shop ("Shop: …"). */
async function matchShop(waId: string, text: string): Promise<string | null> {
  const shops = await query<{ id: string; phone: string }>("SELECT id, phone FROM shops WHERE phone <> ''");
  const byPhone = shops.find((s) => waDigits(s.phone) === waId);
  if (byPhone) return byPhone.id;
  const named = /^Shop:\s*(.+)$/im.exec(text)?.[1]?.trim();
  if (named) {
    const [s] = await query<{ id: string }>('SELECT id FROM shops WHERE lower(name) = lower($1) ORDER BY created_at LIMIT 2', [named]);
    if (s) return s.id;
  }
  return null;
}

/** Applies one webhook call from Meta: new messages and the statuses of messages we sent. */
export async function handleWebhook(payload: any) {
  let received = 0;
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value ?? {};
      const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [String(c.wa_id), String(c.profile?.name ?? '')]));
      for (const m of (v.messages ?? []) as WaInbound[]) {
        const waId = waDigits(String(m.from)) || String(m.from).replace(/\D/g, '');
        if (!waId || !m.id) continue;
        const d = describeInbound(m);
        const at = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();
        const shopId = await matchShop(waId, d.body);
        const added = await tx(async (db) => {
          const conv = (await db.query(`INSERT INTO wa_conversations (wa_id, profile_name, shop_id, last_message_at) VALUES ($1, $2, $3, $4)
              ON CONFLICT (wa_id) DO UPDATE SET profile_name = CASE WHEN EXCLUDED.profile_name <> '' THEN EXCLUDED.profile_name ELSE wa_conversations.profile_name END,
                shop_id = coalesce(wa_conversations.shop_id, EXCLUDED.shop_id)
              RETURNING id`, [waId, names.get(String(m.from)) ?? '', shopId, at])).rows[0];
          const ins = await db.query(`INSERT INTO wa_messages (conversation_id, direction, wa_message_id, kind, body, media_id, media_mime, media_name, status, created_at)
              VALUES ($1, 'in', $2, $3, $4, $5, $6, $7, 'received', $8) ON CONFLICT (wa_message_id) DO NOTHING RETURNING id`,
          [conv.id, m.id, d.kind, d.body, (d as any).mediaId ?? '', (d as any).mime ?? '', (d as any).name ?? '', at]);
          if (!ins.rowCount) return false; // Meta sent this one before
          await db.query(`UPDATE wa_conversations SET unread = unread + 1, status = 'open', last_inbound_at = greatest(coalesce(last_inbound_at, $2), $2),
              last_message_at = greatest(last_message_at, $2), last_preview = $3 WHERE id = $1`, [conv.id, at, previewOf(d)]);
          return true;
        });
        if (added) received++;
      }
      for (const s of v.statuses ?? []) {
        const st = String(s.status);
        if (st === 'failed') {
          const err = (s.errors ?? []).map((e: any) => `${e.code ?? ''} ${e.title ?? ''}${e.error_data?.details ? `: ${e.error_data.details}` : ''}`.trim()).join('; ');
          await query("UPDATE wa_messages SET status = 'failed', error = $2 WHERE wa_message_id = $1", [s.id, err || 'Failed']);
        } else if (st in STATUS_RANK) {
          // Statuses can arrive out of order: only ever move forward (sent → delivered → read).
          await query(`UPDATE wa_messages SET status = $2 WHERE wa_message_id = $1 AND status <> 'failed'
              AND (CASE status WHEN 'sending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END) < $3`, [s.id, st, STATUS_RANK[st]]);
        }
      }
    }
  }
  await query('UPDATE platform_config SET wa_webhook_at = now() WHERE id = 1');
  return received;
}

export const windowOpen = (lastInbound: Date | string | null) => !!lastInbound && Date.now() - new Date(lastInbound).getTime() < WINDOW_HOURS * 3600_000;

async function post(feature: string, body: unknown) {
  if (!config.whatsapp) throw new HttpError(501, 'The WhatsApp Business API is not set up on the server.', 'not_configured');
  const r = await trackedFetch('whatsapp', feature, graph(`${config.whatsapp.phoneId}/messages`), {
    method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw new HttpError(502, `WhatsApp didn’t accept the message: ${j?.error?.message ?? `HTTP ${r.status}`}`, 'whatsapp_error');
  return String(j?.messages?.[0]?.id ?? '');
}

/** Sends a text reply (only inside the 24-hour window). Returns Meta's message id. */
export const sendText = (to: string, body: string) =>
  post('support_reply', { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body, preview_url: false } });

/** Sends the approved template (to reopen a conversation after 24 hours). */
export const sendTemplate = (to: string) =>
  post('support_template', { messaging_product: 'whatsapp', to, type: 'template', template: { name: config.whatsapp!.template, language: { code: config.whatsapp!.templateLang } } });

/** Shows blue ticks to the shop for their message (best effort). */
export async function markRead(waMessageId: string) {
  if (!config.whatsapp) return;
  await post('support_read', { messaging_product: 'whatsapp', status: 'read', message_id: waMessageId }).catch(() => undefined);
}

/** Downloads a photo or document the shop sent: Meta gives a short-lived URL that needs the token. */
export async function fetchMedia(mediaId: string) {
  if (!config.whatsapp) throw new HttpError(501, 'The WhatsApp Business API is not set up on the server.', 'not_configured');
  const meta = await trackedFetch('whatsapp', 'support_media', graph(mediaId), { headers: auth(), signal: AbortSignal.timeout(15_000) });
  if (!meta.ok) throw new HttpError(502, 'WhatsApp couldn’t find that file any more (files are kept by WhatsApp for a limited time).', 'whatsapp_error');
  const info = (await meta.json()) as { url: string; mime_type?: string; file_size?: number };
  // The download link must be Meta's own: the token is sent with it, so never to any other host.
  const host = (() => { try { return new URL(info.url).hostname; } catch { return ''; } })();
  if (!/(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net|fbcdn\.net)$/.test(host)) throw new HttpError(502, 'WhatsApp returned an unexpected file address.', 'whatsapp_error');
  if (info.file_size && info.file_size > 16 * 1024 * 1024) throw new HttpError(413, 'That file is too large to open here; ask the shop to send a smaller one.', 'too_large');
  const file = await trackedFetch('whatsapp', 'support_media', info.url, { headers: auth(), signal: AbortSignal.timeout(30_000) });
  if (!file.ok) throw new HttpError(502, 'Couldn’t download the file from WhatsApp.', 'whatsapp_error');
  return { mime: info.mime_type ?? file.headers.get('content-type') ?? 'application/octet-stream', data: Buffer.from(await file.arrayBuffer()) };
}
