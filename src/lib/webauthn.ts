/**
 * The phone's or laptop's own fingerprint / face unlock for attendance (WebAuthn). The device keeps the key and
 * only uses it after the person unlocks it; we send the server the public key once, then a signature per check-in.
 */
import { IS_APP } from './platform';

const toB64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** True when this device can check the person with its own fingerprint / face / screen lock. */
export async function biometricSupported(): Promise<boolean> {
  // The phone app's web view can't use WebAuthn; there a selfie is used instead and the owner sees it.
  if (IS_APP || typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

const friendly = (e: unknown) => {
  const n = (e as DOMException)?.name;
  if (n === 'NotAllowedError') return new Error('The fingerprint check was cancelled or timed out. Please try again.');
  if (n === 'InvalidStateError') return new Error('This device is already set up.');
  if (n === 'SecurityError') return new Error('Fingerprint needs the secure (https) address of the app.');
  return new Error((e as Error)?.message || 'The fingerprint check didn’t work on this device.');
};

/** Makes a new device key; returns what the server checks and stores. */
export async function createDeviceKey(o: { challenge: string; token: string; user: { id: string; name: string; displayName: string }; exclude: string[] }) {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge: fromB64(o.challenge), rp: { name: 'Corpus360', id: location.hostname },
        user: { id: fromB64(o.user.id), name: o.user.name, displayName: o.user.displayName },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }, { type: 'public-key', alg: -8 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        excludeCredentials: o.exclude.map((id) => ({ type: 'public-key' as const, id: fromB64(id) })),
        attestation: 'none', timeout: 60_000,
      },
    })) as PublicKeyCredential;
  } catch (e) { throw friendly(e); }
  const r = cred.response as AuthenticatorAttestationResponse;
  const pk = r.getPublicKey?.();
  if (!pk) throw new Error('This browser is too old for fingerprint check-in. Update it and try again.');
  return {
    token: o.token, credentialId: toB64(cred.rawId), clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.getAuthenticatorData()),
    publicKey: toB64(pk), algorithm: r.getPublicKeyAlgorithm(),
  };
}

/** Signs a check-in challenge with this device's key (asks for the fingerprint / face). */
export async function signWithDevice(o: { challenge: string; token: string; allow: string[] }) {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: fromB64(o.challenge), rpId: location.hostname, userVerification: 'required', timeout: 60_000,
        allowCredentials: o.allow.map((id) => ({ type: 'public-key' as const, id: fromB64(id), transports: ['internal' as AuthenticatorTransport] })),
      },
    })) as PublicKeyCredential;
  } catch (e) { throw friendly(e); }
  const r = cred.response as AuthenticatorAssertionResponse;
  return { token: o.token, credentialId: toB64(cred.rawId), clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature) };
}

/** A short name for this device, for the owner's list ("Chrome on Android"). */
export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'this device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  return `${br} on ${os}`;
}
