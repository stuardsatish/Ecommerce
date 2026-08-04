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
const { requireAuth, rateLimit, isFeatureKilled, isUserBlocked } = require("../lib/util");

const router = express.Router();
const db = () => admin.firestore();

router.post("/create", async (req, res) => {
  try {
    const decoded = await requireAuth(req, res);
    if (!decoded) return;
    const userId = decoded.uid;

    if (await isFeatureKilled("reviews")) {
      return res.status(503).json({ success: false, error: "Reviews are temporarily disabled." });
    }
    if (await isUserBlocked(userId)) {
      return res.status(403).json({ success: false, error: "Your account cannot post reviews." });
    }

    if (!(await rateLimit(`review:${userId}`, 10, 60000, { failOpen: false }))) {
      return res.status(429).json({ success: false, error: "Too many requests. Please wait a moment." });
    }

    const { orderId, productId, productTitle, rating, comment } = req.body || {};
    const pid = String(productId || "").trim();
    const oid = String(orderId || "").trim();
    const r = Math.round(Number(rating));
    const text = String(comment || "").slice(0, 2000);
    if (!pid) return res.status(400).json({ success: false, error: "Missing product" });
    if (!Number.isFinite(r) || r < 1 || r > 5) return res.status(400).json({ success: false, error: "Rating must be between 1 and 5" });

    // Purchase check: if orderId is provided, check that specific order. Otherwise check any of user's orders.
    let purchased = false;
    if (oid) {
      const orderSnap = await db().collection("orders").doc(oid).get();
      if (orderSnap.exists) {
        const orderData = orderSnap.data();
        if (orderData.userId === userId) {
          const prods = orderData.products;
          if (Array.isArray(prods) && prods.some((p) => String(p.productId) === pid)) {
            purchased = true;
          }
        }
      }
    } else {
      const ordersSnap = await db().collection("orders").where("userId", "==", userId).get();
      purchased = ordersSnap.docs.some((d) => {
        const products = d.data().products;
        return Array.isArray(products) && products.some((p) => String(p.productId) === pid);
      });
    }

    if (!purchased) {
      return res.status(403).json({ success: false, error: "You can only review products you've purchased in this order." });
    }

    // Deterministic review ID: include orderId if present to allow separate reviews per order
    const userSnap = await db().collection("users").doc(userId).get();
    const userName = userSnap.exists ? (userSnap.data().name || "User") : "User";
    const reviewId = oid ? `${userId}_${oid}_${pid}` : `${userId}_${pid}`;

    await db().collection("reviews").doc(reviewId).set({
      reviewId,
      orderId: oid || null,
      productId: pid,
      productTitle: String(productTitle || "").slice(0, 200),
      userId,
      userName,
      rating: r,
      comment: text,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.json({ success: true, reviewId });
  } catch (err) {
    console.error("[reviews] create failed:", err);
    return res.status(500).json({ success: false, error: "Could not submit review" });
  }
});

module.exports = router;