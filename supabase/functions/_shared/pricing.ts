// Port of functions/lib/orderWriter.js's GST helpers + functions/routes/payment.js's
// discount/shipping/promo logic. This is exact financial math — keep every
// formula, rounding rule and check order identical to the source. Buyer state
// now comes from `profiles.address->>'state'`, seller state from the
// `invoiceSettings` row's `data->>'state'` (both were Firestore doc fields
// before).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isPromoExpired } from "./auth.ts";

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export type LineItem = {
  productId: string;
  title: string;
  category: string;
  sku?: string;
  quantity: number;
  originalPrice: number;
  discount: number;
  finalPrice: number;
  gstRate: number;
  hsnCode: string;
};

export type GstLineItem = LineItem & {
  taxableValue: number;
  gstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
};

/** Per-UNIT taxable value + gst amount for a GST-inclusive unit price. */
export function unitGst(finalPrice: number, gstRate: number): { taxableValue: number; gstAmount: number } {
  const price = Number(finalPrice) || 0;
  const rate = Number(gstRate) || 0;
  if (rate <= 0) return { taxableValue: round2(price), gstAmount: 0 };
  const taxableValue = round2((price * 100) / (100 + rate));
  const gstAmount = round2(price - taxableValue);
  return { taxableValue, gstAmount };
}

/**
 * Enrich each line item with GST fields. CGST=ceil, SGST=floor so the two
 * always sum to the line's GST exactly (matches orderWriter.js).
 */
export function applyGstToItems(items: LineItem[], isInterState: boolean): GstLineItem[] {
  return (items || []).map((it) => {
    const rate = Number(it.gstRate) || 0;
    const qty = Number(it.quantity) || 0;
    const { taxableValue, gstAmount } = unitGst(it.finalPrice, rate);
    const lineGst = round2(gstAmount * qty);
    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
    if (isInterState) {
      igstAmount = lineGst;
    } else {
      cgstAmount = Math.ceil((lineGst / 2) * 100) / 100;
      sgstAmount = Math.floor((lineGst / 2) * 100) / 100;
    }
    return {
      ...it,
      gstRate: rate,
      hsnCode: it.hsnCode || "",
      taxableValue,
      gstAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
    };
  });
}

/** Sum GST-enriched line items into order-level totals. */
export function sumGstTotals(items: GstLineItem[]) {
  const list = items || [];
  return {
    taxableTotal: round2(list.reduce((s, it) => s + (Number(it.taxableValue) || 0) * (Number(it.quantity) || 0), 0)),
    totalCgst: round2(list.reduce((s, it) => s + (Number(it.cgstAmount) || 0), 0)),
    totalSgst: round2(list.reduce((s, it) => s + (Number(it.sgstAmount) || 0), 0)),
    totalIgst: round2(list.reduce((s, it) => s + (Number(it.igstAmount) || 0), 0)),
  };
}

/** True when buyer + seller states are both known and differ (→ IGST). */
export function resolveInterState(buyerState: string, sellerState: string): boolean {
  const b = String(buyerState || "").trim().toLowerCase();
  const s = String(sellerState || "").trim().toLowerCase();
  return !!(b && s && b !== s);
}

/**
 * Product-level discount, ignoring it once discount_expiry has passed.
 * Mirrors payment.js's activeProductDiscount() / the frontend's isDiscountActive().
 * Used by create-order, cod-create and manual-create — NOT by billing-create,
 * which (faithfully, matching the original orders.js) applies `products.discount`
 * unconditionally with no expiry check.
 */
export function activeProductDiscount(p: { discount?: number; discount_expiry?: string | null }): number {
  const raw = Number(p.discount || 0);
  if (raw > 0 && p.discount_expiry) {
    const expiryMs = new Date(p.discount_expiry).getTime();
    if (!isNaN(expiryMs) && Date.now() > expiryMs) return 0;
  }
  return raw;
}

/**
 * NOTE on category discounts: the original Firestore products carried a
 * separate `categoryDiscount` field, and every route did
 * `Math.max(productDiscount, categoryDiscount)`. The Supabase products table
 * (01-schema.sql) has no such column — AddDiscountPage's bulk "apply to
 * category" writes straight into the single `discount` column for every
 * matching product (see src/pages/AddDiscountPage/AddDiscountPage.jsx), so
 * that max() has already collapsed into one value by the time any of these
 * functions read it. There is nothing left to max() against.
 */

export type ProductRow = {
  id: string;
  title: string | null;
  category: string | null;
  sku: string | null;
  price: number;
  stock: number;
  discount: number;
  discount_expiry: string | null;
  gst_rate: number;
  hsn_code: string | null;
};

