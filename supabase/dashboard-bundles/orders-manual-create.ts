// ============================================================================
// orders-manual-create — SELF-CONTAINED Dashboard bundle.
// Paste this whole file as the function's index.ts in the Supabase Dashboard
// (Edge Functions -> Deploy a new function -> name it "orders-manual-create").
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
// Port of functions/routes/orders.js POST /manual-create.
const PRICE_TOLERANCE = 1;

type ParsedItem = { title: string; quantity: number; mrp: number; discountPct: number; discountedPrice: number };
type ParsedMessage = {
  customerId: string; customerName: string; email: string; phone: string; items: ParsedItem[]; totalItems: number;
  subtotal: number; shipping: number; promoCode: string; promoDiscount: number; totalAmount: number;
};

function parseWhatsAppMessage(text: string): ParsedMessage {
  const cleanText = text.replace(/\*+/g, "");
  const lines = cleanText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const result: ParsedMessage = {
    customerId: "", customerName: "", email: "", phone: "",
    items: [], totalItems: 0,
    subtotal: 0, shipping: 0, promoCode: "", promoDiscount: 0, totalAmount: 0,
  };

  const pick = (line: string) => line.slice(line.toLowerCase().indexOf(":") + 1).trim();
  const parsePrice = (str: string) => parseFloat(String(str).replace(/[^-0-9.]/g, "")) || 0;

  for (const line of lines) {
    const lc = line.toLowerCase();
    if (lc.startsWith("customer id:")) result.customerId = pick(line);
    else if (lc.startsWith("customer name:")) result.customerName = pick(line);
    else if (lc.startsWith("email:")) result.email = pick(line);
    else if (lc.startsWith("phone:")) result.phone = pick(line);
    else if (/^total items\s*:/.test(lc)) result.totalItems = parseInt(pick(line), 10) || 0;
    else if (/^subtotal\s*:/.test(lc)) result.subtotal = parsePrice(pick(line));
    else if (/^shipping\s*:/.test(lc)) result.shipping = parsePrice(pick(line));
    else if (/^promo code\s*:/.test(lc)) {
      const v = pick(line);
      result.promoCode = v === "None" || v === "none" ? "" : v;
    } else if (/^promo discount\s*:/.test(lc)) result.promoDiscount = parsePrice(pick(line));
    else if (/^total amount\s*:/.test(lc)) result.totalAmount = parsePrice(pick(line));
  }

  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(/^(\d+)[.)\s]+(.+)$/);
    if (match) {
      const title = match[2].trim();
      let quantity = 0, mrp = 0, discountPct = 0, discountedPrice = 0, legacyPrice = 0;
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
          title, quantity, mrp: mrp || legacyPrice, discountPct,
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
    const { message, paymentStatus = "paid", allowPriceOverride = false } = body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return jsonResponse(req, 400, { success: false, error: "Order message is required" });
    }
    const safeStatus = paymentStatus === "pending" ? "pending" : "paid";

    const parsed = parseWhatsAppMessage(message);
    if (!parsed.items.length) {
      return jsonResponse(req, 400, { success: false, error: "No items found in the message." });
    }
    if (!parsed.customerId && !parsed.email) {
      return jsonResponse(req, 400, { success: false, error: "Could not find Customer ID or Email in the message." });
    }
    if (!parsed.totalAmount) {
      return jsonResponse(req, 400, { success: false, error: "Could not extract Total Amount from the message." });
    }

    let userId: string | null = null;
    let userName = "", userEmail = "", userPhone = "", userAddress: unknown = null;
    let isGuest = false;

    if (parsed.customerId) {
      const { data: p } = await admin.from("profiles").select("*").eq("id", parsed.customerId).maybeSingle();
      if (p) {
        userId = parsed.customerId;
        userName = p.name || parsed.customerName || "User";
        userEmail = p.email || parsed.email || "";
        userPhone = p.phone || parsed.phone || "";
        userAddress = p.address ?? null;
      }
    }
    if (!userId && parsed.email) {
      const { data: p } = await admin.from("profiles").select("*").eq("email", parsed.email).limit(1).maybeSingle();
      if (p) {
        userId = p.id;
        userName = p.name || parsed.customerName || "User";
        userEmail = p.email || parsed.email || "";
        userPhone = p.phone || parsed.phone || "";
        userAddress = p.address ?? null;
      }
    }
    if (!userId) {
      isGuest = true;
      userName = parsed.customerName || "Guest";
      userEmail = parsed.email || "";
      userPhone = parsed.phone || "";
    }

    const { data: allProducts, error: catalogErr } = await admin.from("products").select("*");
    if (catalogErr) throw catalogErr;

    const resolvedItems: LineItem[] = [];
    const errors: string[] = [];

    for (const item of parsed.items) {
      const needle = item.title.toLowerCase().trim();
      let matches = (allProducts || []).filter((p: any) => typeof p.title === "string" && p.title.toLowerCase() === needle);
      if (!matches.length) {
        matches = (allProducts || []).filter((p: any) => typeof p.title === "string" && p.title.toLowerCase().startsWith(needle));
      }

      if (!matches.length) {
        errors.push(`Product not found: "${item.title}"`);
      } else if (matches.length > 1) {
        errors.push(`Ambiguous product title "${item.title}". Matches: ${matches.map((p: any) => p.title).join(", ")}`);
      } else {
        const p = matches[0];
        const catalogPrice = Number(p.price) || 0;
        const rawProductDiscount = Number(p.discount || 0);

        let productDiscount = rawProductDiscount;
        if (rawProductDiscount > 0 && p.discount_expiry) {
          const expiryMs = new Date(p.discount_expiry).getTime();
          if (!isNaN(expiryMs) && Date.now() > expiryMs) productDiscount = 0;
        }

        const catalogDiscount = productDiscount;
        const catalogFinalPrice = catalogPrice - (catalogPrice * catalogDiscount) / 100;

        const waUnitPrice = Number(item.discountedPrice) > 0 ? Number(item.discountedPrice) : catalogFinalPrice;
        const finalPrice = allowPriceOverride ? waUnitPrice : catalogFinalPrice;

        resolvedItems.push({
          productId: p.id,
          title: p.title,
          category: p.category || "general",
          quantity: item.quantity,
          originalPrice: allowPriceOverride ? item.mrp || catalogPrice : catalogPrice,
          discount: allowPriceOverride ? item.discountPct || 0 : catalogDiscount,
          finalPrice,
          gstRate: Number(p.gst_rate || 0),
          hsnCode: p.hsn_code || "",
        });
      }
    }

    if (errors.length) {
      return jsonResponse(req, 400, { success: false, error: errors.join("\n") });
    }

    const serverSubtotal = Math.round(resolvedItems.reduce((s, it) => s + it.finalPrice * it.quantity, 0) * 100) / 100;
    const msgShipping = Number(parsed.shipping) || 0;
    const msgPromoDiscount = Number(parsed.promoDiscount) || 0;
    const serverTotal = Math.max(0, Math.round(serverSubtotal + msgShipping - msgPromoDiscount));
    const pastedTotal = Math.round(Number(parsed.totalAmount) || 0);
    const priceMismatch = Math.abs(serverTotal - pastedTotal) > PRICE_TOLERANCE;

    if (priceMismatch && !allowPriceOverride) {
      return jsonResponse(req, 409, {
        success: false,
        code: "PRICE_MISMATCH",
        error: `The pasted total (₹${pastedTotal}) does not match the catalog total (₹${serverTotal}). Review the order and re-submit with confirmation to override.`,
        serverTotal,
        pastedTotal,
      });
    }
    const recordedTotal = priceMismatch ? pastedTotal : serverTotal;

    const sellerState = await getSellerState(admin);
    const buyerState = (userAddress as any)?.state || "";
    const isInterState = resolveInterState(buyerState, sellerState);
    const gstItems = applyGstToItems(resolvedItems, isInterState);
    const gstTotals = sumGstTotals(gstItems);
    const totalItems = resolvedItems.reduce((s, it) => s + it.quantity, 0);

    const orderId = `wa_${crypto.randomUUID()}`;
    try {
      await createOrderTx(admin, {
        orderId, userId, items: gstItems, orderStatus: "placed", paymentStatus: safeStatus, paymentMethod: "WhatsApp", source: "manual",
        customerName: userName, customerEmail: userEmail, customerPhone: userPhone, address: userAddress,
        subtotal: serverSubtotal, shipping: msgShipping,
        cgst: gstTotals.totalCgst, sgst: gstTotals.totalSgst, igst: gstTotals.totalIgst,
        promoCode: parsed.promoCode || "", promoDiscount: msgPromoDiscount, total: recordedTotal,
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
      parsedOrder: {
        customerId: userId, customerName: userName, email: userEmail, phone: userPhone,
        itemCount: resolvedItems.length, totalItems, total: parsed.totalAmount, paymentStatus: safeStatus, isGuest,
      },
    });
  } catch (err) {
    console.error("[orders-manual-create] failed:", err);
    if (err instanceof StockError) {
      return jsonResponse(req, 409, { success: false, error: err.message });
    }
    return jsonResponse(req, 500, { success: false, error: "Failed to create order" });
  }
});
