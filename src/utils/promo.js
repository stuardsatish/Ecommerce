/**
 * Promo-code helper. The promoCodes collection is no longer client-readable
 * (Firestore rules), so we validate through the server, which returns only the
 * resolved discount for this code + subtotal. The authoritative discount is
 * still recomputed in /payment/create-order at checkout.
 */
import { auth } from "../context/FirebaseConfig";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

/**
 * @param {string} code
 * @param {number} subtotal
 * @returns {Promise<{ code:string, type:"percent"|"flat", value:number, discount:number }>}
 * @throws {Error} with a user-friendly message on invalid/expired/failed codes
 */
export async function validatePromoCode(code, subtotal) {
  const headers = { "Content-Type": "application/json" };
  const user = auth.currentUser;
  if (user) {
    try {
      headers.Authorization = `Bearer ${await user.getIdToken()}`;
    } catch {
      /* server 401s */
    }
  }
  const res = await fetch(`${API_BASE}/api/promo/validate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ code, subtotal }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Could not validate promo code.");
  }
  return data;
}