export type PriceItemsResult =
  | { ok: true; lineItems: LineItem[]; subtotal: number }
  | { ok: false; status: number; error: string };

/**
 * Server-authoritative per-line pricing shared by /create-order and
 * /cod-create (identical validation order + discount rule in the original:
 * not-found → 400, not-purchasable (price<=0) → 400, insufficient stock →
 * 409, expiry-aware discount).
 */
export function priceCartItems(
  items: Array<{ productId?: string; quantity?: number }>,
  productsById: Map<string, ProductRow>,
): PriceItemsResult {
  const lineItems: LineItem[] = [];
  let subtotal = 0;

  for (const it of items) {
    const pid = String(it?.productId || "");
    const qty = Math.floor(Number(it?.quantity) || 0);
    if (!pid || qty <= 0) {
      return { ok: false, status: 400, error: "Invalid cart item" };
    }

    const p = productsById.get(pid);
    if (!p) {
      return { ok: false, status: 400, error: `Product not found: ${pid}` };
    }

    const price = Number(p.price || 0);
    const stock = Number(p.stock || 0);
    if (price <= 0) {
      return { ok: false, status: 400, error: `Product not purchasable: ${p.title || pid}` };
    }
    if (stock < qty) {
      return { ok: false, status: 409, error: `Not enough stock for ${p.title || pid}` };
    }

    const finalDiscount = activeProductDiscount(p);
    const finalPrice = price - (price * finalDiscount) / 100;

    subtotal += finalPrice * qty;

    lineItems.push({
      productId: pid,
      title: p.title || "Product",
      category: p.category || "general",
      quantity: qty,
      originalPrice: price,
      discount: finalDiscount,
      finalPrice,
      gstRate: Number(p.gst_rate || 0),
      hsnCode: p.hsn_code || "",
    });
  }

  return { ok: true, lineItems, subtotal };
}

/** Reads settings row id='shippingSettings'. Same defaults as the original (₹500 / ₹49). */
export async function getShippingConfig(admin: SupabaseClient): Promise<{ threshold: number; fee: number }> {
  let threshold = 500;
  let fee = 49;
  try {
    const { data, error } = await admin.from("settings").select("data").eq("id", "shippingSettings").maybeSingle();
    if (!error && data?.data) {
      const sd = data.data;
      if (typeof sd.freeShippingThreshold === "number") threshold = sd.freeShippingThreshold;
      if (typeof sd.shippingCost === "number") fee = sd.shippingCost;
    }
  } catch (e) {
    console.warn("[pricing] shipping settings lookup failed, using defaults:", e);
  }
  return { threshold, fee };
}

/** Reads settings row id='invoiceSettings'.state — the seller's state for the GST split. */
export async function getSellerState(admin: SupabaseClient): Promise<string> {
  try {
    const { data, error } = await admin.from("settings").select("data").eq("id", "invoiceSettings").maybeSingle();
    if (error || !data?.data) return "";
    return data.data.state || "";
  } catch (e) {
    console.warn("[pricing] seller state lookup failed:", e);
    return "";
  }
}

/** Reads profiles.address->>'state' for the given user — the buyer's state for the GST split. */
export async function getBuyerState(admin: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data, error } = await admin.from("profiles").select("address").eq("id", userId).maybeSingle();
    if (error || !data) return "";
    return data.address?.state || "";
  } catch (e) {
    console.warn("[pricing] buyer state lookup failed:", e);
    return "";
  }
}

/** Reads settings row id='paymentSettings'.codPayment. Defaults to enabled (matches the original). */
export async function isCodEnabled(admin: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await admin.from("settings").select("data").eq("id", "paymentSettings").maybeSingle();
    if (error || !data?.data) return true;
    return data.data.codPayment !== false;
  } catch (e) {
    console.warn("[pricing] payment settings lookup failed:", e);
    return true;
  }
}

export type PromoResult = { discount: number; appliedCode: string };

/**
 * Validates + resolves a promo code against `promo_codes`. Silently ignores
 * invalid/unknown/expired codes (amount stays 0), same as the original — the
 * client only ever sends a code string, never a discount amount.
 */
export async function resolvePromoDiscount(admin: SupabaseClient, promoCode: string | undefined, subtotal: number): Promise<PromoResult> {
  if (!promoCode || typeof promoCode !== "string" || !promoCode.trim()) {
    return { discount: 0, appliedCode: "" };
  }
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
  } catch (e) {
    console.warn("[pricing] promo lookup failed:", e);
    return { discount: 0, appliedCode: "" };
  }
}