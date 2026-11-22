import { Router } from 'express';
import { z } from 'zod';
import { rateLimit, type UserCtx } from '../../auth';
import { audit } from '../../audit';
import { many, one, type Db } from '../../db';
import { badRequest, conflict, forbidden, notFound, parse } from '../../http';
import { entitlementsOf } from '../../services/features';
import { newChallenge, verifyAssertion, verifyRegistration } from '../../services/webauthn';
import { istDate } from '../../../../shared/support';
import { attendanceSummary, type Mark } from '../../../../shared/attendance';
import { km } from './field';
import { T, allowed } from './ctx';

/*
 * Staff attendance (add-on). Each person checks in and out from their own phone or laptop. What a check-in must
 * carry depends on the shop's level: location always; a selfie from "Selfie + location" up; and at the
 * "Fingerprint / face unlock" level, a signature from a device key the person set up (services/webauthn.ts).
 * People with attendance.manage see everyone, mark by hand (recorded as such) and set each branch's location.
 */
export const attendanceRouter = Router();

const today = () => istDate(new Date());
const canManage = (c: UserCtx) => allowed(c, 'attendance.manage');
const level = async (req: any) => (await entitlementsOf(req)).attendance ?? 'manual';
const needs = (lvl: string) => ({ selfie: lvl === 'face' || lvl === 'biometric', biometric: lvl === 'biometric' });

const markOut = (m: any) => ({
  id: m.id, userId: m.user_id, userName: m.user_name, kind: m.kind, day: typeof m.day === 'string' ? m.day : istDate(m.day), at: m.at,
  lat: m.lat, lng: m.lng, accuracy: m.accuracy_m, distanceM: m.distance_m === null ? null : Math.round(m.distance_m), outside: m.outside,
  hasSelfie: !!m.has_selfie, method: m.method, manual: !!m.marked_by, note: m.note, deviceLabel: m.device_label ?? null,
});
const MARK_SQL = `SELECT m.id, m.user_id, m.user_name, m.kind, to_char(m.day, 'YYYY-MM-DD') AS day, m.at, m.lat, m.lng, m.accuracy_m, m.distance_m, m.outside,
    m.selfie IS NOT NULL AS has_selfie, m.method, m.marked_by, m.note, d.label AS device_label
  FROM attendance_marks m LEFT JOIN attendance_devices d ON d.id = m.device_id`;

/** The branch a person works at (their own, else the main one) with its location, when set. */
async function homeBranch(db: Db, shopId: string, userId: string) {
  return one(db, `SELECT b.id, b.name, b.geo_lat, b.geo_lng, b.geo_radius_m FROM branches b
      WHERE b.shop_id = $1 AND b.id = coalesce((SELECT branch_id FROM users WHERE id = $2), (SELECT id FROM branches WHERE shop_id = $1 AND is_primary LIMIT 1))`, [shopId, userId]);
}
const myMarks = (db: Db, c: UserCtx, day: string) => many(db, `${MARK_SQL} WHERE m.shop_id = $1 AND m.user_id = $2 AND m.day = $3 ORDER BY m.at`, [c.shopId, c.id, day]);
const devicesOf = (db: Db, shopId: string, userId: string) =>
  many(db, 'SELECT id, credential_id, label, created_at, last_used_at FROM attendance_devices WHERE shop_id = $1 AND user_id = $2 AND removed_at IS NULL ORDER BY created_at', [shopId, userId]);

/** My attendance today: am I in, my marks, what a check-in needs, and my devices. */
attendanceRouter.get('/attendance/me', T(async (db, req, c) => {
  const lvl = await level(req);
  const marks = (await myMarks(db, c, today())).map(markOut);
  const b = await homeBranch(db, c.shopId, c.id);
  return {
    level: lvl, needs: needs(lvl), canManage: canManage(c), day: today(),
    state: marks.length && marks[marks.length - 1]!.kind === 'in' ? 'in' : 'out', marks,
    branch: b && { id: b.id, name: b.name, located: b.geo_lat !== null, radiusM: b.geo_radius_m },
    devices: (await devicesOf(db, c.shopId, c.id)).map((d) => ({ id: d.id, credentialId: d.credential_id, label: d.label, createdAt: d.created_at, lastUsedAt: d.last_used_at })),
  };
}));

