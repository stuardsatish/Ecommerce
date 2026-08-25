import { supabase } from "../context/SupabaseConfig"

// Mirrors CartSlice's addCart/removeCart increment/decrement logic so the
// Supabase row always lands on the same quantity Redux is about to show.
export const nextAddQuantity = (cartItems, cartId) => {
  const existing = cartItems.find((x) => String(x.id) === String(cartId))
  return existing ? existing.quantity + 1 : 1
}

export const nextRemoveQuantity = (cartItems, cartId) => {
  const existing = cartItems.find((x) => String(x.id) === String(cartId))
  if (!existing) return 0
  return existing.quantity > 1 ? existing.quantity - 1 : 0
}

/**
 * Upsert a cart row for either a single or variant product.
 *
 * For single products: product.variantId is undefined / falsy.
 * For variant products: product.variantId is the variant's id string,
 *   product.id is the compound cart key (`${productId}_${variantId}`),
 *   and product.productId is the real products-table id.
 *
 * The DB conflict key is (user_id, product_id, variant_id) — see migration SQL.
 * Single products use variant_id = '' so they don't collide with any variant row.
 */
export const upsertCartItem = async (uid, product, quantity) => {
  if (!uid) return
  const variantId   = product.variantId   || ""
  const variantName = product.variantName || null
  // product_id stored in the DB is always the actual products-table id
  const realProductId = product.productId || product.id

  const { error } = await supabase.from("cart_items").upsert(
    {
      user_id:          uid,
      product_id:       String(realProductId),
      variant_id:       variantId,
      variant_name:     variantName,
      selected_variant: product.selectedVariant || null,
      quantity,
      title:            product.title || "",
      image:            product.thumbnail || product.image || "",
      category:         product.category || "general",
      price:            Number(product.price) || 0,
      discount:         Number(product.discount || 0),
      discount_expiry:  product.discountExpiry || null,
    },
    { onConflict: "user_id,product_id,variant_id" }
  )
  if (error) console.error("Cart upsert error:", error)
}

export const removeCartItem = async (uid, productId, variantId = "") => {
  if (!uid) return
  const { error } = await supabase
    .from("cart_items")
    .delete()
    .eq("user_id",    uid)
    .eq("product_id", String(productId))
    .eq("variant_id", variantId)
  if (error) console.error("Cart remove error:", error)
}

export const decrementOrRemoveCartItem = async (uid, productId, newQuantity, variantId = "") => {
  if (!uid) return
  if (newQuantity > 0) {
    const { error } = await supabase
      .from("cart_items")
      .update({ quantity: newQuantity })
      .eq("user_id",    uid)
      .eq("product_id", String(productId))
      .eq("variant_id", variantId)
    if (error) console.error("Cart update error:", error)
  } else {
    await removeCartItem(uid, productId, variantId)
  }
}

export const clearCartItems = async (uid) => {
  if (!uid) return
  const { error } = await supabase.from("cart_items").delete().eq("user_id", uid)
  if (error) console.error("Cart clear error:", error)
}