/**
 * Razorpay payment routes — SERVER-AUTHORITATIVE.
 *
 *   POST /payment/create-order  -> validates the cart against the product
 *        catalog, computes the price SERVER-SIDE, creates a Razorpay order, and
 *        stashes the validated order in /pendingOrders (the client never sends
 *        prices and cannot influence the amount).
 *   POST /payment/verify        -> verifies the HMAC signature, then writes the
 *        real order + decrements stock + updates stats, all from the stashed
 *        server copy, via the Admin SDK (bypasses client rules).
 *
 * The key secret never leaves the server.
 */
const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const admin = require("firebase-admin");
const { requireAuth, rateLimit, globalDailyLimit, isFeatureKilled, isUserBlocked, isPromoExpired } = require("../lib/util");
const { writeOrderInTx, applyGstToItems, sumGstTotals, resolveInterState, getGstEnabled } = require("../lib/orderWriter");

// Hard ceiling on Razorpay order creations per UTC day, across ALL users, so a
// worst-case abuse scenario is bounded no matter how many accounts are rotated.
// Tune via the ORDERS_DAILY_CAP env var.
const ORDERS_DAILY_CAP = Number(process.env.ORDERS_DAILY_CAP || 2000);

const router = express.Router();
const db = () => admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const CURRENCY = "INR";

/**
 * Product-level discount, ignoring it once discountExpiry has passed.
 * Mirrors the frontend's isDiscountActive() (src/pages/CartPage/CartPage.jsx)
 * and the same gate already applied in routes/orders.js — without this, an
 * expired discount field still on the product doc gets applied server-side
 * even though the cart page (correctly) stopped showing it, so the Razorpay
 * amount ends up lower than the cart's displayed total.
 */
function activeProductDiscount(p) {
  const raw = Number(p.discount || 0);
  if (raw > 0 && p.discountExpiry) {
    const expiryMs = new Date(p.discountExpiry).getTime();
    if (!isNaN(expiryMs) && Date.now() > expiryMs) return 0;
  }
  return raw;
}

/** Lazily build the Razorpay client (env isn't present at deploy-analysis time). */
let _razorpay = null;
function getRazorpay() {
  if (_razorpay) return _razorpay;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret)
    throw new Error("Missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET env vars");
  _razorpay = new Razorpay({ key_id, key_secret });
  return _razorpay;
}

/**
 * POST /create-order
 * Body: { items: [{ productId, quantity }], promoCode? }  (NO prices from client)
 * Returns: { success, orderId, amount, currency, subtotal, shipping, promoDiscount, total, keyId }
 */
