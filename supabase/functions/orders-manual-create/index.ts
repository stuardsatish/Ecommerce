// Port of functions/routes/orders.js POST /manual-create.
// Admin pastes a WhatsApp order message; this parses it, resolves the
// customer + products against the live catalog, validates the pasted total
// against the server-recomputed one, and writes the order via create_order_tx.
import { handlePreflight, jsonResponse, methodNotAllowed, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { requireAdmin, isFeatureKilled } from "../_shared/auth.ts";
import { applyGstToItems, getSellerState, resolveInterState, sumGstTotals, type LineItem } from "../_shared/pricing.ts";
import { createOrderTx, StockError } from "../_shared/orderWriter.ts";

// Max rupee gap tolerated between the admin-supplied total and the total the
// server recomputes from the live catalog before it demands explicit override.
const PRICE_TOLERANCE = 1;

/* ──────────────────────────────────────────────────────────────────────────
   PARSER — verbatim port of orders.js's parseWhatsAppMessage(). Handles the
   exact format emitted by CartPage.jsx's sendOrderToWhatsApp().
────────────────────────────────────────────────────────────────────────── */
type ParsedItem = { title: string; quantity: number; mrp: number; discountPct: number; discountedPrice: number };
type ParsedMessage = {
  customerId: string;
  customerName: string;
  email: string;
  phone: string;
  items: ParsedItem[];
  totalItems: number;
  subtotal: number;
  shipping: number;
  promoCode: string;
  promoDiscount: number;
  totalAmount: number;
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
          title,
          quantity,
          mrp: mrp || legacyPrice,
          discountPct,
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

    // ── 1. Parse ──────────────────────────────────────────────────────────
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

    // ── 2. Resolve customer ──────────────────────────────────────────────
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
    // Guest fallback — no matching profile. orders.user_id is a real uuid FK
    // (`on delete set null` — "null for guest/walk-in" per 01-schema.sql), so
    // a guest order carries userId:null and relies on the denormalized
    // customer_name/email/phone columns instead of a synthetic pseudo-id.
    if (!userId) {
      isGuest = true;
      userName = parsed.customerName || "Guest";
      userEmail = parsed.email || "";
      userPhone = parsed.phone || "";
    }

    // ── 3. Resolve products (fetch all, match in-memory — same as the original) ──
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

        // Respect discount_expiry on the server — same logic as the frontend's isDiscountActive().
        let productDiscount = rawProductDiscount;
        if (rawProductDiscount > 0 && p.discount_expiry) {
          const expiryMs = new Date(p.discount_expiry).getTime();
          if (!isNaN(expiryMs) && Date.now() > expiryMs) productDiscount = 0;
        }

        const catalogDiscount = productDiscount; // no separate category_discount column post-migration
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

    // ── 3b. Price integrity check ─────────────────────────────────────────
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

    // GST breakdown — buyer state from the resolved profile (guests have none).
    const sellerState = await getSellerState(admin);
    const buyerState = (userAddress as any)?.state || "";
    const isInterState = resolveInterState(buyerState, sellerState);
    const gstItems = applyGstToItems(resolvedItems, isInterState);
    const gstTotals = sumGstTotals(gstItems);
    const totalItems = resolvedItems.reduce((s, it) => s + it.quantity, 0);

    const orderId = `wa_${crypto.randomUUID()}`;
    try {
      await createOrderTx(admin, {
        orderId,
        userId,
        items: gstItems,
        orderStatus: "placed",
        paymentStatus: safeStatus,
        paymentMethod: "WhatsApp",
        source: "manual",
        customerName: userName,
        customerEmail: userEmail,
        customerPhone: userPhone,
        address: userAddress,
        subtotal: serverSubtotal,
        shipping: msgShipping,
        cgst: gstTotals.totalCgst,
        sgst: gstTotals.totalSgst,
        igst: gstTotals.totalIgst,
        promoCode: parsed.promoCode || "",
        promoDiscount: msgPromoDiscount,
        total: recordedTotal,
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
        customerId: userId,
        customerName: userName,
        email: userEmail,
        phone: userPhone,
        itemCount: resolvedItems.length,
        totalItems,
        total: parsed.totalAmount,
        paymentStatus: safeStatus,
        isGuest,
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