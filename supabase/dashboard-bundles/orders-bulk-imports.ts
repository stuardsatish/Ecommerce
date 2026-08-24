// ============================================================================
// orders-bulk-import — SELF-CONTAINED Dashboard bundle.
// Paste this whole file as the function's index.ts in the Supabase Dashboard
// (Edge Functions -> Deploy a new function -> name it "orders-bulk-import").
// ============================================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/* ============================== cors.ts ============================== */
const DEFAULT_ORIGINS = [
  "https://e-commerce-demo-website1.web.app",
  "https://e-commerce-demo-website1.firebaseapp.com",
  "https://my-sweet-bec4a.web.app",
  "https://my-sweet-bec4a.firebaseapp.com",
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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
const MAX_BODY_BYTES = 256 * 1024; // larger than the usual 64kb — a 5,000-row batch is a bigger JSON payload than a single order.
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

/* ============================== auth.ts (requireAdmin + isFeatureKilled) ============================== */
type AuthResult = { user: any; error: null } | { user: null; error: Response };
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

/* ============================== pricing.ts (GST helpers only) ============================== */
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
type LineItem = {
  productId: string; title: string; category: string; quantity: number;
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
  } catch (e) {
    console.warn("[pricing] seller state lookup failed:", e);
    return "";
  }
}

/* ============================== orderWriter.ts ============================== */
type CreateOrderParams = {
  orderId: string; userId: string | null; items: GstLineItem[]; orderStatus: string; paymentStatus: string;
  paymentMethod: string; source: string; customerName: string; customerEmail: string; customerPhone: string;
  address: unknown; subtotal: number; shipping: number; cgst: number; sgst: number; igst: number;
  promoCode: string; promoDiscount: number; total: number;
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
    p_razorpay_order_id: null, p_razorpay_payment_id: null,
  });
  if (error) {
    if (/insufficient stock/i.test(error.message || "")) throw new StockError(error.message);
    throw error;
  }
  return data;
}

/* ============================== function logic (index.ts) ============================== */
// Port of AdminUploadOrders.jsx's Firestore bulk-import writer. Admin uploads
// a CSV of historical orders; this validates rows, matches each "product"
// cell against the live catalog, groups rows by order_id, and writes one
// order per group via create_order_tx — same atomic path every other
// order-creation route uses. One bad group never blocks the rest of the batch.
const MAX_ROWS = 5000;

type CsvRow = {
  order_id: string; customer_id?: string; customer_email?: string; customer_name?: string;
  product: string; price: number | string; qty: number | string; status?: string;
};
type RowResult = { externalOrderId: string; status: "created" | "failed"; orderId?: string; itemCount?: number; total?: number; error?: string };

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
    const { rows, paymentStatus = "paid" } = body || {};
    if (!Array.isArray(rows) || !rows.length) {
      return jsonResponse(req, 400, { success: false, error: "No rows to import" });
    }
    if (rows.length > MAX_ROWS) {
      return jsonResponse(req, 400, { success: false, error: `Too many rows — max ${MAX_ROWS} per batch` });
    }
    const safeStatus = paymentStatus === "pending" ? "pending" : "paid";

    const groups = new Map<string, CsvRow[]>();
    const rowErrors: string[] = [];
    (rows as CsvRow[]).forEach((r, i) => {
      const orderId = String(r.order_id || "").trim();
      const price = Number(r.price);
      const qty = Number(r.qty);
      if (!orderId) { rowErrors.push(`Row ${i + 1}: missing order_id`); return; }
      if (!r.customer_id && !r.customer_email) { rowErrors.push(`Row ${i + 1} (${orderId}): missing customer_id/customer_email`); return; }
      if (!r.product || !String(r.product).trim()) { rowErrors.push(`Row ${i + 1} (${orderId}): missing product`); return; }
      if (!(price > 0)) { rowErrors.push(`Row ${i + 1} (${orderId}): invalid price`); return; }
      if (!(qty > 0)) { rowErrors.push(`Row ${i + 1} (${orderId}): invalid qty`); return; }
      const list = groups.get(orderId) || [];
      list.push(r);
      groups.set(orderId, list);
    });

    const { data: allProducts, error: catalogErr } = await admin.from("products").select("*");
    if (catalogErr) throw catalogErr;
    const sellerState = await getSellerState(admin);

    const matchProduct = (title: string) => {
      const needle = title.toLowerCase().trim();
      let matches = (allProducts || []).filter((p: any) => typeof p.title === "string" && p.title.toLowerCase() === needle);
      if (!matches.length) matches = (allProducts || []).filter((p: any) => typeof p.title === "string" && p.title.toLowerCase().startsWith(needle));
      return matches;
    };

    const results: RowResult[] = [];

    for (const [externalOrderId, groupRows] of groups) {
      try {
        const master = groupRows[0];

        let userId: string | null = null;
        let userName = master.customer_name || "Imported Customer";
        let userEmail = master.customer_email || "";
        let userAddress: unknown = null;

        if (master.customer_id) {
          const { data: p } = await admin.from("profiles").select("*").eq("id", master.customer_id).maybeSingle();
          if (p) { userId = p.id; userName = p.name || userName; userEmail = p.email || userEmail; userAddress = p.address ?? null; }
        }
        if (!userId && master.customer_email) {
          const { data: p } = await admin.from("profiles").select("*").eq("email", master.customer_email).maybeSingle();
          if (p) { userId = p.id; userName = p.name || userName; userEmail = p.email || userEmail; userAddress = p.address ?? null; }
        }

        const lineItems: LineItem[] = [];
        for (const r of groupRows) {
          const matches = matchProduct(String(r.product));
          if (matches.length !== 1) {
            throw new Error(matches.length === 0 ? `Product not found: "${r.product}"` : `Ambiguous product "${r.product}"`);
          }
          const p = matches[0];
          const price = Number(r.price);
          lineItems.push({
            productId: p.id, title: p.title, category: p.category || "general",
            quantity: Math.floor(Number(r.qty)), originalPrice: price, discount: 0, finalPrice: price,
            gstRate: Number(p.gst_rate || 0), hsnCode: p.hsn_code || "",
          });
        }

        const buyerState = (userAddress as any)?.state || "";
        const isInterState = resolveInterState(buyerState, sellerState);
        const gstItems = applyGstToItems(lineItems, isInterState);
        const gstTotals = sumGstTotals(gstItems);
        const subtotal = round2(lineItems.reduce((s, it) => s + it.finalPrice * it.quantity, 0));
        const total = Math.round(subtotal);

        const orderId = `import_${crypto.randomUUID()}`;
        await createOrderTx(admin, {
          orderId, userId, items: gstItems,
          orderStatus: (master.status || "delivered").toLowerCase(),
          paymentStatus: safeStatus, paymentMethod: "Imported", source: "manual",
          customerName: userName, customerEmail: userEmail, customerPhone: "", address: userAddress,
          subtotal, shipping: 0, cgst: gstTotals.totalCgst, sgst: gstTotals.totalSgst, igst: gstTotals.totalIgst,
          promoCode: "", promoDiscount: 0, total,
        });

        results.push({ externalOrderId, status: "created", orderId, itemCount: lineItems.length, total });
      } catch (e) {
        results.push({ externalOrderId, status: "failed", error: e instanceof StockError ? e.message : (e as Error).message || "Import failed" });
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    const failed = results.length - created;

    return jsonResponse(req, 200, { success: true, results, rowErrors, created, failed, recordCount: rows.length });
  } catch (err) {
    console.error("[orders-bulk-import] failed:", err);
    return jsonResponse(req, 500, { success: false, error: "Bulk import failed" });
  }
});