router.post("/create-order", async (req, res) => {
  try {
    const decoded = await requireAuth(req, res);
    if (!decoded) return;
    const userId = decoded.uid; // trusted: from the verified token, not the body

    // Kill switch: admin can instantly disable checkout (settings/security).
    if (await isFeatureKilled("orders")) {
      return res.status(503).json({ success: false, error: "Checkout is temporarily unavailable. Please try again later." });
    }

    // Per-user block: refuse abusive accounts without a redeploy.
    if (await isUserBlocked(userId)) {
      return res.status(403).json({ success: false, error: "Your account is not able to place orders. Please contact support." });
    }

    // Per-user limit (fail-CLOSED: limiter outage must not open the floodgates).
    if (!(await rateLimit(`create-order:${userId}`, 15, 60000, { failOpen: false }))) {
      return res.status(429).json({
        success: false,
        error: "Too many requests. Please wait a moment and try again.",
      });
    }

    // Global daily ceiling across all users.
    const utcDay = new Date().toISOString().slice(0, 10);
    if (!(await globalDailyLimit("orders", ORDERS_DAILY_CAP, utcDay))) {
      return res.status(503).json({ success: false, error: "The store is experiencing very high volume. Please try again later." });
    }

    const { items, promoCode } = req.body;

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ success: false, error: "Cart is empty" }); // Require a verified email before taking payment (fresh check, not the token claim).

    try {
      const userRecord = await admin.auth().getUser(userId);
      if (!userRecord.emailVerified) {
        return res.status(403).json({
          success: false,
          error:
            "Email not verified. Please verify your email before checking out.",
        });
      }
    } catch (e) {
      return res.status(400).json({ success: false, error: "Invalid user" });
    } // Price every line from the catalog — this is the source of truth.

    //     const lineItems = [];
    //     let total = 0;
    //     for (const it of items) {
    //       const pid = String(it.productId || "");
    //       const qty = Math.floor(Number(it.quantity) || 0);
    //       if (!pid || qty <= 0) return res.status(400).json({ success: false, error: "Invalid cart item" });

    //       const snap = await db().collection("products").doc(pid).get();
    //       if (!snap.exists) return res.status(400).json({ success: false, error: `Product not found: ${pid}` });

    //       const p = snap.data();
    //       const price = Number(p.price) || 0;
    //       const stock = Number(p.stock) || 0;
    //       if (price <= 0) return res.status(400).json({ success: false, error: `Product not purchasable: ${p.title || pid}` });
    //       if (stock < qty) return res.status(409).json({ success: false, error: `Not enough stock for ${p.title || pid}` });

    //       total += price * qty;
    //       lineItems.push({ productId: pid, title: p.title || "Product", price, quantity: qty, category: p.category || "general" });
    //     }

    // -------------------------------------------------------
    // SERVER-SIDE PRICING  (single source of truth)
    // -------------------------------------------------------

    const lineItems = [];
    let subtotal = 0;

    for (const it of items) {
      const pid = String(it.productId || "");
      const qty = Math.floor(Number(it.quantity) || 0);

      if (!pid || qty <= 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid cart item",
        });
      }

      const snap = await db().collection("products").doc(pid).get();

      if (!snap.exists) {
        return res.status(400).json({
          success: false,
          error: `Product not found: ${pid}`,
        });
      }

      const p = snap.data();
      const price = Number(p.price || 0);
      const stock = Number(p.stock || 0);

      if (price <= 0) {
        return res.status(400).json({
          success: false,
          error: `Product not purchasable: ${p.title || pid}`,
        });
      }
      if (stock < qty) {
        return res.status(409).json({
          success: false,
          error: `Not enough stock for ${p.title || pid}`,
        });
      }

      // --------------------------------------------------
      // PRODUCT DISCOUNT  (percentage stored on product)
      // --------------------------------------------------
      const productDiscount = activeProductDiscount(p);

      // --------------------------------------------------
      // CATEGORY DISCOUNT  (stored as categoryDiscount
      //   field on the same product document — Option A)
      // --------------------------------------------------
      const categoryDiscount = Number(p.categoryDiscount || 0);

      // --------------------------------------------------
      // USE ONLY THE LARGER DISCOUNT — never stack
      // --------------------------------------------------
      const finalDiscount = Math.max(productDiscount, categoryDiscount);
      const finalPrice = price - (price * finalDiscount) / 100;

      subtotal += finalPrice * qty;

      lineItems.push({
        productId: pid,
        title: p.title || "Product",
        category: p.category || "general",
        quantity: qty,
        originalPrice: price,
        discount: finalDiscount,
        finalPrice,
        gstRate: Number(p.gstRate || 0),
        hsnCode: p.hsnCode || "",
      });
    }

    // --------------------------------------------------
    // PROMO CODE  (validated server-side; client sends
    //   only the code string — never a discount amount)
    // --------------------------------------------------
    let promoDiscount = 0;
    let appliedPromoCode = "";

    if (promoCode && typeof promoCode === "string" && promoCode.trim()) {
      const code = promoCode.trim().toUpperCase();
      try {
        const promoSnap = await db()
          .collection("promoCodes")
          .where("code", "==", code)
          .limit(1)
          .get();

        if (!promoSnap.empty) {
          const pd = promoSnap.docs[0].data();

          // Expiry check
          const isExpired = isPromoExpired(pd.expiryDate);

          if (!isExpired) {
            const value = Number(pd.value || 0);

            if (pd.type === "percent") {
              promoDiscount = Math.round((subtotal * value) / 100);
            } else if (pd.type === "flat") {
              promoDiscount = value;
            }

            promoDiscount = Math.max(0, promoDiscount);
            appliedPromoCode = code;
          }
        }
        // Invalid / unknown / expired codes are silently ignored — amount stays 0.
      } catch (promoErr) {
        console.warn("[payment] promo lookup failed:", promoErr);
        // Non-fatal: proceed without the promo discount.
      }
    }

    // --------------------------------------------------
    // SHIPPING  (config read from settings/shippingSettings)
    // --------------------------------------------------
    let shippingThreshold = 500; // default: free shipping above ₹500
    let shippingFee = 49;         // default: ₹49 below threshold
    try {
      const shippingSnap = await db()
        .collection("settings")
        .doc("shippingSettings")
        .get();
      if (shippingSnap.exists) {
        const sd = shippingSnap.data();
        if (typeof sd.freeShippingThreshold === "number") shippingThreshold = sd.freeShippingThreshold;
        if (typeof sd.shippingCost === "number") shippingFee = sd.shippingCost;
      }
    } catch (shipErr) {
      console.warn("[payment] shipping settings lookup failed, using defaults:", shipErr);
    }
    const shipping = subtotal >= shippingThreshold ? 0 : shippingFee;


    // --------------------------------------------------
    // FINAL TOTAL  (never below zero)
    // --------------------------------------------------
    const subtotalRounded = Math.round(subtotal);
    const total = Math.max(
      0,
      Math.round(subtotalRounded + shipping - promoDiscount),
    );

    if (total <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid order total" });
    }

    // --------------------------------------------------
    // GST BREAKDOWN  (server-authoritative, per item)
    //   Buyer state from users/{uid}.address.state, seller state from
    //   settings/invoiceSettings.state → decides CGST+SGST vs IGST.
    // --------------------------------------------------
    let buyerState = "";
    let sellerState = "";
    try {
      const buyerSnap = await db().collection("users").doc(userId).get();
      if (buyerSnap.exists) buyerState = buyerSnap.data()?.address?.state || "";
    } catch (e) { console.warn("[payment] buyer state lookup failed:", e); }
    try {
      const setSnap = await db().collection("settings").doc("invoiceSettings").get();
      if (setSnap.exists) sellerState = setSnap.data()?.state || "";
    } catch (e) { console.warn("[payment] seller state lookup failed:", e); }

    const isInterState = resolveInterState(buyerState, sellerState);
    const gstItems = applyGstToItems(lineItems, isInterState);
    const gstTotals = sumGstTotals(gstItems);

    const order = await getRazorpay().orders.create({
      amount: total * 100, // paise — SERVER computed
      currency: CURRENCY,
      receipt: `rcpt_${String(userId).slice(0, 8)}_${Date.now()}`,
    });

    // Stash the validated order; /verify finalizes from THIS, never from client input.
    await db()
      .collection("pendingOrders")
      .doc(order.id)
      .set({
        userId,
        items: gstItems,
        subtotal: subtotalRounded,
        shipping,
        promoDiscount,
        promoCode: appliedPromoCode,
        total,
        totalItems: gstItems.reduce((s, i) => s + i.quantity, 0),
        taxableTotal: gstTotals.taxableTotal,
        totalCgst: gstTotals.totalCgst,
        totalSgst: gstTotals.totalSgst,
        totalIgst: gstTotals.totalIgst,
        isInterState,
        status: "created",
        createdAt: FieldValue.serverTimestamp(),
      });

    return res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      subtotal: subtotalRounded,
      shipping,
      promoDiscount,
      total,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("[payment] create-order failed:", err?.error || err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to create payment order" });
  }
});

