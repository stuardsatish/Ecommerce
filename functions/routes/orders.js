/**
 * Admin manual order creation — POST /orders/manual-create
 *
 * Admin pastes a WhatsApp order message. This route:
 *   1. Verifies the caller is an authenticated admin.
 *   2. Parses the message (customer details + line items).
 *   3. Resolves each product title against the Firestore catalog.
 *   4. Looks up the customer by Customer ID (preferred) or email.
 *   5. Validates stock.
 *   6. Calls writeOrderInTx() — the same shared function used after
 *      a successful Razorpay payment — so every side-effect is identical.
 *
 * Does NOT touch any Razorpay logic.
 */

const express = require("express");
const admin   = require("firebase-admin");
const { requireAuth } = require("../lib/util");
const { writeOrderInTx } = require("../lib/orderWriter");

const router = express.Router();
const db = () => admin.firestore();

/* ──────────────────────────────────────────────────────────────────────────
   PARSER
   Handles the exact format emitted by CartPage.jsx's sendOrderToWhatsApp():

     Customer ID: <uid>
     Customer Name: <name>
     Email: <email>
     Phone: <phone>

     1. <Title>
     Quantity: <n>
     Price: <n>

     Total Items : <n>
     Total Amount : ₹<n>

   Tolerant of:
     • *bold* / **bold** asterisks
     • blank lines, "Hello," and "Thank you."
     • leading/trailing whitespace
     • ₹ / comma number formatting
────────────────────────────────────────────────────────────────────────── */
function parseWhatsAppMessage(text) {
  // Strip bold markers
  const clean = text.replace(/\*+/g, "");
  const lines  = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const result = {
    customerId:    "",
    customerName:  "",
    email:         "",
    phone:         "",
    items:         [],
    totalItems:    0,
    subtotal:      0,
    shipping:      0,
    promoCode:     "",
    promoDiscount: 0,
    totalAmount:   0,
  };


  const pick = (line) =>
    line.slice(line.toLowerCase().indexOf(":") + 1).trim();

  // Keep only digits and the decimal point — strips ₹, Rs., commas, spaces.
  const parsePrice = (str) => parseFloat(String(str).replace(/[^-0-9.]/g, "")) || 0;

  // ── header fields ─────────────────────────────────────────────────────
  for (const line of lines) {
    const lc = line.toLowerCase();
    if      (lc.startsWith("customer id:"))     result.customerId   = pick(line);
    else if (lc.startsWith("customer name:"))   result.customerName = pick(line);
    else if (lc.startsWith("email:"))           result.email        = pick(line);
    else if (lc.startsWith("phone:"))           result.phone        = pick(line);
    else if (/^total items\s*:/.test(lc))       result.totalItems   = parseInt(pick(line), 10) || 0;
    else if (/^subtotal\s*:/.test(lc))          result.subtotal     = parsePrice(pick(line));
    else if (/^shipping\s*:/.test(lc))          result.shipping     = parsePrice(pick(line));
    else if (/^promo code\s*:/.test(lc)) {
      const v = pick(line); result.promoCode = (v === "None" || v === "none") ? "" : v;
    }
    else if (/^promo discount\s*:/.test(lc))   result.promoDiscount = parsePrice(pick(line));
    else if (/^total amount\s*:/.test(lc))      result.totalAmount  = parsePrice(pick(line));
  }

  // ── items ──────────────────────────────────────────────────────────────
  // Each item block (new format):
  //   N. Title
  //   Quantity: N
  //   MRP: ₹X.XX
  //   Discount: X%          (optional — absent when no discount)
  //   Discounted Price: ₹X.XX
  //
  // Legacy format (old single Price: line) is also supported.
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(/^(\d+)[.)\s]+(.+)$/);
    if (match) {
      const title = match[2].trim();
      let quantity       = 0;
      let mrp            = 0;
      let discountPct    = 0;
      let discountedPrice= 0;
      let legacyPrice    = 0;
      let j = i + 1;

      while (j < lines.length) {
        const nl = lines[j].toLowerCase();
        if (nl.startsWith("quantity:")) {
          quantity = parseInt(lines[j].slice(lines[j].indexOf(":") + 1).trim(), 10) || 0;
          j++;
        } else if (nl.startsWith("mrp:")) {
          mrp = parsePrice(lines[j].slice(lines[j].indexOf(":") + 1));
          j++;
        } else if (nl.startsWith("discount:")) {
          discountPct = parseFloat(lines[j].slice(lines[j].indexOf(":") + 1).replace(/%/g, "").trim()) || 0;
          j++;
        } else if (nl.startsWith("discounted price:")) {
          discountedPrice = parsePrice(lines[j].slice(lines[j].indexOf(":") + 1));
          j++;
        } else if (nl.startsWith("price:")) {
          // Legacy single-price line
          legacyPrice = parsePrice(lines[j].slice(lines[j].indexOf(":") + 1));
          j++;
        } else if (/^\d+[.)\s]/.test(lines[j]) || /^total/.test(nl)) {
          break;
        } else {
          j++;
        }
      }

      if (title && quantity > 0) {
        result.items.push({
          title,
          quantity,
          // originalPrice = MRP; finalPrice = discounted price
          // Fall back to legacy single `price:` for old-format messages.
          mrp:            mrp            || legacyPrice,
          discountPct,
          discountedPrice: discountedPrice || mrp || legacyPrice,
        });
      }
      i = j;
    } else {
      i++;
    }
  }

  return result;
}

