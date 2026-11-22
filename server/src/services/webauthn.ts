/**
 * Device biometrics for attendance, through WebAuthn (passkeys): the phone's or laptop's own fingerprint or face
 * unlock. Nothing biometric reaches us: the device keeps a private key that only opens after the person unlocks it,
 * and signs a fresh challenge with it. We keep the public key and check each signature, the challenge (so an old
 * check-in can't be replayed), the site it was made for, and that the person was verified on the device.
 *
 * Only the parts we need are implemented, with Node's crypto: "none" attestation (we don't need to know the device
 * model), ES256 / RS256 / EdDSA keys taken from the browser's getPublicKey() (SubjectPublicKeyInfo).
 */
import crypto from 'node:crypto';
import { config } from '../config';
import { badRequest } from '../http';

const SECRET = process.env.WEBAUTHN_SECRET || crypto.randomBytes(32).toString('hex');
const sign = (body: string) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
const b64 = (b: Buffer) => b.toString('base64url');
export const fromB64 = (s: string) => Buffer.from(s, 'base64url');
const CHALLENGE_MS = 5 * 60_000;

export type Purpose = 'register' | 'mark';

/** A fresh challenge for one user and purpose, with a signed token that proves we issued it (valid 5 minutes). */
export function newChallenge(userId: string, purpose: Purpose) {
  const challenge = b64(crypto.randomBytes(32));
  const body = `${userId}.${purpose}.${challenge}.${Date.now() + CHALLENGE_MS}`;
  return { challenge, token: `${Buffer.from(body).toString('base64url')}.${sign(body)}` };
}

/** Challenges already answered (until they expire): each one can be used once, so a check-in can't be replayed. */
const used = new Map<string, number>();
const spend = (challenge: string, exp: number) => {
  const now = Date.now();
  for (const [k, t] of used) if (t < now) used.delete(k);
  if (used.has(challenge)) throw badRequest('This fingerprint check was already used. Please try again.');
  used.set(challenge, exp);
};

function checkToken(token: string, userId: string, purpose: Purpose): string {
  const [enc, sig] = String(token).split('.');
  if (!enc || !sig) throw badRequest('The fingerprint check expired. Please try again.');
  const body = Buffer.from(enc, 'base64url').toString();
  const want = Buffer.from(sign(body)); const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw badRequest('The fingerprint check expired. Please try again.');
  const [uid, p, challenge, exp] = body.split('.');
  if (uid !== userId || p !== purpose || Number(exp) < Date.now()) throw badRequest('The fingerprint check expired. Please try again.');
  return challenge!;
}
/** Marks the challenge used once everything about the response checked out. */
function spendToken(token: string) {
  const body = Buffer.from(String(token).split('.')[0]!, 'base64url').toString();
  const [, , challenge, exp] = body.split('.');
  spend(challenge!, Number(exp));
}

/** The site origins a device may sign for: the web app's own addresses. */
const allowedOrigin = (o: string) => config.allowedOrigins.includes(o);

interface ClientData { type: string; challenge: string; origin: string }
function checkClientData(raw: Buffer, type: string, challenge: string): ClientData {
  let cd: ClientData;
  try { cd = JSON.parse(raw.toString('utf8')); } catch { throw badRequest('The device sent an unreadable response.'); }
  if (cd.type !== type) throw badRequest('The device sent the wrong kind of response.');
  if (cd.challenge !== challenge) throw badRequest('The fingerprint check didn’t match. Please try again.');
  if (!allowedOrigin(cd.origin)) throw badRequest('This fingerprint check was made for another website.');
  return cd;
}

/** Authenticator data: the site's hash, flags (user present / verified) and the signature counter. */
function checkAuthData(ad: Buffer, origin: string) {
  if (ad.length < 37) throw badRequest('The device sent an unreadable response.');
  const rpId = new URL(origin).hostname;
  if (!crypto.timingSafeEqual(ad.subarray(0, 32), crypto.createHash('sha256').update(rpId).digest())) throw badRequest('This fingerprint check was made for another website.');
  const flags = ad[32]!;
  if (!(flags & 0x01)) throw badRequest('The device didn’t confirm a person was there.');
  if (!(flags & 0x04)) throw badRequest('The device didn’t check the fingerprint or face. Turn on screen lock with fingerprint or face unlock.');
  return { signCount: ad.readUInt32BE(33) };
}

export interface Registration { token: string; credentialId: string; clientDataJSON: string; authenticatorData: string; publicKey: string; algorithm: number }

/** Checks a new device key made with navigator.credentials.create(); returns what to store. */
export function verifyRegistration(userId: string, r: Registration) {
  const challenge = checkToken(r.token, userId, 'register');
  const cd = checkClientData(fromB64(r.clientDataJSON), 'webauthn.create', challenge);
  const { signCount } = checkAuthData(fromB64(r.authenticatorData), cd.origin);
  if (![-7, -257, -8].includes(r.algorithm)) throw badRequest('This device uses a key type we don’t support.');
  const spki = fromB64(r.publicKey);
  try { crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }); } catch { throw badRequest('The device sent an unreadable key.'); }
  if (!/^[A-Za-z0-9_-]{16,1400}$/.test(r.credentialId)) throw badRequest('The device sent an unreadable key.');
  spendToken(r.token);
  return { credentialId: r.credentialId, publicKey: spki, algorithm: r.algorithm, signCount };
}

export interface Assertion { token: string; credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string }

/** Checks a check-in signed with navigator.credentials.get() by a stored device key. Returns the new counter. */
export function verifyAssertion(userId: string, a: Assertion, device: { public_key: Buffer; algorithm: number; sign_count: number | string }) {
  const challenge = checkToken(a.token, userId, 'mark');
  const clientData = fromB64(a.clientDataJSON);
  const cd = checkClientData(clientData, 'webauthn.get', challenge);
  const ad = fromB64(a.authenticatorData);
  const { signCount } = checkAuthData(ad, cd.origin);
  const data = Buffer.concat([ad, crypto.createHash('sha256').update(clientData).digest()]);
  const key = crypto.createPublicKey({ key: device.public_key, format: 'der', type: 'spki' });
  const sig = fromB64(a.signature);
  const ok = device.algorithm === -8 ? crypto.verify(null, data, key, sig)
    : device.algorithm === -7 ? crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, sig)
    : crypto.verify('sha256', data, key, sig);
  if (!ok) throw badRequest('The fingerprint check didn’t verify. Please try again.');
  // A counter that goes backwards means the key was copied; devices that don't count send 0 every time.
  const prev = Number(device.sign_count);
  if (signCount !== 0 || prev !== 0) if (signCount <= prev) throw badRequest('This device’s key looks copied. Remove it and set up fingerprint again.');
  spendToken(a.token);
  return signCount;
}
