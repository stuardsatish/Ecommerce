// ============================================================================
// orders-billing-create — SELF-CONTAINED Dashboard bundle.
// Paste this whole file as the function's index.ts in the Supabase Dashboard
// (Edge Functions -> Deploy a new function -> name it "orders-billing-create").
// ============================================================================
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

/* ============================== cors.ts ============================== */
const DEFAULT_ORIGINS = [
  "https://e-commerce-demo-website1.web.app",
  "https://my-sweet-bec4a.web.app",
  "http://localhost:5173",
];
function allowedOrigins(): string[] {
  const env = Deno.env.get("ALLOWED_ORIGINS");
  if (!env) return DEFAULT_ORIGINS;
  return env.split(",").map((s) => s.trim()).filter(Boolean);
}
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-site",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Referrer-Policy": "no-referrer",
};
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature",
    Vary: "Origin",
  };
  if (!origin) return headers;
  if (allowedOrigins().includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function jsonResponse(req: Request, status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS, ...corsHeaders(req), ...extraHeaders },
  });
}
const MAX_BODY_BYTES = 64 * 1024;
async function readBody(req: Request): Promise<{ raw: string; json: any }> {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    const e = new Error("Request body too large");
    (e as any).code = "BODY_TOO_LARGE";
    throw e;
  }
  let json: any = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch { json = {}; }
  return { raw, json };
}
function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...corsHeaders(req) } });
}
function methodNotAllowed(req: Request, allow: string[]): Response | null {
  if (allow.includes(req.method)) return null;
  return jsonResponse(req, 405, { success: false, error: "Method not allowed" });
}

/* ============================== clients.ts ============================== */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
let _admin: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  return _admin;
}
function supabaseForRequest(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization") || "";
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}

/* ============================== auth.ts ============================== */
type AuthResult = { user: User; error: null } | { user: null; error: Response };
async function requireAuth(req: Request): Promise<AuthResult> {
  const header = req.headers.get("Authorization") || "";
  if (!/^Bearer .+$/.test(header)) {
    return { user: null, error: jsonResponse(req, 401, { success: false, error: "Not authenticated" }) };
  }
  const client = supabaseForRequest(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    return { user: null, error: jsonResponse(req, 401, { success: false, error: "Invalid or expired session. Please log in again." }) };
  }
  return { user: data.user, error: null };
}
async function requireAdmin(req: Request, admin: SupabaseClient): Promise<AuthResult> {
  const auth = await requireAuth(req);
  if (!auth.user) return auth;
  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (error || !profile || profile.role !== "admin") {
    return { user: null, error: jsonResponse(req, 403, { success: false, error: "Admin access required" }) };
  }
  return auth;
}
async function isFeatureKilled(admin: SupabaseClient, feature: string): Promise<boolean> {
  try {
    const { data, error } = await admin.from("settings").select("data").eq("id", "security").maybeSingle();
    if (error || !data) return false;
    const d = data.data || {};
    if (d.allDisabled === true) return true;
    return d[`${feature}Enabled`] === false;
  } catch (e) {
    console.error("[isFeatureKilled] error:", e);
    return false;
  }
}
function isPromoExpired(expiryDate: string | number | null | undefined): boolean {
  if (!expiryDate) return false;
  let expTime: number;
  if (typeof expiryDate === "string" && !expiryDate.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(expiryDate)) {
    const parts = expiryDate.split(/[-T:]/);
    if (parts.length >= 5) {
      expTime = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), Number(parts[3]), Number(parts[4])).getTime();
    } else {
      expTime = new Date(expiryDate).getTime();
    }
  } else {
    expTime = new Date(expiryDate).getTime();
  }
  return !isNaN(expTime) && Date.now() > expTime;
}