/* ---------- Device fingerprint / face unlock (WebAuthn) ---------- */

attendanceRouter.post('/attendance/devices/options', T(async (db, _req, c) => {
  const { challenge, token } = newChallenge(c.id, 'register');
  const existing = await devicesOf(db, c.shopId, c.id);
  return { challenge, token, user: { id: Buffer.from(c.id).toString('base64url'), name: c.email, displayName: c.name }, exclude: existing.map((d) => d.credential_id) };
}));

attendanceRouter.post('/attendance/devices', rateLimit('att-device', 10, 60 * 60_000), T(async (db, req, c) => {
  const b = parse(z.object({
    token: z.string().max(500), credentialId: z.string().max(1400), clientDataJSON: z.string().max(4000), authenticatorData: z.string().max(4000),
    publicKey: z.string().max(2000), algorithm: z.number().int(), label: z.string().trim().max(60).default(''),
  }), req.body);
  const reg = verifyRegistration(c.id, b);
  if (await one(db, 'SELECT 1 FROM attendance_devices WHERE shop_id = $1 AND credential_id = $2', [c.shopId, reg.credentialId])) throw conflict('This device is already set up.');
  const n = (await devicesOf(db, c.shopId, c.id)).length;
  if (n >= 5) throw badRequest('You already have 5 devices set up. Remove one first.');
  const row = await one(db, `INSERT INTO attendance_devices (shop_id, user_id, credential_id, public_key, algorithm, sign_count, label)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [c.shopId, c.id, reg.credentialId, reg.publicKey, reg.algorithm, reg.signCount, b.label || 'This device']);
  await audit(db, req, c.shopId, 'create', 'attendance_device', row!.id, { label: b.label });
  return { id: row!.id };
}));

attendanceRouter.delete('/attendance/devices/:id', T(async (db, req, c) => {
  const d = await one(db, 'SELECT id, user_id FROM attendance_devices WHERE shop_id = $1 AND id = $2 AND removed_at IS NULL', [c.shopId, req.params.id]);
  if (!d) throw notFound('Device');
  if (d.user_id !== c.id && !canManage(c)) throw forbidden('This is someone else’s device');
  await db.query('UPDATE attendance_devices SET removed_at = now() WHERE id = $1', [d.id]);
  await audit(db, req, c.shopId, 'delete', 'attendance_device', d.id, {});
  return { ok: true };
}));

/* ---------- Check in / out ---------- */

/** A challenge for the next check-in, with the device keys that may sign it. */
attendanceRouter.post('/attendance/challenge', T(async (db, _req, c) => {
  const { challenge, token } = newChallenge(c.id, 'mark');
  return { challenge, token, allow: (await devicesOf(db, c.shopId, c.id)).map((d) => d.credential_id) };
}));

const selfieBytes = (s: string) => {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(s);
  if (!m) throw badRequest('The selfie must be a JPEG photo.');
  const buf = Buffer.from(m[1]!, 'base64');
  if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw badRequest('The selfie didn’t come through. Please take it again.');
  if (buf.length > 200_000) throw badRequest('The selfie is too large.');
  return buf;
};

attendanceRouter.post('/attendance/mark', rateLimit('att-mark', 30, 60 * 60_000), T(async (db, req, c) => {
  const b = parse(z.object({
    kind: z.enum(['in', 'out']),
    lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000).default(0),
    selfie: z.string().max(300_000).optional(),
    assertion: z.object({ token: z.string().max(500), credentialId: z.string().max(1400), clientDataJSON: z.string().max(4000), authenticatorData: z.string().max(4000), signature: z.string().max(2000) }).optional(),
    /** The device can't do fingerprint / face unlock (for example the phone app); the mark is flagged for the owner. */
    noBiometric: z.enum(['unsupported']).optional(),
    note: z.string().trim().max(300).default(''),
  }), req.body);
  const lvl = await level(req);
  const need = needs(lvl);
  const marks = await myMarks(db, c, today());
  const state = marks.length && marks[marks.length - 1]!.kind === 'in' ? 'in' : 'out';
  if (b.kind === 'in' && state === 'in') throw conflict('You are already checked in. Check out first.');
  if (b.kind === 'out' && state === 'out') throw conflict('You haven’t checked in today.');
  const selfie = b.selfie ? selfieBytes(b.selfie) : null;
  if (need.selfie && !selfie) throw badRequest('Take a selfie to check in.');

  let method: 'biometric' | 'selfie' | 'location' = selfie ? 'selfie' : 'location';
  let deviceId: string | null = null;
  let note = b.note;
  if (need.biometric) {
    if (b.assertion) {
      const dev = await one(db, 'SELECT * FROM attendance_devices WHERE shop_id = $1 AND user_id = $2 AND credential_id = $3 AND removed_at IS NULL', [c.shopId, c.id, b.assertion.credentialId]);
      if (!dev) throw badRequest('This device isn’t set up for your fingerprint. Set it up first.');
      const count = verifyAssertion(c.id, b.assertion, dev);
      await db.query('UPDATE attendance_devices SET sign_count = $2, last_used_at = now() WHERE id = $1', [dev.id, count]);
      method = 'biometric'; deviceId = dev.id;
    } else if (b.noBiometric === 'unsupported') {
      note = ['No fingerprint: this device can’t do it', note].filter(Boolean).join(' · ');
    } else {
      throw badRequest('Confirm with your fingerprint or face unlock to check in.');
    }
  }

  const br = await homeBranch(db, c.shopId, c.id);
  let distance: number | null = null; let outside = false;
  if (br && br.geo_lat !== null) {
    distance = km({ lat: b.lat, lng: b.lng }, { lat: br.geo_lat, lng: br.geo_lng }) * 1000;
    outside = distance > br.geo_radius_m + Math.min(b.accuracy, 100);
  }
  const row = await one(db, `INSERT INTO attendance_marks (shop_id, user_id, user_name, branch_id, kind, day, lat, lng, accuracy_m, distance_m, outside, selfie, method, device_id, note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
  [c.shopId, c.id, c.name, br?.id ?? null, b.kind, today(), b.lat, b.lng, b.accuracy, distance, outside, selfie, method, deviceId, note]);
  await audit(db, req, c.shopId, 'create', 'attendance_mark', row!.id, { kind: b.kind, method, outside });
  return markOut((await one(db, `${MARK_SQL} WHERE m.id = $1`, [row!.id]))!);
}));

/** A mark's selfie: its owner, or someone who manages attendance. */
attendanceRouter.get('/attendance/marks/:id/selfie', T(async (db, req, c, res) => {
  const m = await one(db, 'SELECT user_id, selfie FROM attendance_marks WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id]);
  if (!m?.selfie) throw notFound('Selfie');
  if (m.user_id !== c.id && !canManage(c)) throw forbidden('This is someone else’s selfie');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(m.selfie);
  return undefined;
}));

/* ---------- The register (attendance.manage) ---------- */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const staff = (db: Db, shopId: string) => many(db, "SELECT id, name, role, active FROM users WHERE shop_id = $1 ORDER BY active DESC, name", [shopId]);

/** Everyone's marks for a range of days, summarised per person and day (hours from paired in/out). */
async function register(db: Db, shopId: string, from: string, to: string) {
  const marks = (await many(db, `${MARK_SQL} WHERE m.shop_id = $1 AND m.day BETWEEN $2 AND $3 ORDER BY m.at`, [shopId, from, to])).map(markOut);
  const people = await staff(db, shopId);
  return { people: people.filter((p) => p.active || marks.some((m) => m.userId === p.id)).map((p) => ({ id: p.id, name: p.name, role: p.role, active: p.active })), marks };
}

attendanceRouter.get('/attendance/day', T(async (db, req, c) => {
  if (!canManage(c)) throw forbidden('Your role can’t see everyone’s attendance');
  const day = ISO.test(String(req.query.date)) ? String(req.query.date) : today();
  const r = await register(db, c.shopId, day, day);
  const sum = attendanceSummary(r.marks as Mark[], day, day, new Date());
  return { day, people: r.people.map((p) => ({ ...p, ...(sum[p.id]?.days[day] ?? { status: 'absent', firstIn: null, lastOut: null, minutes: 0, open: false }), marks: r.marks.filter((m) => m.userId === p.id) })) };
}));

attendanceRouter.get('/attendance/month', T(async (db, req, c) => {
  if (!canManage(c)) throw forbidden('Your role can’t see everyone’s attendance');
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : today().slice(0, 7);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = `${month}-01`; const to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const r = await register(db, c.shopId, from, to);
  const sum = attendanceSummary(r.marks as Mark[], from, to, new Date());
  return { month, from, to, people: r.people.map((p) => ({ ...p, ...(sum[p.id] ?? { daysPresent: 0, minutes: 0, days: {}, outsideMarks: 0, noBiometricMarks: 0, manualMarks: 0 }) })) };
}));

/** The owner or a manager marks someone in or out by hand (forgot the phone, phone broken): kept as a manual mark. */
attendanceRouter.post('/attendance/manual', T(async (db, req, c) => {
  if (!canManage(c)) throw forbidden('Your role can’t mark attendance for others');
  const b = parse(z.object({ userId: z.string().uuid(), kind: z.enum(['in', 'out']), at: z.string().datetime({ offset: true }), note: z.string().trim().min(3, 'Say why it was marked by hand').max(300) }), req.body);
  const u = await one(db, 'SELECT id, name, branch_id FROM users WHERE shop_id = $1 AND id = $2', [c.shopId, b.userId]);
  if (!u) throw notFound('Staff member');
  const at = new Date(b.at);
  if (at.getTime() > Date.now() + 5 * 60_000) throw badRequest('That time is in the future.');
  const day = istDate(at);
  const prev = await one(db, 'SELECT kind FROM attendance_marks WHERE shop_id = $1 AND user_id = $2 AND day = $3 AND at <= $4 ORDER BY at DESC LIMIT 1', [c.shopId, u.id, day, at]);
  if (b.kind === 'in' && prev?.kind === 'in') throw conflict(`${u.name} is already checked in at that time.`);
  if (b.kind === 'out' && prev?.kind !== 'in') throw conflict(`${u.name} wasn’t checked in at that time.`);
  const br = await homeBranch(db, c.shopId, u.id);
  const row = await one(db, `INSERT INTO attendance_marks (shop_id, user_id, user_name, branch_id, kind, day, at, method, marked_by, note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9) RETURNING id`, [c.shopId, u.id, u.name, br?.id ?? null, b.kind, day, at, c.id, `${b.note} (marked by ${c.name})`]);
  await audit(db, req, c.shopId, 'create', 'attendance_mark', row!.id, { kind: b.kind, manual: true, for: u.name });
  return markOut((await one(db, `${MARK_SQL} WHERE m.id = $1`, [row!.id]))!);
}));

/** Branch locations: check-ins further than the radius are flagged "outside". */
attendanceRouter.get('/attendance/branches', T(async (db, _req, c) => {
  if (!canManage(c)) throw forbidden('Your role can’t change attendance settings');
  return (await many(db, 'SELECT id, name, is_primary, geo_lat, geo_lng, geo_radius_m FROM branches WHERE shop_id = $1 ORDER BY is_primary DESC, name', [c.shopId]))
    .map((b) => ({ id: b.id, name: b.name, primary: b.is_primary, lat: b.geo_lat, lng: b.geo_lng, radiusM: b.geo_radius_m }));
}));

attendanceRouter.put('/attendance/branches/:id', T(async (db, req, c) => {
  if (!canManage(c)) throw forbidden('Your role can’t change attendance settings');
  const b = parse(z.object({ lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable(), radiusM: z.number().int().min(20).max(5000) }), req.body);
  if ((b.lat === null) !== (b.lng === null)) throw badRequest('Give both latitude and longitude, or neither.');
  const r = await db.query('UPDATE branches SET geo_lat = $3, geo_lng = $4, geo_radius_m = $5 WHERE shop_id = $1 AND id = $2', [c.shopId, req.params.id, b.lat, b.lng, b.radiusM]);
  if (!r.rowCount) throw notFound('Branch');
  await audit(db, req, c.shopId, 'update', 'branch_location', req.params.id, b);
  return { ok: true };
}));