/**
 * POST /cod-create
 * Header: Authorization: Bearer <ID_TOKEN>
 * Body: { items: [{ productId, quantity }], promoCode? }  (NO prices from client)
 *
 * Places a Cash-on-Delivery order directly (no Razorpay). Prices, stock, promo,
 * shipping and GST are all computed SERVER-SIDE — the client only sends product
 * ids + quantities. Writes the order via the shared writeOrderInTx() with
 * paymentMethod:"COD", paymentStatus:"pending", orderStatus:"placed".
 * Returns: { success, orderId }
 */
router.post("/cod-create", async (req, res) => {
  try {
    const decoded = await requireAuth(req, res);
    if (!decoded) return;
    const userId = decoded.uid; // trusted: from the verified token, not the body

    // Kill switch + per-user block (same protections as Razorpay checkout).
    if (await isFeatureKilled("orders")) {
      return res.status(503).json({ success: false, error: "Checkout is temporarily unavailable. Please try again later." });
    }
    if (await isUserBlocked(userId)) {
      return res.status(403).json({ success: false, error: "Your account is not able to place orders. Please contact support." });
    }

    // Per-user limit (fail-CLOSED) + global daily ceiling.
    if (!(await rateLimit(`cod-create:${userId}`, 15, 60000, { failOpen: false }))) {
      return res.status(429).json({ success: false, error: "Too many requests. Please wait a moment and try again." });
    }
    const utcDay = new Date().toISOString().slice(0, 10);
    if (!(await globalDailyLimit("orders", ORDERS_DAILY_CAP, utcDay))) {
      return res.status(503).json({ success: false, error: "The store is experiencing very high volume. Please try again later." });
    }

    const { items, promoCode } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "Cart is empty" });
    }

    const fdb = db();

    // 1. COD must be enabled in settings/paymentSettings.
    const paySnap = await fdb.collection("settings").doc("paymentSettings").get();
    if (paySnap.exists && paySnap.data().codPayment === false) {
      return res.status(400).json({ success: false, error: "Cash on Delivery is currently disabled." });
    }

    // 2. Require a verified email (parity with Razorpay checkout).
    try {
      const userRecord = await admin.auth().getUser(userId);
      if (!userRecord.emailVerified) {
        return res.status(403).json({ success: false, error: "Email not verified. Please verify your email before checking out." });
      }
    } catch (e) {
      return res.status(400).json({ success: false, error: "Invalid user" });
    }

    // 3. Fetch user + validate a delivery address is on file.
    const userSnap = await fdb.collection("users").doc(userId).get();
    if (!userSnap.exists) {
      return res.status(404).json({ success: false, error: "User account not found" });
    }
    const userData = userSnap.data();
    const addr = userData.address || {};
    const street = typeof addr === "string" ? addr : addr.street;
    if (!street || !String(street).trim()) {
      return res.status(400).json({
        success: false,
        error: "Delivery address is required for COD orders. Please update your profile address.",
      });
    }

    // 4. Server-side catalog pricing + stock validation (identical rules to
    //    /create-order — larger of product/category discount, never stacked).
    let subtotal = 0;
    const lineItems = [];
    for (const it of items) {
      const pid = String(it.productId || "");
      const qty = Math.floor(Number(it.quantity) || 0);
      if (!pid || qty <= 0) {
        return res.status(400).json({ success: false, error: "Invalid cart item" });
      }
      const snap = await fdb.collection("products").doc(pid).get();
      if (!snap.exists) {
        return res.status(400).json({ success: false, error: `Product not found: ${pid}` });
      }
      const p = snap.data();
      const price = Number(p.price || 0);
      const stock = Number(p.stock || 0);
      if (price <= 0) {
        return res.status(400).json({ success: false, error: `Product not purchasable: ${p.title || pid}` });
      }
      if (stock < qty) {
        return res.status(409).json({ success: false, error: `Not enough stock for ${p.title || pid}` });
      }

      const productDiscount = activeProductDiscount(p);
      const categoryDiscount = Number(p.categoryDiscount || 0);
      const finalDiscount = Math.max(productDiscount, categoryDiscount);
      const finalPrice = price - (price * finalDiscount) / 100;

      subtotal += finalPrice * qty;
      lineItems.push({
        productId: pid,
        title: p.title || "Product",
        category: p.category || "general",
        quantity: qty,
        originalPrice: price,
        discount: finalDiscount,
        finalPrice,
        gstRate: Number(p.gstRate || 0),
        hsnCode: p.hsnCode || "",
      });
    }

    // 5. Promo code (validated server-side; client sends only the code string).
    let promoDiscount = 0;
    let appliedPromoCode = "";
    if (promoCode && typeof promoCode === "string" && promoCode.trim()) {
      const code = promoCode.trim().toUpperCase();
      try {
        const promoSnap = await fdb.collection("promoCodes").where("code", "==", code).limit(1).get();
        if (!promoSnap.empty) {
          const pd = promoSnap.docs[0].data();
          const isExpired = isPromoExpired(pd.expiryDate);
          if (!isExpired) {
            const value = Number(pd.value || 0);
            if (pd.type === "percent") promoDiscount = Math.round((subtotal * value) / 100);
            else if (pd.type === "flat") promoDiscount = value;
            promoDiscount = Math.max(0, promoDiscount);
            appliedPromoCode = code;
          }
        }
      } catch (promoErr) {
        console.warn("[payment] cod promo lookup failed:", promoErr);
      }
    }

    // 6. Shipping (config from settings/shippingSettings).
    let shippingThreshold = 500;
    let shippingFee = 49;
    try {
      const shipSnap = await fdb.collection("settings").doc("shippingSettings").get();
      if (shipSnap.exists) {
        const sd = shipSnap.data();
        if (typeof sd.freeShippingThreshold === "number") shippingThreshold = sd.freeShippingThreshold;
        if (typeof sd.shippingCost === "number") shippingFee = sd.shippingCost;
      }
    } catch (shipErr) {
      console.warn("[payment] cod shipping settings lookup failed, using defaults:", shipErr);
    }
    const shipping = subtotal >= shippingThreshold ? 0 : shippingFee;

    const subtotalRounded = Math.round(subtotal);
    const total = Math.max(0, Math.round(subtotalRounded + shipping - promoDiscount));
    if (total <= 0) {
      return res.status(400).json({ success: false, error: "Invalid order total" });
    }

    // 7. GST breakdown (server-authoritative, per item) — same as Razorpay flow
    //    so COD invoices carry accurate CGST/SGST/IGST.
    let buyerState = "";
    let sellerState = "";
    try { buyerState = userData?.address?.state || ""; } catch (e) { /* string address → no state */ }
    try {
      const setSnap = await fdb.collection("settings").doc("invoiceSettings").get();
      if (setSnap.exists) sellerState = setSnap.data()?.state || "";
    } catch (e) { console.warn("[payment] cod seller state lookup failed:", e); }

    const isInterState = resolveInterState(buyerState, sellerState);
    const gstItems = applyGstToItems(lineItems, isInterState);
    const gstTotals = sumGstTotals(gstItems);

    const userAddress = typeof addr === "object"
      ? `${addr.street || ""}, ${addr.city || ""}, ${addr.state || ""} ${addr.pincode || ""}`.replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim()
      : addr;

    // 8. Write the order atomically via the shared single-source-of-truth writer.
    const orderId = await fdb.runTransaction(async (tx) => {
      const productRefs = gstItems.map((it) => fdb.collection("products").doc(it.productId));
      const productSnaps = [];
      for (const ref of productRefs) productSnaps.push(await tx.get(ref));

      const customerRef = fdb.collection("customerStats").doc(userId);
      const customerSnap = await tx.get(customerRef);

      // Re-validate stock at write time.
      gstItems.forEach((it, i) => {
        const ps = productSnaps[i];
        if (!ps.exists) {
          const e = new Error(`Product not found: ${it.title}`);
          e.code = "STOCK";
          throw e;
        }
        if ((Number(ps.data().stock) || 0) < it.quantity) {
          const e = new Error(`Not enough stock for ${it.title}`);
          e.code = "STOCK";
          throw e;
        }
      });

      const pending = {
        userId,
        userName: userData.name || "Customer",
        userEmail: userData.email || "",
        userPhone: userData.phone || "",
        userAddress,
        items: gstItems,
        subtotal: subtotalRounded,
        shipping,
        promoDiscount,
        promoCode: appliedPromoCode,
        total,
        totalItems: gstItems.reduce((s, i) => s + i.quantity, 0),
        taxableTotal: gstTotals.taxableTotal,
        totalCgst: gstTotals.totalCgst,
        totalSgst: gstTotals.totalSgst,
        totalIgst: gstTotals.totalIgst,
        isInterState,
        paymentMethod: "COD",
        paymentStatus: "pending",
        orderStatus: "placed",
        source: "online",
      };

      return writeOrderInTx(
        fdb, tx, pending,
        { userData, productRefs, productSnaps, customerRef, customerSnap },
        { clearCart: true },
      );
    });

    return res.json({ success: true, orderId });
  } catch (err) {
    if (err.code === "STOCK") {
      return res.status(409).json({ success: false, error: err.message });
    }
    console.error("[payment] cod-create failed:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to place COD order" });
  }
});

