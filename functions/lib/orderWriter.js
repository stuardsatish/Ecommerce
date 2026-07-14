/**
 * orderWriter.js — Single source of truth for all Firestore order writes.
 *
 * writeOrderInTx() performs every side-effect of a completed order inside
 * an existing Firestore transaction:
 *   - creates the orders document
 *   - decrements product stock
 *   - updates customerStats
 *   - increments daily / monthly / yearly analytics
 *   - updates productStats + writes inventoryLogs
 *   - clears the customer cart (opt-out for guest orders)
 *   - optionally marks a pendingOrders doc as finalized (Razorpay flow)
 *
 * Called by:
 *   routes/payment.js  – after a successful Razorpay payment
 *   routes/orders.js   – admin WhatsApp / manual order creation
 */

const admin = require("firebase-admin");

const FieldValue = admin.firestore.FieldValue;
const Timestamp  = admin.firestore.Timestamp;

/**
 * @param {FirebaseFirestore.Firestore} fdb
 * @param {FirebaseFirestore.Transaction} tx
 * @param {object} pending  – fully resolved order payload
 * @param {object} resolved – pre-fetched Firestore documents
 *   @param {object} resolved.userData
 *   @param {FirebaseFirestore.DocumentReference[]} resolved.productRefs
 *   @param {FirebaseFirestore.DocumentSnapshot[]}  resolved.productSnaps
 *   @param {FirebaseFirestore.DocumentReference}   resolved.customerRef
 *   @param {FirebaseFirestore.DocumentSnapshot}    resolved.customerSnap
 * @param {object} [options]
 *   @param {boolean}   [options.clearCart=true]    – false for guest orders
 *   @param {FirebaseFirestore.DocumentReference} [options.pendingRef] – if set, marks it finalized
 * @returns {string} the new order's Firestore document ID
 */
function writeOrderInTx(fdb, tx, pending, resolved, options = {}) {
  const { clearCart = true, pendingRef = null } = options;
  const { userData, productRefs, productSnaps, customerRef, customerSnap } = resolved;

  const now   = Timestamp.now();
  const day   = now.toDate().toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const year  = day.slice(0, 4);

  // ── 1. Decrement stock ──────────────────────────────────────────────────
  pending.items.forEach((it, i) => {
    tx.update(productRefs[i], {
      stock: (Number(productSnaps[i].data().stock) || 0) - it.quantity,
    });
  });

  // ── 2. Create order document ────────────────────────────────────────────
  const orderRef = fdb.collection("orders").doc();

  const orderDoc = {
    orderId:       orderRef.id,
    userId:        pending.userId,
    userName:      userData.name    || pending.userName    || "User",
    userEmail:     userData.email   || pending.userEmail   || "",
    userPhone:     userData.phone   || pending.userPhone   || "",
    userAddress:   userData.address || pending.userAddress || "",
    subtotal:      pending.subtotal      ?? pending.total,
    shipping:      pending.shipping      ?? 0,
    promoDiscount: pending.promoDiscount ?? 0,
    promoCode:     pending.promoCode     ?? "",
    total:         pending.total,
    totalItems:    pending.totalItems,
    paymentMethod: pending.paymentMethod ?? "Razorpay",
    paymentStatus: pending.paymentStatus ?? "paid",
    orderStatus:   "placed",
    createdAt:     now,
    products:      pending.items,
  };

  // Razorpay-specific fields (absent for manual orders)
  if (pending.razorpayPaymentId) orderDoc.razorpayPaymentId = pending.razorpayPaymentId;
  if (pending.razorpayOrderId)   orderDoc.razorpayOrderId   = pending.razorpayOrderId;
  // Source tag so admin can distinguish order origins in the dashboard
  if (pending.source)            orderDoc.source            = pending.source;

  tx.set(orderRef, orderDoc);

  // ── 3. Customer stats ───────────────────────────────────────────────────
  const prev = customerSnap.exists ? customerSnap.data() : {};
  const newO = (prev.totalOrders || 0) + 1;
  const newS = (prev.totalSpent  || 0) + pending.total;

  tx.set(
    customerRef,
    {
      name:          userData.name  || pending.userName  || "User",
      email:         userData.email || pending.userEmail || "",
      totalOrders:   newO,
      totalSpent:    newS,
      avgOrderValue: Math.round(newS / newO),
      lastOrderDate: now,
    },
    { merge: true },
  );

  // ── 4. Analytics (daily / monthly / yearly) ─────────────────────────────
  tx.set(
    fdb.doc(`analytics/daily/stats/${day}`),
    { date: day, revenue: FieldValue.increment(pending.total), orders: FieldValue.increment(1), customers: FieldValue.increment(1) },
    { merge: true },
  );
  tx.set(
    fdb.doc(`analytics/monthly/stats/${month}`),
    { month, revenue: FieldValue.increment(pending.total), orders: FieldValue.increment(1) },
    { merge: true },
  );
  tx.set(
    fdb.doc(`analytics/yearly/stats/${year}`),
    { year, revenue: FieldValue.increment(pending.total), orders: FieldValue.increment(1) },
    { merge: true },
  );

  // ── 5. Product stats + inventory logs ───────────────────────────────────
  pending.items.forEach((it) => {
    tx.set(
      fdb.collection("productStats").doc(it.productId),
      {
        title:         it.title,
        category:      it.category || "general",
        totalOrders:   FieldValue.increment(1),
        totalRevenue:  FieldValue.increment(it.finalPrice * it.quantity),
        totalQuantity: FieldValue.increment(it.quantity),
        lastSoldAt:    now,
      },
      { merge: true },
    );
    tx.set(fdb.collection("inventoryLogs").doc(), {
      productId: it.productId,
      change:    -it.quantity,
      reason:    "order",
      createdAt: now,
    });
  });

  // ── 6. Clear customer cart ───────────────────────────────────────────────
  if (clearCart && pending.userId) {
    tx.set(
      fdb.collection("carts").doc(pending.userId),
      { items: [], updatedAt: now },
      { merge: true },
    );
  }

  // ── 7. Mark pendingOrders as finalized (Razorpay flow only) ─────────────
  if (pendingRef) {
    tx.update(pendingRef, {
      status:      "finalized",
      orderId:     orderRef.id,
      finalizedAt: now,
    });
  }

  return orderRef.id;
}

module.exports = { writeOrderInTx };
