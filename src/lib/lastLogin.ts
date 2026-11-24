/**
 * The last email used to sign in on this device, so after signing out (or a session ending) the login page already
 * has it and only the password is needed. Only the email and first name are kept, never the password.
 */
const KEY = 'c360.lastLogin';
export interface LastLogin { email: string; name: string }
export function lastLogin(): LastLogin | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LastLogin | null; return v?.email ? v : null; } catch { return null; }
}
export function rememberLogin(email: string, name: string) {
  try { localStorage.setItem(KEY, JSON.stringify({ email: email.trim().toLowerCase(), name: name.trim().split(/\s+/)[0] ?? '' })); } catch { /* private mode */ }
}
export function forgetLogin() { try { localStorage.removeItem(KEY); } catch { /* */ } }
