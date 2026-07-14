/**
 * Review routes — server-enforced "must have purchased to review".
 *
 *   POST /reviews/create  Body: { productId, productTitle, rating, comment }
 *
 * The caller is identified by their Firebase ID token. The server confirms the
 * user actually has an order containing the product before writing the review
 * (Admin SDK). Firestore rules block client-side review creation.
 */
const express = require("express");
const admin = require("firebase-admin");
const { requireAuth, rateLimit } = require("../lib/util");

const router = express.Router();
const db = () => admin.firestore();

router.post("/create", async (req, res) => {
  try {
    const decoded = await requireAuth(req, res);
    if (!decoded) return;
    const userId = decoded.uid;

    if (!(await rateLimit(`review:${userId}`, 10, 60000))) {
      return res.status(429).json({ success: false, error: "Too many requests. Please wait a moment." });
    }

    const { productId, productTitle, rating, comment } = req.body || {};
    const pid = String(productId || "");
    const r = Math.round(Number(rating));
    const text = String(comment || "").slice(0, 2000);
    if (!pid) return res.status(400).json({ success: false, error: "Missing product" });
    if (!Number.isFinite(r) || r < 1 || r > 5) return res.status(400).json({ success: false, error: "Rating must be between 1 and 5" });

    // Purchase check: any of this user's orders must contain the product.
    const ordersSnap = await db().collection("orders").where("userId", "==", userId).get();
    const purchased = ordersSnap.docs.some((d) => {
      const products = d.data().products;
      return Array.isArray(products) && products.some((p) => String(p.productId) === pid);
    });
    if (!purchased) {
      return res.status(403).json({ success: false, error: "You can only review products you've purchased." });
    }

    // One review per user per product (deterministic id prevents duplicates/spam).
    const userSnap = await db().collection("users").doc(userId).get();
    const userName = userSnap.exists ? (userSnap.data().name || "User") : "User";
    const reviewId = `${userId}_${pid}`;

    await db().collection("reviews").doc(reviewId).set({
      reviewId,
      productId: pid,
      productTitle: String(productTitle || "").slice(0, 200),
      userId,
      userName,
      rating: r,
      comment: text,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, reviewId });
  } catch (err) {
    console.error("[reviews] create failed:", err);
    return res.status(500).json({ success: false, error: "Could not submit review" });
  }
});

module.exports = router;