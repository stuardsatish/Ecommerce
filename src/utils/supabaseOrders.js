// Maps `orders` + `order_items` rows (snake_case, per 01-schema.sql) to the
// camelCase shape the rest of the app was built around when orders lived in
// Firestore. All reads from the orders table should go through this normalizer.
//
// IMPORTANT — resolvedFinalPrice compatibility:
//   AdminOrdersPage has a `resolvedFinalPrice` helper that detects an old
//   Firestore-backend bug where finalPrice was stored equal to the MRP.
//   It fires when `disc > 0 && stored >= mrp && mrp > 0`. To prevent that
//   branch from double-discounting Supabase order items (where unit_price IS
//   already the correct post-discount price), we intentionally do NOT expose a
//   `price` field on mapped items so that mrp resolves to 0 and the condition
//   `mrp > 0` stays false. `finalPrice` alone is enough for every UI consumer.
export const mapOrderRow = (row) => {
  if (!row) return row
  const items = (row.order_items || []).map((it) => ({
    productId: it.product_id,
    title: it.title || "",
    quantity: Number(it.quantity) || 1,
    // unit_price is the final charged price per unit (already discounted).
    finalPrice: Number(it.unit_price) || 0,
    discount: Number(it.discount) || 0,
    lineTotal: Number(it.line_total) || 0,
  }))

  // address is jsonb in Supabase — expose under all aliases the UI checks.
  const addr = row.address

  return {
    id: row.id,
    userId: row.user_id,
    orderStatus: row.order_status || "placed",
    paymentStatus: row.payment_status || "pending",
    paymentMethod: row.payment_method || "",
    source: row.source || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    // Schema uses customer_* not user_*; re-expose under the camelCase names
    // the rest of the UI expects.
    userName: row.customer_name || "",
    userEmail: row.customer_email || "",
    userPhone: row.customer_phone || "",

    // address is jsonb; expose under all aliases the UI checks
    userAddress: addr,
    address: addr,
    shippingAddress: addr,

    // financial fields
    subtotal: Number(row.subtotal) || 0,
    shipping: Number(row.shipping) || 0,
    total: Number(row.total) || 0,
    promoCode: row.promo_code || "",
    promoDiscount: Number(row.promo_discount) || 0,

    // GST breakdown (stored as cgst/sgst/igst on the orders row)
    totalCgst: Number(row.cgst) || 0,
    totalSgst: Number(row.sgst) || 0,
    totalIgst: Number(row.igst) || 0,

    // Razorpay IDs
    razorpayOrderId: row.razorpay_order_id || "",
    razorpayPaymentId: row.razorpay_payment_id || "",

    // order_items mapped to `products` (UI-facing name for the line-items array)
    products: items,
  }
}

export const mapOrderRows = (rows) => (rows || []).map(mapOrderRow)