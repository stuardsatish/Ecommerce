// Port of functions/routes/payment.js POST /cod-create.
// Same server-side pricing/GST pipeline as /payment-create-order, no
// Razorpay — writes the order directly via create_order_tx.
import { handlePreflight, jsonResponse, methodNotAllowed, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { requireAuth, isFeatureKilled, isUserBlocked } from "../_shared/auth.ts";
import { rateLimit, globalDailyLimit } from "../_shared/rateLimit.ts";
import {
  applyGstToItems,
  getSellerState,
  getShippingConfig,
  isCodEnabled,
  priceCartItems,
  resolveInterState,
  resolvePromoDiscount,
  sumGstTotals,
  type ProductRow,
} from "../_shared/pricing.ts";
import { createOrderTx, StockError } from "../_shared/orderWriter.ts";

const ORDERS_DAILY_CAP = Number(Deno.env.get("ORDERS_DAILY_CAP") || 2000);

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const methodErr = methodNotAllowed(req, ["POST"]);
  if (methodErr) return methodErr;

  const admin = supabaseAdmin();

  try {
    const auth = await requireAuth(req);
    if (!auth.user) return auth.error;
    const userId = auth.user.id;

    if (await isFeatureKilled(admin, "orders")) {
      return jsonResponse(req, 503, { success: false, error: "Checkout is temporarily unavailable. Please try again later." });
    }
    if (await isUserBlocked(admin, userId)) {
      return jsonResponse(req, 403, { success: false, error: "Your account is not able to place orders. Please contact support." });
    }
    if (!(await rateLimit(admin, `cod-create:${userId}`, 15, 60000, { failOpen: false }))) {
      return jsonResponse(req, 429, { success: false, error: "Too many requests. Please wait a moment and try again." });
    }
    const utcDay = new Date().toISOString().slice(0, 10);
    if (!(await globalDailyLimit(admin, "orders", ORDERS_DAILY_CAP, utcDay))) {
      return jsonResponse(req, 503, { success: false, error: "The store is experiencing very high volume. Please try again later." });
    }

    const { json: body } = await readBody(req);
    const { items, promoCode } = body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return jsonResponse(req, 400, { success: false, error: "Cart is empty" });
    }

    // 1. COD must be enabled.
    if (!(await isCodEnabled(admin))) {
      return jsonResponse(req, 400, { success: false, error: "Cash on Delivery is currently disabled." });
    }

    // 2. Fresh email-verified check.
    if (!auth.user.email_confirmed_at) {
      return jsonResponse(req, 403, { success: false, error: "Email not verified. Please verify your email before checking out." });
    }

    // 3. Fetch profile + validate a delivery address is on file.
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("name, email, phone, address")
      .eq("id", userId)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!profile) {
      return jsonResponse(req, 404, { success: false, error: "User account not found" });
    }
    const addr = profile.address || {};
    const street = typeof addr === "string" ? addr : addr.street;
    if (!street || !String(street).trim()) {
      return jsonResponse(req, 400, {
        success: false,
        error: "Delivery address is required for COD orders. Please update your profile address.",
      });
    }

    // 4. Server-side catalog pricing + stock validation.
    const pids = [...new Set(items.map((i: any) => String(i?.productId || "")).filter(Boolean))];
    const { data: productRows, error: productErr } = await admin.from("products").select("*").in("id", pids);
    if (productErr) throw productErr;
    const productsById = new Map<string, ProductRow>((productRows || []).map((p: ProductRow) => [p.id, p]));

    const priced = priceCartItems(items, productsById);
    if (!priced.ok) return jsonResponse(req, priced.status, { success: false, error: priced.error });
    const { lineItems, subtotal } = priced;

    // 5. Promo code.
    const { discount: promoDiscount, appliedCode: appliedPromoCode } = await resolvePromoDiscount(admin, promoCode, subtotal);

    // 6. Shipping.
    const { threshold, fee } = await getShippingConfig(admin);
    const shipping = subtotal >= threshold ? 0 : fee;

    const subtotalRounded = Math.round(subtotal);
    const total = Math.max(0, Math.round(subtotalRounded + shipping - promoDiscount));
    if (total <= 0) {
      return jsonResponse(req, 400, { success: false, error: "Invalid order total" });
    }

    // 7. GST breakdown — buyer state from the profile we already fetched.
    const buyerState = typeof addr === "object" ? addr?.state || "" : "";
    const sellerState = await getSellerState(admin);
    const isInterState = resolveInterState(buyerState, sellerState);
    const gstItems = applyGstToItems(lineItems, isInterState);
    const gstTotals = sumGstTotals(gstItems);

    // 8. Write the order atomically (stock re-validated inside the RPC).
    const orderId = `cod_${crypto.randomUUID()}`;
    try {
      await createOrderTx(admin, {
        orderId,
        userId,
        items: gstItems,
        orderStatus: "placed",
        paymentStatus: "pending",
        paymentMethod: "COD",
        source: "online",
        customerName: profile.name || "Customer",
        customerEmail: profile.email || "",
        customerPhone: profile.phone || "",
        address: profile.address ?? null,
        subtotal: subtotalRounded,
        shipping,
        cgst: gstTotals.totalCgst,
        sgst: gstTotals.totalSgst,
        igst: gstTotals.totalIgst,
        promoCode: appliedPromoCode,
        promoDiscount,
        total,
      });
    } catch (e) {
      if (e instanceof StockError) {
        return jsonResponse(req, 409, { success: false, error: e.message });
      }
      throw e;
    }

    return jsonResponse(req, 200, { success: true, orderId });
  } catch (err) {
    console.error("[payment-cod-create] failed:", err);
    return jsonResponse(req, 500, { success: false, error: (err as Error).message || "Failed to place COD order" });
  }
});