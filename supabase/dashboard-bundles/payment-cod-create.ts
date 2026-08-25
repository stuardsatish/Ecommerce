// ============================================================================
// payment-cod-create — SELF-CONTAINED Dashboard bundle.
// Paste this whole file as the function's index.ts in the Supabase Dashboard
// (Edge Functions -> Deploy a new function -> name it "payment-cod-create").
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
async function isUserBlocked(admin: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.from("profiles").select("status").eq("id", userId).maybeSingle();
    if (error || !data) return false;
    return data.status === "blocked" || data.status === "suspended";
  } catch (e) {
    console.error("[isUserBlocked] error:", e);
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

/* ============================== rateLimit.ts ============================== */
async function rateLimit(admin: SupabaseClient, key: string, max: number, windowMs: number, opts: { failOpen?: boolean } = {}): Promise<boolean> {
  const { failOpen = false } = opts;
  try {
    const { data, error } = await admin.rpc("rate_limit_check", { p_key: key, p_max: max, p_window_seconds: Math.round(windowMs / 1000) });
    if (error) throw error;
    return !!data;
  } catch (e) {
    console.error("[rateLimit] error:", e);
    return failOpen;
  }
}
async function globalDailyLimit(admin: SupabaseClient, name: string, max: number, day: string): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("rate_limit_check", { p_key: `global-${name}-${day}`, p_max: max, p_window_seconds: 86400 });
    if (error) throw error;
    return !!data;
  } catch (e) {
    console.error("[globalDailyLimit] error:", e);
    return false;
  }
}

