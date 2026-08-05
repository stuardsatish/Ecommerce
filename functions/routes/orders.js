/**
 * Admin manual order creation — POST /orders/manual-create
 *
 * Admin pastes a WhatsApp order message. This route:
 *   1. Verifies the caller is an authenticated admin.
 *   2. Parses the message (customer details + line items).
 *   3. Resolves each product title against the Firestore catalog.
 *   4. Looks up the customer by Customer ID (preferred) or email.
 *   5. Validates stock.
 *   6. Calls writeOrderInTx() — the same shared function used after
 *      a successful Razorpay payment — so every side-effect is identical.
 *
 * Does NOT touch any Razorpay logic.
 */

const express = require("express");
const admin   = require("firebase-admin");
const { requireAuth, isFeatureKilled, isPromoExpired } = require("../lib/util");
const { writeOrderInTx, applyGstToItems, sumGstTotals, resolveInterState } = require("../lib/orderWriter");

/** Read the seller's state (settings/invoiceSettings.state) for GST split. */
async function getSellerState() {
  try {
    const snap = await db().collection("settings").doc("invoiceSettings").get();
    return snap.exists ? (snap.data()?.state || "") : "";
  } catch (e) {
    console.warn("[orders] seller state lookup failed:", e);
    return "";
  }
}

