/**
 * Razorpay client helpers.
 *
 * All requests go to relative `/api/payment/*` URLs:
 *   - dev:  Vite proxy forwards /api -> the Functions emulator (see vite.config.js)
 *   - prod: Firebase Hosting rewrites /api/** -> the `api` Cloud Function
 * Set VITE_API_BASE_URL only if you need to point at a different backend origin.
 */
import { auth } from "../context/FirebaseConfig";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/** JSON headers + the current user's Firebase ID token, so the server can
 *  authenticate the caller (and not trust a client-supplied userId). */
async function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  const user = auth.currentUser;
  if (user) {
    try {
      headers.Authorization = `Bearer ${await user.getIdToken()}`;
    } catch {
      /* sent without token → server 401s */
    }
  }
  return headers;
}

/**
 * Inject the Razorpay Checkout script; resolves true when ready.
 * If the first load fails (e.g. a corrupt browser disk cache →
 * ERR_CACHE_READ_FAILURE), it removes the dead tag and retries once with a
 * cache-busting query so a bad cache entry can't permanently break checkout.
 */
export function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);

    const inject = (src, isRetry) => {
      // Clear any prior (possibly failed) tag so the retry is clean.
      const prev = document.querySelector('script[data-razorpay="1"]');
      if (prev) prev.remove();

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.razorpay = "1";
      script.onload = () => resolve(true);
      script.onerror = () => {
        if (!isRetry)
          inject(`${CHECKOUT_SRC}?cb=${Date.now()}`, true); // bypass the cache
        else resolve(false);
      };
      document.body.appendChild(script);
    };

    inject(CHECKOUT_SRC, false);
  });
}

/**
 * Create a Razorpay order on the backend. The client sends only the cart's
 * { productId, quantity } pairs plus an optional promoCode string (the server
 * prices from the catalog and validates the code — never a client-supplied amount).
 * @param {{ items: Array<{productId:string, quantity:number}>, promoCode?: string }} params
 * @returns {Promise<{orderId:string, amount:number, currency:string, subtotal:number, shipping:number, promoDiscount:number, total:number, keyId:string}>}
 */
export async function createRazorpayOrder({ items, promoCode }) {
  const res = await fetch(`${API_BASE}/api/payment/create-order`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ items, promoCode: promoCode || "" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Could not start payment. Please try again.");
  }
  return data;
}

/**
 * Place a Cash-on-Delivery order on the backend. Like createRazorpayOrder, the
 * client sends only { productId, quantity } pairs + an optional promoCode; the
 * server prices from the catalog, validates the delivery address & stock, and
 * writes the order with paymentMethod:"COD", paymentStatus:"pending".
 * @param {{ items: Array<{productId:string, quantity:number}>, promoCode?: string }} params
 * @returns {Promise<{ success:boolean, orderId:string }>}
 */
export async function createCodOrder({ items, promoCode }) {
  const res = await fetch(`${API_BASE}/api/payment/cod-create`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ items, promoCode: promoCode || "" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(
      data.error || "Could not place your COD order. Please try again.",
    );
  }
  return data;
}

/**
 * Verify a completed payment's signature on the backend.
 * @param {{razorpay_order_id:string, razorpay_payment_id:string, razorpay_signature:string}} payload
 */
export async function verifyRazorpayPayment(payload) {
  const res = await fetch(`${API_BASE}/api/payment/verify`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.verified) {
    throw new Error(data.error || "Payment could not be verified.");
  }
  return data;
}