/**
 * POST /verify
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Returns: { success, verified, paymentId, orderId }
 */
router.post("/verify", async (req, res) => {
  try {
    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    if (!(await rateLimit(`verify:${decoded.uid}`, 30, 60000, { failOpen: false }))) {
      return res.status(429).json({
        success: false,
        verified: false,
        error: "Too many requests. Please wait a moment.",
      });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return res.status(400).json({
        success: false,
        verified: false,
        error: "Missing payment fields",
      });

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(String(razorpay_signature));
    const verified = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!verified)
      return res
        .status(400)
        .json({ success: false, verified: false, error: "Invalid signature" }); // Signature is valid → write the order from the server-stored pending copy.
    // Pass the authenticated uid so a user can only finalize their own order.

    const orderId = await finalizeOrder(
      razorpay_order_id,
      razorpay_payment_id,
      decoded.uid,
    );
    return res.json({
      success: true,
      verified: true,
      paymentId: razorpay_payment_id,
      orderId,
    });
  } catch (err) {
    if (err.code === "ALREADY_FINALIZED") {
      return res.json({ success: true, verified: true, orderId: err.orderId });
    }
    console.error("[payment] verify/finalize failed:", err);
    const status =
      err.code === "STOCK"
        ? 409
        : err.code === "NO_PENDING"
          ? 410
          : err.code === "FORBIDDEN"
            ? 403
            : 500;
    return res.status(status).json({
      success: false,
      verified: false,
      error: err.message || "Could not finalize order",
    });
  }
});