// Max rupee gap tolerated between the admin-supplied total and the total the
// server recomputes from the live catalog before it demands explicit override.
const PRICE_TOLERANCE = 1;

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
  const lines  = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const result = {
    customerId:    "",
    customerName:  "",
    email:         "",
    phone:         "",
    items:         [],
    totalItems:    0,
    subtotal:      0,
    shipping:      0,
    promoCode:     "",
    promoDiscount: 0,
    totalAmount:   0,
  };


  const pick = (line) =>
    line.slice(line.toLowerCase().indexOf(":") + 1).trim();

  // Keep only digits and the decimal point — strips ₹, Rs., commas, spaces.
  const parsePrice = (str) => parseFloat(String(str).replace(/[^-0-9.]/g, "")) || 0;

  // ── header fields ─────────────────────────────────────────────────────
  for (const line of lines) {
    const lc = line.toLowerCase();
    if      (lc.startsWith("customer id:"))     result.customerId   = pick(line);
    else if (lc.startsWith("customer name:"))   result.customerName = pick(line);
    else if (lc.startsWith("email:"))           result.email        = pick(line);
    else if (lc.startsWith("phone:"))           result.phone        = pick(line);
    else if (/^total items\s*:/.test(lc))       result.totalItems   = parseInt(pick(line), 10) || 0;
    else if (/^subtotal\s*:/.test(lc))          result.subtotal     = parsePrice(pick(line));
    else if (/^shipping\s*:/.test(lc))          result.shipping     = parsePrice(pick(line));
    else if (/^promo code\s*:/.test(lc)) {
      const v = pick(line); result.promoCode = (v === "None" || v === "none") ? "" : v;
    }
    else if (/^promo discount\s*:/.test(lc))   result.promoDiscount = parsePrice(pick(line));
    else if (/^total amount\s*:/.test(lc))      result.totalAmount  = parsePrice(pick(line));
  }

  // ── items ──────────────────────────────────────────────────────────────
  // Each item block (new format):
  //   N. Title
  //   Quantity: N
  //   MRP: ₹X.XX
  //   Discount: X%          (optional — absent when no discount)
  //   Discounted Price: ₹X.XX
  //
  // Legacy format (old single Price: line) is also supported.
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(/^(\d+)[.)\s]+(.+)$/);
    if (match) {
      const title = match[2].trim();
      let quantity       = 0;
      let mrp            = 0;
      let discountPct    = 0;
      let discountedPrice= 0;
      let legacyPrice    = 0;
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
          mrp:            mrp            || legacyPrice,
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

    if (await isFeatureKilled("orders")) {
      return res.status(503).json({ success: false, error: "Order creation is temporarily disabled." });
    }

    // allowPriceOverride: admin explicitly acknowledges a negotiated price that
    // differs from the live catalog total (WhatsApp orders are hand-agreed).
    const { message, paymentStatus = "paid", allowPriceOverride = false } = req.body;

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
        const d  = snap.data();
        userId   = parsed.customerId;
        userName = d.name  || parsed.customerName || "User";
        userEmail= d.email || parsed.email        || "";
        userPhone= d.phone || parsed.phone        || "";
      }
    }

    // Fall back to email lookup
    if (!userId && parsed.email) {
      const q = await fdb.collection("users")
        .where("email", "==", parsed.email)
        .limit(1)
        .get();
      if (!q.empty) {
        const d  = q.docs[0].data();
        userId   = q.docs[0].id;
        userName = d.name  || parsed.customerName || "User";
        userEmail= d.email || parsed.email        || "";
        userPhone= d.phone || parsed.phone        || "";
      }
    }

    // Guest fallback — no matching Firebase user
    if (!userId) {
      isGuest  = true;
      userId   = `guest_${(parsed.email || parsed.customerId || String(Date.now())).replace(/[^a-zA-Z0-9]/g, "_")}`;
      userName = parsed.customerName || "Guest";
      userEmail= parsed.email        || "";
      userPhone= parsed.phone        || "";
    }

    // ── 3. Resolve products (fetch all, match in-memory) ─────────────────
    // Firestore has no native full-text search, so we load the catalog once
    // (suitable for typical store sizes) and match in memory.
    const allSnap    = await fdb.collection("products").get();
    const allProducts= allSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const resolvedItems = [];
    const errors        = [];

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
        const catalogPrice = Number(p.price) || 0;
        const rawProductDiscount = Number(p.discount || 0);
        const categoryDiscount = Number(p.categoryDiscount || 0);

        // Respect discountExpiry on the server — same logic as the frontend
        // isDiscountActive(). If the product discount has expired, treat it as 0.
        let productDiscount = rawProductDiscount;
        if (rawProductDiscount > 0 && p.discountExpiry) {
          const expiryMs = new Date(p.discountExpiry).getTime();
          if (!isNaN(expiryMs) && Date.now() > expiryMs) {
            productDiscount = 0; // discount expired → no product-level discount
          }
        }

        const catalogDiscount = Math.max(productDiscount, categoryDiscount);
        const catalogFinalPrice = catalogPrice - (catalogPrice * catalogDiscount) / 100;

        // Extract WhatsApp unit price from parsed item (if provided)
        const waUnitPrice = Number(item.discountedPrice) > 0 ? Number(item.discountedPrice) : catalogFinalPrice;

        // If allowPriceOverride is confirmed by admin, use the WhatsApp line item price; otherwise evaluate catalog price
        const finalPrice = allowPriceOverride ? waUnitPrice : catalogFinalPrice;

        resolvedItems.push({
          productId:     p.id,
          title:         p.title,
          category:      p.category || "general",
          quantity:      item.quantity,
          originalPrice: allowPriceOverride ? (item.mrp || catalogPrice) : catalogPrice,
          discount:      allowPriceOverride ? (item.discountPct || 0) : catalogDiscount,
          finalPrice,
          gstRate:       Number(p.gstRate || 0),
          hsnCode:       p.hsnCode || "",
        });
      }
    }

    if (errors.length) {
      return res.status(400).json({ success: false, error: errors.join("\n") });
    }

    // ── 3b. Price integrity check ─────────────────────────────────────────
    // Recompute the total from the catalog-priced line items. Shipping/promo
    // are admin-entered fields from the message. If the pasted "Total Amount"
    // disagrees beyond tolerance, refuse unless the admin explicitly overrides
    // (negotiated price) — never silently trust the customer-editable message.
    const serverSubtotal   = Math.round(resolvedItems.reduce((s, it) => s + it.finalPrice * it.quantity, 0) * 100) / 100;
    const msgShipping      = Number(parsed.shipping)      || 0;
    const msgPromoDiscount = Number(parsed.promoDiscount) || 0;
    const serverTotal      = Math.max(0, Math.round(serverSubtotal + msgShipping - msgPromoDiscount));
    const pastedTotal      = Math.round(Number(parsed.totalAmount) || 0);
    const priceMismatch    = Math.abs(serverTotal - pastedTotal) > PRICE_TOLERANCE;

    if (priceMismatch && !allowPriceOverride) {
      return res.status(409).json({
        success: false,
        code: "PRICE_MISMATCH",
        error: `The pasted total (₹${pastedTotal}) does not match the catalog total (₹${serverTotal}). Review the order and re-submit with confirmation to override.`,
        serverTotal,
        pastedTotal,
      });
    }
    // Not overriding → record the authoritative catalog total. Overriding →
    // record the admin-agreed pasted total, flagged for audit.
    const recordedTotal = priceMismatch ? pastedTotal : serverTotal;

    // Seller state for the GST CGST/SGST-vs-IGST split (read before the tx).
    const sellerState = await getSellerState();

    // ── 4. Transaction: stock validation + all writes ─────────────────────
    const orderId = await fdb.runTransaction(async (tx) => {
      // Reads
      const productRefs  = resolvedItems.map((it) =>
        fdb.collection("products").doc(it.productId)
      );
      const productSnaps = [];
      for (const ref of productRefs) productSnaps.push(await tx.get(ref));

      const customerRef  = fdb.collection("customerStats").doc(userId);
      const customerSnap = await tx.get(customerRef);

      const userDocSnap  = await tx.get(fdb.collection("users").doc(userId));
      const userData     = userDocSnap.exists
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

      // GST breakdown — buyer state from the resolved user doc.
      const buyerState = userData?.address?.state || "";
      const isInterState = resolveInterState(buyerState, sellerState);
      const gstItems = applyGstToItems(resolvedItems, isInterState);
      const gstTotals = sumGstTotals(gstItems);

      const pending = {
        userId,
        userName,
        userEmail,
        items:         gstItems,
        subtotal:      serverSubtotal,           // from catalog-priced line items
        shipping:      msgShipping,
        promoDiscount: msgPromoDiscount,
        promoCode:     parsed.promoCode || "",
        total:         recordedTotal,            // catalog total, or admin-agreed override
        totalItems,
        taxableTotal:  gstTotals.taxableTotal,
        totalCgst:     gstTotals.totalCgst,
        totalSgst:     gstTotals.totalSgst,
        totalIgst:     gstTotals.totalIgst,
        isInterState,
        paymentMethod: "WhatsApp",
        paymentStatus: safeStatus,
        source:        "manual",
        priceOverridden:     priceMismatch,      // audit: admin overrode catalog price
        serverComputedTotal: serverTotal,        // audit: what the catalog said
        createdByAdmin:      decoded.uid,        // audit: who created it
      };

      // Shared writer — identical side-effects to the Razorpay flow.
      // clearCart: true for real users (clear their Firestore cart),
      //            false for guest orders (no cart to clear).
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
        customerId:   userId,
        customerName: userName,
        email:        userEmail,
        phone:        userPhone,
        itemCount:    resolvedItems.length,
        totalItems:   resolvedItems.reduce((s, it) => s + it.quantity, 0),
        total:        parsed.totalAmount,
        paymentStatus: safeStatus,
        isGuest,
      },
    });
  } catch (err) {
    console.error("[orders] manual-create failed:", err);
    // STOCK errors carry an admin-actionable message; everything else is a
    // real server fault and must not leak internals to the client.
    if (err.code === "STOCK") {
      return res.status(409).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: "Failed to create order" });
  }
});

