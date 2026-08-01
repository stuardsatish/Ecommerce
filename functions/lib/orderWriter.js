/**
 * orderWriter.js — Single source of truth for all Firestore order writes.
 *
 * writeOrderInTx() performs every side-effect of a completed order inside
 * an existing Firestore transaction:
 *   - creates the orders document
 *   - decrements product stock
 *   - updates customerStats
 *   - increments daily / monthly / yearly analytics
 *   - updates productStats + writes inventoryLogs
 *   - clears the customer cart (opt-out for guest orders)
 *   - optionally marks a pendingOrders doc as finalized (Razorpay flow)
 *
 * Called by:
 *   routes/payment.js  – after a successful Razorpay payment
 *   routes/orders.js   – admin WhatsApp / manual order creation
 */

const admin = require("firebase-admin");

const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ─────────────────────────────────────────────────────────────────────────
   GST helpers (India). Product prices are GST-INCLUSIVE, so the taxable value
   is back-calculated: taxable = price × 100 / (100 + rate). Intra-state sales
   split GST into CGST+SGST; inter-state sales use a single IGST.
   Shared by payment.js (Razorpay), orders.js (WhatsApp + billing).
───────────────────────────────────────────────────────────────────────── */

/** Per-UNIT taxable value + gst amount for a GST-inclusive unit price. */
function unitGst(finalPrice, gstRate) {
  const price = Number(finalPrice) || 0;
  const rate = Number(gstRate) || 0;
  if (rate <= 0) return { taxableValue: round2(price), gstAmount: 0 };
  const taxableValue = round2((price * 100) / (100 + rate));
  const gstAmount = round2(price - taxableValue);
  return { taxableValue, gstAmount };
}

/**
 * Enrich each line item with GST fields. `items` must already have
 * { finalPrice, quantity, gstRate?, hsnCode? }. Returns NEW item objects with
 * taxableValue + gstAmount (per unit) and cgst/sgst/igst (per LINE = ×qty).
 * CGST=ceil, SGST=floor so the two always sum to the line's GST exactly.
 */
function applyGstToItems(items, isInterState) {
  return (items || []).map((it) => {
    const rate = Number(it.gstRate) || 0;
    const qty = Number(it.quantity) || 0;
    const { taxableValue, gstAmount } = unitGst(it.finalPrice, rate);
    const lineGst = round2(gstAmount * qty);
    let cgstAmount = 0,
      sgstAmount = 0,
      igstAmount = 0;
    if (isInterState) {
      igstAmount = lineGst;
    } else {
      cgstAmount = Math.ceil((lineGst / 2) * 100) / 100;
      sgstAmount = Math.floor((lineGst / 2) * 100) / 100;
    }
    return {
      ...it,
      gstRate: rate,
      hsnCode: it.hsnCode || "",
      taxableValue,
      gstAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
    };
  });
}

/** Sum GST-enriched line items into order-level totals. */
function sumGstTotals(items) {
  const list = items || [];
  return {
    taxableTotal: round2(
      list.reduce(
        (s, it) =>
          s + (Number(it.taxableValue) || 0) * (Number(it.quantity) || 0),
        0,
      ),
    ),
    totalCgst: round2(
      list.reduce((s, it) => s + (Number(it.cgstAmount) || 0), 0),
    ),
    totalSgst: round2(
      list.reduce((s, it) => s + (Number(it.sgstAmount) || 0), 0),
    ),
    totalIgst: round2(
      list.reduce((s, it) => s + (Number(it.igstAmount) || 0), 0),
    ),
  };
}

/** True when buyer + seller states are both known and differ (→ IGST). */
function resolveInterState(buyerState, sellerState) {
  const b = String(buyerState || "")
    .trim()
    .toLowerCase();
  const s = String(sellerState || "")
    .trim()
    .toLowerCase();
  return !!(b && s && b !== s);
}

/**
 * @param {FirebaseFirestore.Firestore} fdb
 * @param {FirebaseFirestore.Transaction} tx
 * @param {object} pending  – fully resolved order payload
 * @param {object} resolved – pre-fetched Firestore documents
 *   @param {object} resolved.userData
 *   @param {FirebaseFirestore.DocumentReference[]} resolved.productRefs
 *   @param {FirebaseFirestore.DocumentSnapshot[]}  resolved.productSnaps
 *   @param {FirebaseFirestore.DocumentReference}   resolved.customerRef
 *   @param {FirebaseFirestore.DocumentSnapshot}    resolved.customerSnap
 * @param {object} [options]
 *   @param {boolean}   [options.clearCart=true]    – false for guest orders
 *   @param {FirebaseFirestore.DocumentReference} [options.pendingRef] – if set, marks it finalized
 * @returns {string} the new order's Firestore document ID
 */