/**
 * Atomically write the order + stock decrement + customer/product/analytics
 * aggregates + cart clear, from the trusted /pendingOrders record.
 * Idempotent: a second call returns the existing order id.
 */
async function finalizeOrder(razorpayOrderId, razorpayPaymentId, expectedUid) {
  const fdb = db();
  const pendingRef = fdb.collection("pendingOrders").doc(razorpayOrderId);

  return fdb.runTransaction(async (tx) => {
    const pendingSnap = await tx.get(pendingRef);
    if (!pendingSnap.exists) {
      const e = new Error("Order session expired or already processed");
      e.code = "NO_PENDING";
      throw e;
    }
    const pending = pendingSnap.data();
    if (pending.status === "finalized") {
      const e = new Error("Already finalized");
      e.code = "ALREADY_FINALIZED";
      e.orderId = pending.orderId;
      throw e;
    } // When called from /verify, the caller may only finalize their OWN order.
    // (The webhook calls without expectedUid — it's trusted via signature.)
    if (expectedUid && pending.userId !== expectedUid) {
      const e = new Error("This order belongs to a different account");
      e.code = "FORBIDDEN";
      throw e;
    } // ---- READS (all before writes) ----

    const userSnap = await tx.get(fdb.collection("users").doc(pending.userId));
    const userData = userSnap.exists ? userSnap.data() : {};

    const productRefs = pending.items.map((it) =>
      fdb.collection("products").doc(it.productId),
    );
    const productSnaps = [];
    for (const ref of productRefs) productSnaps.push(await tx.get(ref));

    const customerRef = fdb.collection("customerStats").doc(pending.userId);
    const customerSnap = await tx.get(customerRef);

    // Re-validate stock at finalize time.
    pending.items.forEach((it, i) => {
      const ps = productSnaps[i];
      if (!ps.exists) {
        const e = new Error(`Product not found: ${it.title}`);
        e.code = "STOCK";
        throw e;
      }
      if ((Number(ps.data().stock) || 0) < it.quantity) {
        const e = new Error(`Not enough stock for ${it.title}`);
        e.code = "STOCK";
        throw e;
      }
    }); // ---- WRITES (via shared orderWriter — single source of truth) ----

    const enriched = {
      ...pending,
      paymentMethod:      "Razorpay",
      paymentStatus:      "paid",
      razorpayPaymentId,
      razorpayOrderId,
    };

    return writeOrderInTx(
      fdb, tx, enriched,
      { userData, productRefs, productSnaps, customerRef, customerSnap },
      { clearCart: true, pendingRef },
    );
  });
}

