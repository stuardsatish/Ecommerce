import { supabase } from "../context/SupabaseConfig"

// Mirrors CartSlice's addCart/removeCart increment/decrement logic so the
// Supabase row always lands on the same quantity Redux is about to show.
export const nextAddQuantity = (cartItems, productId) => {
  const existing = cartItems.find((x) => String(x.id) === String(productId))
  return existing ? existing.quantity + 1 : 1
}

export const nextRemoveQuantity = (cartItems, productId) => {
  const existing = cartItems.find((x) => String(x.id) === String(productId))
  if (!existing) return 0
  return existing.quantity > 1 ? existing.quantity - 1 : 0
}

export const upsertCartItem = async (uid, product, quantity) => {
  if (!uid) return
  const { error } = await supabase.from("cart_items").upsert(
    {
      user_id: uid,
      product_id: String(product.id),
      quantity,
      title: product.title || "",
      image: product.thumbnail || product.image || "",
      category: product.category || "general",
      price: Number(product.price) || 0,
      discount: Number(product.discount || 0),
      discount_expiry: product.discountExpiry || null,
    },
    { onConflict: "user_id,product_id" }
  )
  if (error) console.error("Cart upsert error:", error)
}

export const removeCartItem = async (uid, productId) => {
  if (!uid) return
  const { error } = await supabase
    .from("cart_items")
    .delete()
    .eq("user_id", uid)
    .eq("product_id", String(productId))
  if (error) console.error("Cart remove error:", error)
}

export const decrementOrRemoveCartItem = async (uid, productId, newQuantity) => {
  if (!uid) return
  if (newQuantity > 0) {
    const { error } = await supabase
      .from("cart_items")
      .update({ quantity: newQuantity })
      .eq("user_id", uid)
      .eq("product_id", String(productId))
    if (error) console.error("Cart update error:", error)
  } else {
    await removeCartItem(uid, productId)
  }
}

export const clearCartItems = async (uid) => {
  if (!uid) return
  const { error } = await supabase.from("cart_items").delete().eq("user_id", uid)
  if (error) console.error("Cart clear error:", error)
}