/* ──────────────────────────────────────────────────────────────────────────
   POST /billing-create   (Offline POS / walk-in billing counter)

   Admin selects products from the catalog and records an in-store sale.
   Body: {
     items: [{ productId, quantity }],   // NO prices from client
     customerName?, customerPhone?, customerEmail?,
     paymentMethod: "Cash" | "UPI" | "Card" | "Other",
     paymentStatus: "paid" | "pending",
     promoCode?,
     manualDiscount?, manualDiscountType?: "flat" | "percent",
   }

   Mirrors the Razorpay flow's server-authoritative pricing, then calls the
   shared writeOrderInTx() so every side-effect (stock, analytics, stats,
   inventory logs) is identical. Distinguished by source:"billing" and
   orderStatus:"delivered" (hand-to-customer sale). Shipping is always 0.
────────────────────────────────────────────────────────────────────────── */
const VALID_PAYMENT_METHODS = ["Cash", "UPI", "Card", "Other"];

router.post("/billing-create", async (req, res) => {
  try {
    const decoded = await requireAdmin(req, res);
    if (!decoded) return;

    if (await isFeatureKilled("orders")) {
      return res.status(503).json({ success: false, error: "Order creation is temporarily disabled." });
    }

    const {
      items,
      customerName  = "",
      customerPhone = "",
      customerEmail = "",
      paymentMethod = "Cash",
      paymentStatus = "paid",
      promoCode     = "",
      manualDiscount     = 0,
      manualDiscountType = "flat",
    } = req.body || {};

    // ── 1. Validate inputs ────────────────────────────────────────────────
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "No items in the bill." });
    }
    const safeMethod = VALID_PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : "Cash";
    const safeStatus = paymentStatus === "pending" ? "pending" : "paid";
    const safeDiscType = manualDiscountType === "percent" ? "percent" : "flat";

    const fdb = db();

    // ── 2. Server-authoritative pricing (catalog is source of truth) ──────
    const resolvedItems = [];
    let subtotal = 0;

    for (const it of items) {
      const pid = String(it?.productId || "");
      const qty = Math.floor(Number(it?.quantity) || 0);
      if (!pid || qty <= 0) {
        return res.status(400).json({ success: false, error: "Invalid bill item." });
      }

      const snap = await fdb.collection("products").doc(pid).get();
      if (!snap.exists) {
        return res.status(400).json({ success: false, error: `Product not found: ${pid}` });
      }
      const p = snap.data();
      const price = Number(p.price || 0);
      if (price <= 0) {
        return res.status(400).json({ success: false, error: `Product not purchasable: ${p.title || pid}` });
      }

      // Use the larger of product / category discount — never stack (matches payment.js).
      const productDiscount  = Number(p.discount || 0);
      const categoryDiscount = Number(p.categoryDiscount || 0);
      const finalDiscount    = Math.max(productDiscount, categoryDiscount);
      const finalPrice       = price - (price * finalDiscount) / 100;

      subtotal += finalPrice * qty;

      resolvedItems.push({
        productId:     pid,
        title:         p.title || "Product",
        category:      p.category || "general",
        sku:           p.sku || "",
        quantity:      qty,
        originalPrice: price,
        discount:      finalDiscount,
        finalPrice,
        gstRate:       Number(p.gstRate || 0),
        hsnCode:       p.hsnCode || "",
      });
    }

    const subtotalRounded = Math.round(subtotal * 100) / 100;

    // ── 3. Promo code (validated server-side; client sends only the code) ──
    let promoDiscount = 0;
    let appliedPromoCode = "";
    if (promoCode && typeof promoCode === "string" && promoCode.trim()) {
      const code = promoCode.trim().toUpperCase();
      try {
        const promoSnap = await fdb.collection("promoCodes").where("code", "==", code).limit(1).get();
        if (!promoSnap.empty) {
          const pd = promoSnap.docs[0].data();
          const expired = isPromoExpired(pd.expiryDate);
          if (!expired) {
            const value = Number(pd.value || 0);
            if (pd.type === "percent")   promoDiscount = Math.round((subtotalRounded * value) / 100);
            else if (pd.type === "flat") promoDiscount = value;
            promoDiscount = Math.max(0, promoDiscount);
            appliedPromoCode = code;
          }
        }
      } catch (promoErr) {
        console.warn("[orders] billing promo lookup failed:", promoErr);
      }
    }

    // ── 4. Manual discount (admin override on the whole bill) ──────────────
    const rawManual = Math.max(0, Number(manualDiscount) || 0);
    let manualDiscountAmount = 0;
    if (rawManual > 0) {
      manualDiscountAmount = safeDiscType === "percent"
        ? Math.round((subtotalRounded * Math.min(rawManual, 100)) / 100)
        : rawManual;
      manualDiscountAmount = Math.max(0, manualDiscountAmount);
    }

    // ── 5. Final total (shipping always 0 for in-store; never below zero) ──
    const total = Math.max(0, Math.round(subtotalRounded - promoDiscount - manualDiscountAmount));
    if (total <= 0) {
      return res.status(400).json({ success: false, error: "Bill total must be greater than zero." });
    }

    // ── 6. Resolve customer (existing user by phone/email, else walk-in) ──
    let userId, userName, userEmail, userPhone, isGuest = false;
    let buyerState = "";
    const phone = String(customerPhone || "").trim();
    const email = String(customerEmail || "").trim();

    if (phone) {
      const q = await fdb.collection("users").where("phone", "==", phone).limit(1).get();
      if (!q.empty) {
        const d = q.docs[0].data();
        userId = q.docs[0].id;
        userName = d.name || customerName || "Customer";
        userEmail = d.email || email || "";
        userPhone = d.phone || phone;
        buyerState = d.address?.state || "";
      }
    }
    if (!userId && email) {
      const q = await fdb.collection("users").where("email", "==", email).limit(1).get();
      if (!q.empty) {
        const d = q.docs[0].data();
        userId = q.docs[0].id;
        userName = d.name || customerName || "Customer";
        userEmail = d.email || email;
        userPhone = d.phone || phone || "";
        buyerState = d.address?.state || "";
      }
    }
    if (!userId) {
      isGuest = true;
      const key = (phone || email || String(Date.now())).replace(/[^a-zA-Z0-9]/g, "_");
      userId = `walkin_${key}`;
      userName = customerName || "Walk-in Customer";
      userEmail = email;
      userPhone = phone;
    }

    // GST breakdown (server-authoritative, computed once — reused for the
    // stored order AND the response used to auto-generate the invoice).
    const sellerState = await getSellerState();
    const isInterState = resolveInterState(buyerState, sellerState);
    const gstItems = applyGstToItems(resolvedItems, isInterState);
    const gstTotals = sumGstTotals(gstItems);

    // ── 7. Transaction: stock validation + all writes (shared writer) ─────
    const orderId = await fdb.runTransaction(async (tx) => {
      const productRefs  = resolvedItems.map((it) => fdb.collection("products").doc(it.productId));
      const productSnaps = [];
      for (const ref of productRefs) productSnaps.push(await tx.get(ref));

      const customerRef  = fdb.collection("customerStats").doc(userId);
      const customerSnap  = await tx.get(customerRef);

      const userDocSnap  = await tx.get(fdb.collection("users").doc(userId));
      const userData     = userDocSnap.exists
        ? userDocSnap.data()
        : { name: userName, email: userEmail, phone: userPhone, address: "In-Store" };

      // Stock validation
      resolvedItems.forEach((it, i) => {
        const ps = productSnaps[i];
        if (!ps.exists) {
          const e = new Error(`Product no longer exists: ${it.title}`); e.code = "STOCK"; throw e;
        }
        const available = Number(ps.data().stock) || 0;
        if (available < it.quantity) {
          const e = new Error(`Not enough stock for "${it.title}" — available: ${available}, requested: ${it.quantity}`);
          e.code = "STOCK"; throw e;
        }
      });

      const totalItems = resolvedItems.reduce((s, it) => s + it.quantity, 0);

      const pending = {
        userId,
        userName,
        userEmail,
        userPhone,
        userAddress:  "In-Store",
        items:        gstItems,
        subtotal:     subtotalRounded,
        shipping:     0,
        promoDiscount,
        promoCode:    appliedPromoCode,
        manualDiscount:     manualDiscountAmount,
        manualDiscountType: safeDiscType,
        total,
        totalItems,
        taxableTotal:  gstTotals.taxableTotal,
        totalCgst:     gstTotals.totalCgst,
        totalSgst:     gstTotals.totalSgst,
        totalIgst:     gstTotals.totalIgst,
        isInterState,
        paymentMethod: safeMethod,
        paymentStatus: safeStatus,
        orderStatus:   "delivered",   // in-store, hand-to-customer sale
        source:        "billing",
        createdByAdmin: decoded.uid,  // audit: who rang it up
      };

      return writeOrderInTx(
        fdb, tx, pending,
        { userData, productRefs, productSnaps, customerRef, customerSnap },
        { clearCart: false },         // no cart involved in a POS sale
      );
    });

    // Return a full order object so the client can generate the invoice PDF
    // without a follow-up read.
    return res.json({
      success: true,
      orderId,
      order: {
        orderId,
        id: orderId,
        userId,
        userName,
        userEmail,
        userPhone,
        userAddress:   "In-Store Pickup",
        shippingAddress: "In-Store Pickup",
        subtotal:      subtotalRounded,
        shipping:      0,
        promoDiscount,
        promoCode:     appliedPromoCode,
        manualDiscount:     manualDiscountAmount,
        manualDiscountType: safeDiscType,
        total,
        totalItems:    resolvedItems.reduce((s, it) => s + it.quantity, 0),
        taxableTotal:  gstTotals.taxableTotal,
        totalCgst:     gstTotals.totalCgst,
        totalSgst:     gstTotals.totalSgst,
        totalIgst:     gstTotals.totalIgst,
        isInterState,
        paymentMethod: safeMethod,
        paymentStatus: safeStatus,
        orderStatus:   "delivered",
        source:        "billing",
        createdAt:     new Date().toISOString(),
        products:      gstItems,
        isGuest,
      },
    });
  } catch (err) {
    console.error("[orders] billing-create failed:", err);
    if (err.code === "STOCK") {
      return res.status(409).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: "Failed to create bill" });
  }
});

module.exports = router;