/**
 * POST /webhook
 * Razorpay → server-to-server callback. Finalizes the order even if the
 * customer's browser dropped before calling /verify. Verified via the webhook
 * secret + raw body, and idempotent (safe if /verify already finalized).
 * Configure in Razorpay Dashboard → Webhooks; set RAZORPAY_WEBHOOK_SECRET.
 */
router.post("/webhook", async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[payment] webhook secret not configured");
      return res.status(500).send("webhook not configured");
    }
    const signature = req.headers["x-razorpay-signature"];
    const raw = req.rawBody; // captured by express.json verify hook in index.js
    if (!raw || !signature)
      return res.status(400).send("missing signature/body");

    const expected = crypto
      .createHmac("sha256", secret)
      .update(raw)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
      return res.status(400).send("invalid signature");

    const event = req.body?.event;
    if (event === "payment.captured" || event === "order.paid") {
      const payment = req.body?.payload?.payment?.entity || {};
      const orderId = payment.order_id;
      const paymentId = payment.id;
      if (orderId && paymentId) {
        try {
          await finalizeOrder(orderId, paymentId);
        } catch (e) {
          // Already done / no pending record → nothing to do; anything else is real.
          if (e.code !== "ALREADY_FINALIZED" && e.code !== "NO_PENDING")
            throw e;
        }
      }
    }
    return res.json({ received: true });
  } catch (err) {
    console.error("[payment] webhook error:", err);
    return res.status(500).send("error");
  }
});

module.exports = router;