/* ──────────────────────────────────────────────────────────────────────────
   ADMIN GUARD
   Verifies Firebase ID token AND checks role === "admin" in Firestore.
────────────────────────────────────────────────────────────────────────── */
async function requireAdmin(req, res) {
  const decoded = await requireAuth(req, res);
  if (!decoded) return null;

  const snap = await db().collection("users").doc(decoded.uid).get();
  if (!snap.exists || snap.data()?.role !== "admin") {
    res.status(403).json({ success: false, error: "Admin access required" });
    return null;
  }
  return decoded;
}

/* ──────────────────────────────────────────────────────────────────────────
   POST /manual-create
────────────────────────────────────────────────────────────────────────── */
router.post("/manual-create", async (req, res) => {
  try {
    const decoded = await requireAdmin(req, res);
    if (!decoded) return;

    const { message, paymentStatus = "paid" } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ success: false, error: "Order message is required" });
    }

    // Only "paid" or "pending" are valid values
    const safeStatus = paymentStatus === "pending" ? "pending" : "paid";

    // ── 1. Parse ──────────────────────────────────────────────────────────
    const parsed = parseWhatsAppMessage(message);

    if (!parsed.items.length)
      return res.status(400).json({ success: false, error: "No items found in the message." });

    if (!parsed.customerId && !parsed.email)
      return res.status(400).json({ success: false, error: "Could not find Customer ID or Email in the message." });

    if (!parsed.totalAmount)
      return res.status(400).json({ success: false, error: "Could not extract Total Amount from the message." });

    const fdb = db();

    // ── 2. Resolve customer ──────────────────────────────────────────────
    let userId, userName, userEmail, userPhone, isGuest = false;

    // Prefer Customer ID (sent by CartPage.jsx — most reliable)
    if (parsed.customerId) {
      const snap = await fdb.collection("users").doc(parsed.customerId).get();
      if (snap.exists) {
        const d  = snap.data();
        userId   = parsed.customerId;
        userName = d.name  || parsed.customerName || "User";
        userEmail= d.email || parsed.email        || "";
        userPhone= d.phone || parsed.phone        || "";
      }
    }

    // Fall back to email lookup
    if (!userId && parsed.email) {
      const q = await fdb.collection("users")
        .where("email", "==", parsed.email)
        .limit(1)
        .get();
      if (!q.empty) {
        const d  = q.docs[0].data();
        userId   = q.docs[0].id;
        userName = d.name  || parsed.customerName || "User";
        userEmail= d.email || parsed.email        || "";
        userPhone= d.phone || parsed.phone        || "";
      }
    }

    // Guest fallback — no matching Firebase user
    if (!userId) {
      isGuest  = true;
      userId   = `guest_${(parsed.email || parsed.customerId || String(Date.now())).replace(/[^a-zA-Z0-9]/g, "_")}`;
      userName = parsed.customerName || "Guest";
      userEmail= parsed.email        || "";
      userPhone= parsed.phone        || "";
    }

    // ── 3. Resolve products (fetch all, match in-memory) ─────────────────
    // Firestore has no native full-text search, so we load the catalog once
    // (suitable for typical store sizes) and match in memory.
    const allSnap    = await fdb.collection("products").get();
    const allProducts= allSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const resolvedItems = [];
    const errors        = [];

    for (const item of parsed.items) {
      const needle = item.title.toLowerCase().trim();

      // 1st pass: exact match (case-insensitive)
      let matches = allProducts.filter(
        (p) => typeof p.title === "string" && p.title.toLowerCase() === needle
      );
      // 2nd pass: prefix / startsWith (handles truncated WhatsApp titles)
      if (!matches.length) {
        matches = allProducts.filter(
          (p) => typeof p.title === "string" && p.title.toLowerCase().startsWith(needle)
        );
      }

      if (!matches.length) {
        errors.push(`Product not found: "${item.title}"`);
      } else if (matches.length > 1) {
        errors.push(
          `Ambiguous product title "${item.title}". Matches: ${matches.map((p) => p.title).join(", ")}`
        );
      } else {
        const p = matches[0];
        // Use prices from the WhatsApp message when available (the agreed price);
        // fall back to live catalog prices if the message values are 0.
        const catalogPrice    = Number(p.price)    || 0;
        const catalogDiscount = Number(p.discount)  || 0;
        const parsedMrp   = item.mrp            > 0 ? item.mrp            : catalogPrice;
        const parsedFinal = item.discountedPrice > 0 ? item.discountedPrice
                              : (catalogPrice - (catalogPrice * catalogDiscount) / 100);
        const parsedDisc  = item.discountPct    > 0 ? item.discountPct    : catalogDiscount;

        resolvedItems.push({
          productId:     p.id,
          title:         p.title,
          category:      p.category || "general",
          quantity:      item.quantity,
          originalPrice: parsedMrp,
          discount:      parsedDisc,
          finalPrice:    parsedFinal,
        });
      }
    }

    if (errors.length) {
      return res.status(400).json({ success: false, error: errors.join("\n") });
    }

    // ── 4. Transaction: stock validation + all writes ─────────────────────
    const orderId = await fdb.runTransaction(async (tx) => {
      // Reads
      const productRefs  = resolvedItems.map((it) =>
        fdb.collection("products").doc(it.productId)
      );
      const productSnaps = [];
      for (const ref of productRefs) productSnaps.push(await tx.get(ref));

      const customerRef  = fdb.collection("customerStats").doc(userId);
      const customerSnap = await tx.get(customerRef);

      const userDocSnap  = await tx.get(fdb.collection("users").doc(userId));
      const userData     = userDocSnap.exists
        ? userDocSnap.data()
        : { name: userName, email: userEmail };

      // Stock validation
      resolvedItems.forEach((it, i) => {
        const ps = productSnaps[i];
        if (!ps.exists) {
          const e = new Error(`Product no longer exists: ${it.title}`);
          e.code = "STOCK"; throw e;
        }
        const available = Number(ps.data().stock) || 0;
        if (available < it.quantity) {
          const e = new Error(
            `Not enough stock for "${it.title}" — available: ${available}, requested: ${it.quantity}`
          );
          e.code = "STOCK"; throw e;
        }
      });

      const totalItems = resolvedItems.reduce((s, it) => s + it.quantity, 0);
      // Compute subtotal from actual line items (most reliable source of truth).
      const computedSubtotal = resolvedItems.reduce((s, it) => s + it.finalPrice * it.quantity, 0);

      const pending = {
        userId,
        userName,
        userEmail,
        items:         resolvedItems,
        subtotal:      Math.round((parsed.subtotal || computedSubtotal) * 100) / 100,
        shipping:      parsed.shipping      || 0,
        promoDiscount: parsed.promoDiscount || 0,
        promoCode:     parsed.promoCode     || "",
        total:         parsed.totalAmount,
        totalItems,
        paymentMethod: "WhatsApp",
        paymentStatus: safeStatus,
        source:        "manual",
      };

      // Shared writer — identical side-effects to the Razorpay flow.
      // clearCart: true for real users (clear their Firestore cart),
      //            false for guest orders (no cart to clear).
      return writeOrderInTx(
        fdb, tx, pending,
        { userData, productRefs, productSnaps, customerRef, customerSnap },
        { clearCart: !isGuest },
      );
    });

    return res.json({
      success: true,
      orderId,
      parsedOrder: {
        customerId:   userId,
        customerName: userName,
        email:        userEmail,
        phone:        userPhone,
        itemCount:    resolvedItems.length,
        totalItems:   resolvedItems.reduce((s, it) => s + it.quantity, 0),
        total:        parsed.totalAmount,
        paymentStatus: safeStatus,
        isGuest,
      },
    });
  } catch (err) {
    console.error("[orders] manual-create failed:", err);
    const status = err.code === "STOCK" ? 409 : 500;
    return res.status(status).json({
      success: false,
      error: err.message || "Failed to create order",
    });
  }
});

module.exports = router;
