/**
 * Sign in with Google: the browser gets a signed ID token from Google Identity Services; the server checks the
 * signature against Google's published keys, that it was made for our OAuth client ID, is from Google, isn't expired
 * and that Google has verified the email. Nothing secret is stored: the client ID is public.
 */
import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';
import { query } from '../db';
import { HttpError } from '../http';
import { trackedFetch } from './outbound';

export interface GoogleAuthSettings { clientId: string; enabled: boolean }

export async function googleSettings(): Promise<GoogleAuthSettings | null> {
  const [r] = await query<{ google_auth: GoogleAuthSettings | null }>('SELECT google_auth FROM platform_config WHERE id = 1');
  return r?.google_auth?.clientId ? r.google_auth : null;
}

let keys: { at: number; until: number; byKid: Map<string, JsonWebKey> } | null = null;
async function googleKey(kid: string): Promise<JsonWebKey | undefined> {
  // Refetch when the cache has expired, or (at most once a minute) when Google has rotated to a key we haven't seen.
  if (!keys || keys.until < Date.now() || (!keys.byKid.has(kid) && keys.at < Date.now() - 60_000)) {
    const res = await trackedFetch('google_signin', 'google_keys', 'https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new HttpError(502, 'Couldn’t reach Google to check the sign-in. Try again, or use your email.', 'google_unreachable');
    const j = await res.json() as { keys: Array<JsonWebKey & { kid: string }> };
    const age = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    keys = { at: Date.now(), until: Date.now() + Math.min(age, 6 * 3600) * 1000, byKid: new Map(j.keys.map((k) => [k.kid, k])) };
  }
  return keys.byKid.get(kid);
}

export interface GoogleUser { email: string; name: string; sub: string }

const BAD = () => new HttpError(401, 'Google sign-in didn’t work. Try again, or use your email.', 'google_invalid');

/** The person Google says this is, or throws. */
export async function verifyGoogleCredential(credential: string, clientId: string): Promise<GoogleUser> {
  const parts = credential.split('.');
  if (parts.length !== 3) throw BAD();
  const [h, p, sig] = parts as [string, string, string];
  let head: { alg?: string; kid?: string }; let claims: Record<string, unknown>;
  try { head = JSON.parse(Buffer.from(h, 'base64url').toString()); claims = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { throw BAD(); }
  if (head.alg !== 'RS256' || !head.kid) throw BAD();
  const jwk = await googleKey(head.kid);
  if (!jwk) throw BAD();
  const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(createPublicKey({ key: jwk, format: 'jwk' }), sig, 'base64url');
  if (!ok) throw BAD();
  const now = Math.floor(Date.now() / 1000);
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(String(claims.iss))) throw BAD();
  if (claims.aud !== clientId) throw BAD();
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new HttpError(401, 'The Google sign-in expired. Try again.', 'google_invalid');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new HttpError(401, 'Google hasn’t verified this email address. Use another account, or sign in with your email.', 'google_unverified');
  const email = String(claims.email ?? '').toLowerCase();
  if (!email) throw BAD();
  return { email, name: String(claims.name ?? ''), sub: String(claims.sub ?? '') };
}

/** Tests replace Google's keys. */
export const setGoogleKeysForTest = (byKid: Map<string, JsonWebKey>) => { keys = { at: Date.now(), until: Date.now() + 3600_000, byKid }; };
