/** Rules for the sign-up email code, shared by the server and the sign-up screen. */
export const SIGNUP_CODE = {
  digits: 6,
  /** A code works this long after it is sent. */
  ttlMinutes: 15,
  /** Wrong tries before the code stops working (a new one must be sent). */
  maxAttempts: 3,
  /** Wait between sends. */
  resendSeconds: 60,
  /** Codes to one email address in 24 hours. */
  perDay: 6,
} as const;

export const isSignupCode = (v: string) => new RegExp(`^\\d{${SIGNUP_CODE.digits}}$`).test(v.trim());
