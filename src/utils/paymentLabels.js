/**
 * Human-friendly labels for an order's payment method + status.
 * Shared by the customer order views, the admin drawer, and the PDF invoice so
 * "COD" always reads the same way everywhere.
 */

/** e.g. "COD" -> "Cash on Delivery (COD)", "Razorpay" -> "Razorpay". */
export const paymentMethodLabel = (method) => {
  const m = String(method || "").toLowerCase();
  if (m === "cod") return "Cash on Delivery (COD)";
  if (m === "razorpay") return "Razorpay";
  if (m === "whatsapp") return "WhatsApp";
  return method || "N/A";
};

/**
 * e.g. pending + COD -> "Pending (Pay on Delivery)", pending -> "Pending",
 * paid -> "Paid". `method` is optional and only tweaks the pending wording.
 */
export const paymentStatusLabel = (status, method) => {
  const s = String(status || "").toLowerCase();
  const isCod = String(method || "").toLowerCase() === "cod";
  if (s === "pending") return isCod ? "Pending (Pay on Delivery)" : "Pending";
  if (s === "paid") return "Paid";
  return status || "N/A";
};

/** True when the order is a Cash-on-Delivery order still awaiting payment. */
export const isCodPending = (order) =>
  String(order?.paymentMethod || "").toLowerCase() === "cod" &&
  String(order?.paymentStatus || "").toLowerCase() === "pending";