/* ============================== pricing.ts (subset) ============================== */
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
type LineItem = {
  productId: string; title: string; category: string; sku?: string; quantity: number;
  originalPrice: number; discount: number; finalPrice: number; gstRate: number; hsnCode: string;
};
type GstLineItem = LineItem & { taxableValue: number; gstAmount: number; cgstAmount: number; sgstAmount: number; igstAmount: number };
function unitGst(finalPrice: number, gstRate: number): { taxableValue: number; gstAmount: number } {
  const price = Number(finalPrice) || 0;
  const rate = Number(gstRate) || 0;
  if (rate <= 0) return { taxableValue: round2(price), gstAmount: 0 };
  const taxableValue = round2((price * 100) / (100 + rate));
  const gstAmount = round2(price - taxableValue);
  return { taxableValue, gstAmount };
}
function applyGstToItems(items: LineItem[], isInterState: boolean): GstLineItem[] {
  return (items || []).map((it) => {
    const rate = Number(it.gstRate) || 0;
    const qty = Number(it.quantity) || 0;
    const { taxableValue, gstAmount } = unitGst(it.finalPrice, rate);
    const lineGst = round2(gstAmount * qty);
    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
    if (isInterState) igstAmount = lineGst;
    else { cgstAmount = Math.ceil((lineGst / 2) * 100) / 100; sgstAmount = Math.floor((lineGst / 2) * 100) / 100; }
    return { ...it, gstRate: rate, hsnCode: it.hsnCode || "", taxableValue, gstAmount, cgstAmount, sgstAmount, igstAmount };
  });
}
function sumGstTotals(items: GstLineItem[]) {
  const list = items || [];
  return {
    taxableTotal: round2(list.reduce((s, it) => s + (Number(it.taxableValue) || 0) * (Number(it.quantity) || 0), 0)),
    totalCgst: round2(list.reduce((s, it) => s + (Number(it.cgstAmount) || 0), 0)),
    totalSgst: round2(list.reduce((s, it) => s + (Number(it.sgstAmount) || 0), 0)),
    totalIgst: round2(list.reduce((s, it) => s + (Number(it.igstAmount) || 0), 0)),
  };
}
function resolveInterState(buyerState: string, sellerState: string): boolean {
  const b = String(buyerState || "").trim().toLowerCase();
  const s = String(sellerState || "").trim().toLowerCase();
  return !!(b && s && b !== s);
}
type ProductRow = {
  id: string; title: string | null; category: string | null; sku: string | null; price: number; stock: number;
  discount: number; discount_expiry: string | null; gst_rate: number; hsn_code: string | null;
};
async function getSellerState(admin: SupabaseClient): Promise<string> {
  try {
    const { data, error } = await admin.from("settings").select("data").eq("id", "invoiceSettings").maybeSingle();
    if (error || !data?.data) return "";
    return data.data.state || "";
  } catch (e) { console.warn("[pricing] seller state lookup failed:", e); return ""; }
}

/* ============================== orderWriter.ts ============================== */
type CreateOrderParams = {
  orderId: string; userId: string | null; items: GstLineItem[]; orderStatus: string; paymentStatus: string;
  paymentMethod: string; source: string; customerName: string; customerEmail: string; customerPhone: string;
  address: unknown; subtotal: number; shipping: number; cgst: number; sgst: number; igst: number;
  promoCode: string; promoDiscount: number; total: number; razorpayOrderId?: string | null; razorpayPaymentId?: string | null;
};
class StockError extends Error { code = "STOCK"; }
function toOrderItemsJson(items: GstLineItem[]) {
  return items.map((it) => ({
    product_id: it.productId, title: it.title, quantity: it.quantity, unit_price: it.finalPrice, discount: it.discount,
    cgst: it.cgstAmount, sgst: it.sgstAmount, igst: it.igstAmount, line_total: round2(it.finalPrice * it.quantity),
  }));
}
async function createOrderTx(admin: SupabaseClient, p: CreateOrderParams) {
  const { data, error } = await admin.rpc("create_order_tx", {
    p_order_id: p.orderId, p_user_id: p.userId, p_items: toOrderItemsJson(p.items), p_order_status: p.orderStatus,
    p_payment_status: p.paymentStatus, p_payment_method: p.paymentMethod, p_source: p.source,
    p_customer_name: p.customerName, p_customer_email: p.customerEmail, p_customer_phone: p.customerPhone,
    p_address: p.address, p_subtotal: p.subtotal, p_shipping: p.shipping, p_cgst: p.cgst, p_sgst: p.sgst, p_igst: p.igst,
    p_promo_code: p.promoCode, p_promo_discount: p.promoDiscount, p_total: p.total,
    p_razorpay_order_id: p.razorpayOrderId ?? null, p_razorpay_payment_id: p.razorpayPaymentId ?? null,
  });
  if (error) {
    if (/insufficient stock/i.test(error.message || "")) throw new StockError(error.message);
    throw error;
  }
  return data;
}