/* ============================== pricing.ts ============================== */
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
function activeProductDiscount(p: { discount?: number; discount_expiry?: string | null }): number {
  const raw = Number(p.discount || 0);
  if (raw > 0 && p.discount_expiry) {
    const expiryMs = new Date(p.discount_expiry).getTime();
    if (!isNaN(expiryMs) && Date.now() > expiryMs) return 0;
  }
  return raw;
}
type ProductRow = {
  id: string; title: string | null; category: string | null; sku: string | null; price: number; stock: number;
  discount: number; discount_expiry: string | null; gst_rate: number; hsn_code: string | null;
};
type PriceItemsResult = { ok: true; lineItems: LineItem[]; subtotal: number } | { ok: false; status: number; error: string };
function priceCartItems(items: Array<{ productId?: string; quantity?: number }>, productsById: Map<string, ProductRow>): PriceItemsResult {
  const lineItems: LineItem[] = [];
  let subtotal = 0;
  for (const it of items) {
    const pid = String(it?.productId || "");
    const qty = Math.floor(Number(it?.quantity) || 0);
    if (!pid || qty <= 0) return { ok: false, status: 400, error: "Invalid cart item" };
    const p = productsById.get(pid);
    if (!p) return { ok: false, status: 400, error: `Product not found: ${pid}` };
    const price = Number(p.price || 0);
    const stock = Number(p.stock || 0);
    if (price <= 0) return { ok: false, status: 400, error: `Product not purchasable: ${p.title || pid}` };
    if (stock < qty) return { ok: false, status: 409, error: `Not enough stock for ${p.title || pid}` };
    const finalDiscount = activeProductDiscount(p);
    const finalPrice = price - (price * finalDiscount) / 100;
    subtotal += finalPrice * qty;
    lineItems.push({
      productId: pid, title: p.title || "Product", category: p.category || "general", quantity: qty,
      originalPrice: price, discount: finalDiscount, finalPrice, gstRate: Number(p.gst_rate || 0), hsnCode: p.hsn_code || "",
    });
  }
  return { ok: true, lineItems, subtotal };
}
async function getShippingConfig(admin: SupabaseClient): Promise<{ threshold: number; fee: number }> {
  let threshold = 500, fee = 49;
  try {
    const { data, error } = await admin.from("settings").select("data").eq("id", "shippingSettings").maybeSingle();
    if (!error && data?.data) {
      const sd = data.data;
      if (typeof sd.freeShippingThreshold === "number") threshold = sd.freeShippingThreshold;
      if (typeof sd.shippingCost === "number") fee = sd.shippingCost;
    }
  } catch (e) { console.warn("[pricing] shipping settings lookup failed, using defaults:", e); }
  return { threshold, fee };
}
async function getSellerState(admin: SupabaseClient): Promise<string> {
  try {
    const { data, error } = await admin.from("settings").select("data").eq("id", "invoiceSettings").maybeSingle();
    if (error || !data?.data) return "";
    return data.data.state || "";
  } catch (e) { console.warn("[pricing] seller state lookup failed:", e); return ""; }
}
async function isCodEnabled(admin: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await admin.from("settings").select("data").eq("id", "paymentSettings").maybeSingle();
    if (error || !data?.data) return true;
    return data.data.codPayment !== false;
  } catch (e) { console.warn("[pricing] payment settings lookup failed:", e); return true; }
}
type PromoResult = { discount: number; appliedCode: string };
async function resolvePromoDiscount(admin: SupabaseClient, promoCode: string | undefined, subtotal: number): Promise<PromoResult> {
  if (!promoCode || typeof promoCode !== "string" || !promoCode.trim()) return { discount: 0, appliedCode: "" };
  const code = promoCode.trim().toUpperCase();
  try {
    const { data: pd, error } = await admin.from("promo_codes").select("*").eq("code", code).maybeSingle();
    if (error || !pd) return { discount: 0, appliedCode: "" };
    if (isPromoExpired(pd.expiry_date)) return { discount: 0, appliedCode: "" };
    const value = Number(pd.value || 0);
    let discount = 0;
    if (pd.type === "percent") discount = Math.round((subtotal * value) / 100);
    else if (pd.type === "flat") discount = value;
    discount = Math.max(0, discount);
    return { discount, appliedCode: code };
  } catch (e) { console.warn("[pricing] promo lookup failed:", e); return { discount: 0, appliedCode: "" }; }
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
// Port of functions/routes/payment.js POST /cod-create.
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

    if (!(await isCodEnabled(admin))) {
      return jsonResponse(req, 400, { success: false, error: "Cash on Delivery is currently disabled." });
    }

    if (!auth.user.email_confirmed_at) {
      return jsonResponse(req, 403, { success: false, error: "Email not verified. Please verify your email before checking out." });
    }

    const { data: profile, error: profileErr } = await admin
      .from("profiles").select("name, email, phone, address").eq("id", userId).maybeSingle();
    if (profileErr) throw profileErr;
    if (!profile) {
      return jsonResponse(req, 404, { success: false, error: "User account not found" });
    }
    const addr = profile.address || {};
    const street = typeof addr === "string" ? addr : addr.street;
    if (!street || !String(street).trim()) {
      return jsonResponse(req, 400, { success: false, error: "Delivery address is required for COD orders. Please update your profile address." });
    }

    const pids = [...new Set(items.map((i: any) => String(i?.productId || "")).filter(Boolean))];
    const { data: productRows, error: productErr } = await admin.from("products").select("*").in("id", pids);
    if (productErr) throw productErr;
    const productsById = new Map<string, ProductRow>((productRows || []).map((p: ProductRow) => [p.id, p]));

    const priced = priceCartItems(items, productsById);
    if (!priced.ok) return jsonResponse(req, priced.status, { success: false, error: priced.error });
    const { lineItems, subtotal } = priced;

    const { discount: promoDiscount, appliedCode: appliedPromoCode } = await resolvePromoDiscount(admin, promoCode, subtotal);

    const { threshold, fee } = await getShippingConfig(admin);
    const shipping = subtotal >= threshold ? 0 : fee;

    const subtotalRounded = Math.round(subtotal);
    const total = Math.max(0, Math.round(subtotalRounded + shipping - promoDiscount));
    if (total <= 0) {
      return jsonResponse(req, 400, { success: false, error: "Invalid order total" });
    }

    const buyerState = typeof addr === "object" ? addr?.state || "" : "";
    const sellerState = await getSellerState(admin);
    const isInterState = resolveInterState(buyerState, sellerState);
    const gstItems = applyGstToItems(lineItems, isInterState);
    const gstTotals = sumGstTotals(gstItems);

    const orderId = `cod_${crypto.randomUUID()}`;
    try {
      await createOrderTx(admin, {
        orderId, userId, items: gstItems, orderStatus: "placed", paymentStatus: "pending", paymentMethod: "COD", source: "online",
        customerName: profile.name || "Customer", customerEmail: profile.email || "", customerPhone: profile.phone || "",
        address: profile.address ?? null, subtotal: subtotalRounded, shipping,
        cgst: gstTotals.totalCgst, sgst: gstTotals.totalSgst, igst: gstTotals.totalIgst,
        promoCode: appliedPromoCode, promoDiscount, total,
      });
    } catch (e) {
      if (e instanceof StockError) return jsonResponse(req, 409, { success: false, error: e.message });
      throw e;
    }

    return jsonResponse(req, 200, { success: true, orderId });
  } catch (err) {
    console.error("[payment-cod-create] failed:", err);
    return jsonResponse(req, 500, { success: false, error: (err as Error).message || "Failed to place COD order" });
  }
});
