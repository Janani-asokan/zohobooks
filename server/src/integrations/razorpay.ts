import crypto from 'node:crypto';
import { config } from '../config';
import { HttpError } from '../http';

export const razorpayEnabled = () => !!config.razorpay;

/** Creates a Razorpay order (amount in rupees → paise). https://razorpay.com/docs/api/orders/create/ */
export async function createOrder(amountRupees: number, receipt: string, notes: Record<string, string>) {
  const rz = config.razorpay;
  if (!rz) throw new HttpError(501, 'Online payments are not configured. Contact your service provider.', 'not_configured');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${rz.keyId}:${rz.keySecret}`).toString('base64') },
    body: JSON.stringify({ amount: Math.round(amountRupees * 100), currency: 'INR', receipt, notes }),
  });
  if (!res.ok) throw new HttpError(502, 'Could not start the payment. Please try again.', 'gateway_error');
  const order = (await res.json()) as { id: string; amount: number };
  return { orderId: order.id, amount: order.amount, keyId: rz.keyId };
}

/** Checkout signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifySignature(orderId: string, paymentId: string, signature: string, secret = config.razorpay?.keySecret ?? '') {
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