/* ============================== function logic (index.ts) ============================== */
// Port of functions/routes/orders.js POST /billing-create (offline POS / walk-in).
// Faithfully preserves the original's one inconsistency vs. the other order
// creation routes: NO discount_expiry check here (unlike payment.js).
const VALID_PAYMENT_METHODS = ["Cash", "UPI", "Card", "Other"];

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const methodErr = methodNotAllowed(req, ["POST"]);
  if (methodErr) return methodErr;

  const admin = supabaseAdmin();

  try {
    const auth = await requireAdmin(req, admin);
    if (!auth.user) return auth.error;

    if (await isFeatureKilled(admin, "orders")) {
      return jsonResponse(req, 503, { success: false, error: "Order creation is temporarily disabled." });
    }

    const { json: body } = await readBody(req);
    const {
      items,
      customerName = "",
      customerPhone = "",
      customerEmail = "",
      paymentMethod = "Cash",
      paymentStatus = "paid",
      promoCode = "",
      manualDiscount = 0,
      manualDiscountType = "flat",
    } = body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return jsonResponse(req, 400, { success: false, error: "No items in the bill." });
    }
    const safeMethod = VALID_PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : "Cash";
    const safeStatus = paymentStatus === "pending" ? "pending" : "paid";
    const safeDiscType = manualDiscountType === "percent" ? "percent" : "flat";

    const pids = [...new Set(items.map((i: any) => String(i?.productId || "")).filter(Boolean))];
    const { data: productRows, error: productErr } = await admin.from("products").select("*").in("id", pids);
    if (productErr) throw productErr;
    const productsById = new Map<string, ProductRow>((productRows || []).map((p: ProductRow) => [p.id, p]));

    const resolvedItems: LineItem[] = [];
    let subtotal = 0;

    for (const it of items) {
      const pid = String(it?.productId || "");
      const qty = Math.floor(Number(it?.quantity) || 0);
      if (!pid || qty <= 0) {
        return jsonResponse(req, 400, { success: false, error: "Invalid bill item." });
      }
      const p = productsById.get(pid);
      if (!p) {
        return jsonResponse(req, 400, { success: false, error: `Product not found: ${pid}` });
      }
      const price = Number(p.price || 0);
      if (price <= 0) {
        return jsonResponse(req, 400, { success: false, error: `Product not purchasable: ${p.title || pid}` });
      }

      const finalDiscount = Number(p.discount || 0);
      const finalPrice = price - (price * finalDiscount) / 100;

      subtotal += finalPrice * qty;

      resolvedItems.push({
        productId: pid, title: p.title || "Product", category: p.category || "general", sku: p.sku || "", quantity: qty,
        originalPrice: price, discount: finalDiscount, finalPrice, gstRate: Number(p.gst_rate || 0), hsnCode: p.hsn_code || "",
      });
    }

    const subtotalRounded = Math.round(subtotal * 100) / 100;

    let promoDiscount = 0;
    let appliedPromoCode = "";
    if (promoCode && typeof promoCode === "string" && promoCode.trim()) {
      const code = promoCode.trim().toUpperCase();
      try {
        const { data: pd } = await admin.from("promo_codes").select("*").eq("code", code).maybeSingle();
        if (pd && !isPromoExpired(pd.expiry_date)) {
          const value = Number(pd.value || 0);
          if (pd.type === "percent") promoDiscount = Math.round((subtotalRounded * value) / 100);
          else if (pd.type === "flat") promoDiscount = value;
          promoDiscount = Math.max(0, promoDiscount);
          appliedPromoCode = code;
        }
      } catch (e) {
        console.warn("[orders-billing-create] promo lookup failed:", e);
      }
    }

    const rawManual = Math.max(0, Number(manualDiscount) || 0);
    let manualDiscountAmount = 0;
    if (rawManual > 0) {
      manualDiscountAmount = safeDiscType === "percent" ? Math.round((subtotalRounded * Math.min(rawManual, 100)) / 100) : rawManual;
      manualDiscountAmount = Math.max(0, manualDiscountAmount);
    }

    const total = Math.max(0, Math.round(subtotalRounded - promoDiscount - manualDiscountAmount));
    if (total <= 0) {
      return jsonResponse(req, 400, { success: false, error: "Bill total must be greater than zero." });
    }

    let userId: string | null = null;
    let userName = "", userEmail = "", userPhone = "";
    let userAddress: unknown = null;
    let isGuest = false;
    let buyerState = "";
    const phone = String(customerPhone || "").trim();
    const email = String(customerEmail || "").trim();

    if (phone) {
      const { data: p } = await admin.from("profiles").select("*").eq("phone", phone).limit(1).maybeSingle();
      if (p) {
        userId = p.id;
        userName = p.name || customerName || "Customer";
        userEmail = p.email || email || "";
        userPhone = p.phone || phone;
        userAddress = p.address ?? null;
        buyerState = p.address?.state || "";
      }
    }
    if (!userId && email) {
      const { data: p } = await admin.from("profiles").select("*").eq("email", email).limit(1).maybeSingle();
      if (p) {
        userId = p.id;
        userName = p.name || customerName || "Customer";
        userEmail = p.email || email;
        userPhone = p.phone || phone || "";
        userAddress = p.address ?? null;
        buyerState = p.address?.state || "";
      }
    }
    if (!userId) {
      isGuest = true;
      userName = customerName || "Walk-in Customer";
      userEmail = email;
      userPhone = phone;
    }

    const sellerState = await getSellerState(admin);
    const isInterState = resolveInterState(buyerState, sellerState);
    const gstItems = applyGstToItems(resolvedItems, isInterState);
    const gstTotals = sumGstTotals(gstItems);
    const totalItems = resolvedItems.reduce((s, it) => s + it.quantity, 0);

    const orderId = `bill_${crypto.randomUUID()}`;
    try {
      await createOrderTx(admin, {
        orderId, userId, items: gstItems, orderStatus: "delivered", paymentStatus: safeStatus, paymentMethod: safeMethod, source: "billing",
        customerName: userName, customerEmail: userEmail, customerPhone: userPhone, address: userAddress ?? "In-Store",
        subtotal: subtotalRounded, shipping: 0,
        cgst: gstTotals.totalCgst, sgst: gstTotals.totalSgst, igst: gstTotals.totalIgst,
        promoCode: appliedPromoCode, promoDiscount, total,
      });
    } catch (e) {
      if (e instanceof StockError) {
        return jsonResponse(req, 409, { success: false, error: e.message });
      }
      throw e;
    }

    return jsonResponse(req, 200, {
      success: true,
      orderId,
      order: {
        orderId, id: orderId, userId, userName, userEmail, userPhone,
        userAddress: "In-Store Pickup", shippingAddress: "In-Store Pickup",
        subtotal: subtotalRounded, shipping: 0, promoDiscount, promoCode: appliedPromoCode,
        manualDiscount: manualDiscountAmount, manualDiscountType: safeDiscType, total, totalItems,
        taxableTotal: gstTotals.taxableTotal, totalCgst: gstTotals.totalCgst, totalSgst: gstTotals.totalSgst, totalIgst: gstTotals.totalIgst,
        isInterState, paymentMethod: safeMethod, paymentStatus: safeStatus, orderStatus: "delivered", source: "billing",
        createdAt: new Date().toISOString(), products: gstItems, isGuest,
      },
    });
  } catch (err) {
    console.error("[orders-billing-create] failed:", err);
    if (err instanceof StockError) {
      return jsonResponse(req, 409, { success: false, error: err.message });
    }
    return jsonResponse(req, 500, { success: false, error: "Failed to create bill" });
  }
});