function writeOrderInTx(fdb, tx, pending, resolved, options = {}) {
  const { clearCart = true, pendingRef = null } = options;
  const { userData, productRefs, productSnaps, customerRef, customerSnap } =
    resolved;

  const now = Timestamp.now();
  const day = now.toDate().toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const year = day.slice(0, 4); // ── 1. Decrement stock ──────────────────────────────────────────────────

  pending.items.forEach((it, i) => {
    tx.update(productRefs[i], {
      stock: (Number(productSnaps[i].data().stock) || 0) - it.quantity,
    });
  }); // ── 2. Create order document ────────────────────────────────────────────

  const orderRef = fdb.collection("orders").doc();

  const orderDoc = {
    orderId: orderRef.id,
    userId: pending.userId,
    userName: userData.name || pending.userName || "User",
    userEmail: userData.email || pending.userEmail || "",
    userPhone: userData.phone || pending.userPhone || "",
    userAddress: userData.address || pending.userAddress || "",
    subtotal: pending.subtotal ?? pending.total,
    shipping: pending.shipping ?? 0,
    promoDiscount: pending.promoDiscount ?? 0,
    promoCode: pending.promoCode ?? "",
    total: pending.total,
    totalItems: pending.totalItems,
    paymentMethod: pending.paymentMethod ?? "Razorpay",
    paymentStatus: pending.paymentStatus ?? "paid", // Most channels start "placed"; the billing (offline POS) flow overrides
    // this to "delivered" since it's an in-store, hand-to-customer sale.
    orderStatus: pending.orderStatus ?? "placed", // GST breakdown (stored so invoices stay accurate if rates change later).
    taxableTotal: pending.taxableTotal ?? 0,
    totalCgst: pending.totalCgst ?? 0,
    totalSgst: pending.totalSgst ?? 0,
    totalIgst: pending.totalIgst ?? 0,
    isInterState: pending.isInterState ?? false,
    createdAt: now,
    products: pending.items,
  }; // Razorpay-specific fields (absent for manual orders)

  if (pending.razorpayPaymentId)
    orderDoc.razorpayPaymentId = pending.razorpayPaymentId;
  if (pending.razorpayOrderId)
    orderDoc.razorpayOrderId = pending.razorpayOrderId; // Source tag so admin can distinguish order origins in the dashboard
  if (pending.source) orderDoc.source = pending.source; // Billing (offline POS) manual discount fields — recorded for the invoice/audit
  if (pending.manualDiscount != null)
    orderDoc.manualDiscount = pending.manualDiscount;
  if (pending.manualDiscountType)
    orderDoc.manualDiscountType = pending.manualDiscountType;

  tx.set(orderRef, orderDoc); // ── 3. Customer stats ───────────────────────────────────────────────────

  const prev = customerSnap.exists ? customerSnap.data() : {};
  const newO = (prev.totalOrders || 0) + 1;
  const newS = (prev.totalSpent || 0) + pending.total;

  tx.set(
    customerRef,
    {
      name: userData.name || pending.userName || "User",
      email: userData.email || pending.userEmail || "",
      totalOrders: newO,
      totalSpent: newS,
      avgOrderValue: Math.round(newS / newO),
      lastOrderDate: now,
    },
    { merge: true },
  ); // ── 4. Analytics (daily / monthly / yearly) ─────────────────────────────

  tx.set(
    fdb.doc(`analytics/daily/stats/${day}`),
    {
      date: day,
      revenue: FieldValue.increment(pending.total),
      orders: FieldValue.increment(1),
      customers: FieldValue.increment(1),
    },
    { merge: true },
  );
  tx.set(
    fdb.doc(`analytics/monthly/stats/${month}`),
    {
      month,
      revenue: FieldValue.increment(pending.total),
      orders: FieldValue.increment(1),
    },
    { merge: true },
  );
  tx.set(
    fdb.doc(`analytics/yearly/stats/${year}`),
    {
      year,
      revenue: FieldValue.increment(pending.total),
      orders: FieldValue.increment(1),
    },
    { merge: true },
  ); // ── 5. Product stats + inventory logs ───────────────────────────────────

  pending.items.forEach((it) => {
    tx.set(
      fdb.collection("productStats").doc(it.productId),
      {
        title: it.title,
        category: it.category || "general",
        totalOrders: FieldValue.increment(1),
        totalRevenue: FieldValue.increment(it.finalPrice * it.quantity),
        totalQuantity: FieldValue.increment(it.quantity),
        lastSoldAt: now,
      },
      { merge: true },
    );
    tx.set(fdb.collection("inventoryLogs").doc(), {
      productId: it.productId,
      change: -it.quantity,
      reason: "order",
      createdAt: now,
    });
  }); // ── 6. Clear customer cart ───────────────────────────────────────────────

  if (clearCart && pending.userId) {
    tx.set(
      fdb.collection("carts").doc(pending.userId),
      { items: [], updatedAt: now },
      { merge: true },
    );
  } // ── 7. Mark pendingOrders as finalized (Razorpay flow only) ─────────────

  if (pendingRef) {
    tx.update(pendingRef, {
      status: "finalized",
      orderId: orderRef.id,
      finalizedAt: now,
    });
  }

  return orderRef.id;
}

module.exports = {
  writeOrderInTx,
  unitGst,
  applyGstToItems,
  sumGstTotals,
  resolveInterState,
};
