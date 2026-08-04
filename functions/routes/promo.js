/**
 * Promo validation route.
 *
 *   POST /promo/validate   Body: { code, subtotal }
 *
 * The promoCodes collection is no longer world-readable (see firestore.rules),
 * so the cart's "Apply" preview asks the server instead of enumerating codes.
 * This returns ONLY the resolved discount for the given code + subtotal — it
 * never exposes the full code list. The authoritative discount is still
 * recomputed independently in /payment/create-order.
 */
const express = require("express");
const admin = require("firebase-admin");
const { requireAuth, rateLimit, isPromoExpired } = require("../lib/util");

const router = express.Router();
const db = () => admin.firestore();

router.post("/validate", async (req, res) => {
  try {
    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    // Fail-closed limiter: cheap read, but stops code-enumeration by brute force.
    if (!(await rateLimit(`promo-validate:${decoded.uid}`, 20, 60000))) {
      return res.status(429).json({ success: false, error: "Too many attempts. Please wait a moment." });
    }

    const rawCode = String(req.body?.code || "").trim().toUpperCase();
    const subtotal = Math.max(0, Number(req.body?.subtotal || 0));
    if (!rawCode) return res.status(400).json({ success: false, error: "Enter a code" });

    const snap = await db().collection("promoCodes").where("code", "==", rawCode).limit(1).get();
    if (snap.empty) return res.status(404).json({ success: false, error: "Invalid promo code" });

    const pd = snap.docs[0].data();

    if (isPromoExpired(pd.expiryDate)) {
      return res.status(410).json({ success: false, error: "This promo code has expired" });
    }

    const value = Number(pd.value || 0);
    let discount = 0;
    if (pd.type === "percent") discount = Math.round((subtotal * value) / 100);
    else if (pd.type === "flat") discount = value;
    discount = Math.max(0, discount);

    // Return only what the UI needs for a preview — not the raw document.
    return res.json({
      success: true,
      code: rawCode,
      type: pd.type === "flat" ? "flat" : "percent",
      value,
      discount,
      expiryDate: pd.expiryDate || null,
    });
  } catch (err) {
    console.error("[promo] validate failed:", err);
    return res.status(500).json({ success: false, error: "Could not validate code" });
  }
});

module.exports = router;