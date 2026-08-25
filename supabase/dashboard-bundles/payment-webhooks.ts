// ============================================================================
// payment-webhook — SELF-CONTAINED Dashboard bundle.
// Paste this whole file as the function's index.ts in the Supabase Dashboard
// (Edge Functions -> Deploy a new function -> name it "payment-webhook").
// IMPORTANT: after creating this function in the Dashboard, open its Settings
// and turn OFF "Enforce JWT Verification" — Razorpay calls this directly with
// its own HMAC signature, not a Supabase session token, so the platform's
// default JWT check would reject it before this code ever runs.
// ============================================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

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
function rawResponse(req: Request, status: number, body: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, ...corsHeaders(req), ...extraHeaders } });
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
  return rawResponse(req, 405, JSON.stringify({ success: false, error: "Method not allowed" }));
}

/* ============================== clients.ts (supabaseAdmin only) ============================== */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
let _admin: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  return _admin;
}

/* ============================== razorpay.ts (verifyWebhookSignature only) ============================== */
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
async function verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";
  if (!secret) return false;
  const expected = await hmacHex(secret, rawBody);
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
    const e = new Error("This order belongs to a different account");
    (e as any).code = "FORBIDDEN";
    throw e;
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
// Port of functions/routes/payment.js POST /webhook.
Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const methodErr = methodNotAllowed(req, ["POST"]);
  if (methodErr) return methodErr;

  const admin = supabaseAdmin();

  try {
    const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    if (!secret) {
      console.error("[payment-webhook] webhook secret not configured");
      return rawResponse(req, 500, "webhook not configured");
    }
    const signature = req.headers.get("x-razorpay-signature");
    const { raw, json: body } = await readBody(req);
    if (!raw || !signature) {
      return rawResponse(req, 400, "missing signature/body");
    }

    const verified = await verifyWebhookSignature(raw, signature);
    if (!verified) {
      return rawResponse(req, 400, "invalid signature");
    }

    const event = body?.event;
    if (event === "payment.captured" || event === "order.paid") {
      const payment = body?.payload?.payment?.entity || {};
      const orderId = payment.order_id;
      const paymentId = payment.id;
      if (orderId && paymentId) {
        try {
          await finalizeOrder(admin, orderId, paymentId);
        } catch (e) {
          if (!(e instanceof NoPendingError)) throw e;
        }
      }
    }
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[payment-webhook] error:", err);
    return rawResponse(req, 500, "error");
  }
});
