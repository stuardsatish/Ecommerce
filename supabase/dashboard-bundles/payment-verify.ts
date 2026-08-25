// ============================================================================
// payment-verify — SELF-CONTAINED Dashboard bundle.
// Paste this whole file as the function's index.ts in the Supabase Dashboard
// (Edge Functions -> Deploy a new function -> name it "payment-verify").
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

/* ============================== auth.ts (requireAuth only) ============================== */
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

/* ============================== rateLimit.ts (rateLimit only) ============================== */
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

/* ============================== razorpay.ts (verifyPaymentSignature only) ============================== */
async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}
async function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): Promise<boolean> {
  const secret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
  const expected = await hmacHex(secret, `${orderId}|${paymentId}`);
  return timingSafeEqual(expected, String(signature));
}

/* ============================== pricing.ts (round2 + GstLineItem type only) ============================== */
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
type LineItem = {
  productId: string; title: string; category: string; sku?: string; quantity: number;
  originalPrice: number; discount: number; finalPrice: number; gstRate: number; hsnCode: string;
};
type GstLineItem = LineItem & { taxableValue: number; gstAmount: number; cgstAmount: number; sgstAmount: number; igstAmount: number };

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

/* ============================== finalizeOrder.ts ============================== */
class NoPendingError extends Error { code = "NO_PENDING"; }
class ForbiddenError extends Error { code = "FORBIDDEN"; }

type PendingPayload = {
  userId: string; items: GstLineItem[]; subtotal: number; shipping: number; promoDiscount: number; promoCode: string;
  total: number; taxableTotal: number; totalCgst: number; totalSgst: number; totalIgst: number; isInterState: boolean;
};

async function finalizeOrder(admin: SupabaseClient, razorpayOrderId: string, razorpayPaymentId: string, expectedUid?: string) {
  const { data: pendingRow, error: pendingErr } = await admin.from("pending_orders").select("*").eq("id", razorpayOrderId).maybeSingle();
  if (pendingErr) throw pendingErr;
  if (!pendingRow) throw new NoPendingError("Order session expired or already processed");

  const pending = pendingRow.payload as PendingPayload;

  if (expectedUid && pending.userId !== expectedUid) {
    throw new ForbiddenError("This order belongs to a different account");
  }

  const { data: profile } = await admin.from("profiles").select("name, email, phone, address").eq("id", pending.userId).maybeSingle();

  const order = await createOrderTx(admin, {
    orderId: razorpayOrderId, userId: pending.userId, items: pending.items, orderStatus: "placed", paymentStatus: "paid",
    paymentMethod: "Razorpay", source: "online",
    customerName: profile?.name || "User", customerEmail: profile?.email || "", customerPhone: profile?.phone || "",
    address: profile?.address ?? null, subtotal: pending.subtotal, shipping: pending.shipping,
    cgst: pending.totalCgst, sgst: pending.totalSgst, igst: pending.totalIgst,
    promoCode: pending.promoCode, promoDiscount: pending.promoDiscount, total: pending.total,
    razorpayOrderId, razorpayPaymentId,
  });

  await admin.from("pending_orders").update({ status: "finalized" }).eq("id", razorpayOrderId);

  return order.id as string;
}

/* ============================== function logic (index.ts) ============================== */
// Port of functions/routes/payment.js POST /verify.
Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const methodErr = methodNotAllowed(req, ["POST"]);
  if (methodErr) return methodErr;

  const admin = supabaseAdmin();

  try {
    const auth = await requireAuth(req);
    if (!auth.user) return auth.error;

    if (!(await rateLimit(admin, `verify:${auth.user.id}`, 30, 60000, { failOpen: false }))) {
      return jsonResponse(req, 429, { success: false, verified: false, error: "Too many requests. Please wait a moment." });
    }

    const { json: body } = await readBody(req);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return jsonResponse(req, 400, { success: false, verified: false, error: "Missing payment fields" });
    }

    const verified = await verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!verified) {
      return jsonResponse(req, 400, { success: false, verified: false, error: "Invalid signature" });
    }

    const orderId = await finalizeOrder(admin, razorpay_order_id, razorpay_payment_id, auth.user.id);
    return jsonResponse(req, 200, { success: true, verified: true, paymentId: razorpay_payment_id, orderId });
  } catch (err) {
    console.error("[payment-verify] failed:", err);
    const status = err instanceof StockError ? 409 : err instanceof NoPendingError ? 410 : err instanceof ForbiddenError ? 403 : 500;
    return jsonResponse(req, status, { success: false, verified: false, error: (err as Error).message || "Could not finalize order" });
  }
});
