import { auth } from "../context/FirebaseConfig";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

/**
 * Submit a product review via the server, which verifies the user actually
 * purchased the product (client-side review writes are blocked by rules).
 * @param {{ productId:string, productTitle?:string, rating:number, comment?:string }} payload
 * @returns {Promise<{ reviewId:string }>}
 */
export async function submitReview({
  productId,
  productTitle,
  rating,
  comment,
}) {
  const headers = { "Content-Type": "application/json" };
  const user = auth.currentUser;
  if (user) {
    try {
      headers.Authorization = `Bearer ${await user.getIdToken()}`;
    } catch {
      /* server will 401 */
    }
  }
  const res = await fetch(`${API_BASE}/api/reviews/create`, {
    method: "POST",
    headers,
    body: JSON.stringify({ productId, productTitle, rating, comment }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Could not submit review.");
  }
  return data;
}
