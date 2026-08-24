// Razorpay integration — unchanged from functions/routes/payment.js, only
// the runtime moves (Cloud Function -> Edge Function). Same npm package,
// same HMAC-SHA256 signature scheme, same env var names. Keys are read from
// Edge Function secrets (`supabase secrets set`), never from client code.
import Razorpay from "npm:razorpay@2.9.4";

let _razorpay: Razorpay | null = null;

/** Lazily builds the Razorpay client (env isn't present at deploy-analysis time). */
export function getRazorpay(): Razorpay {
  if (_razorpay) return _razorpay;
  const key_id = Deno.env.get("RAZORPAY_KEY_ID");
  const key_secret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!key_id || !key_secret) {
    throw new Error("Missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET env vars");
  }
  _razorpay = new Razorpay({ key_id, key_secret });
  return _razorpay;
}

/** HMAC-SHA256 over `data` with `secret`, hex-encoded — same algorithm as crypto.createHmac. */
async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison — Deno has no built-in crypto.timingSafeEqual. */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

/** Verifies a /verify payload's signature: HMAC(order_id|payment_id) with the key secret. */
export async function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): Promise<boolean> {
  const secret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
  const expected = await hmacHex(secret, `${orderId}|${paymentId}`);
  return timingSafeEqual(expected, String(signature));
}

/** Verifies a webhook payload's signature: HMAC(raw body) with the webhook secret. */
export async function verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";
  if (!secret) return false;
  const expected = await hmacHex(secret, rawBody);
  return timingSafeEqual(expected, String(signature));
}