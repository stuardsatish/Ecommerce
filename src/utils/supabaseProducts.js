// Maps a `products` row (snake_case) to the camelCase shape used throughout the app.
export const mapProductRow = (row) => {
  if (!row) return row
  return {
    id: row.id,
    productId: row.id,
    title: row.title || "",
    description: row.description || "",
    shortDescription: row.short_description || "",
    category: row.category || "",
    brand: row.brand || "",
    badge: row.badge || "",
    sku: row.sku || "",
    price: Number(row.price) || 0,
    priceType: row.price_type || "inclusive",
    discount: Number(row.discount) || 0,
    discountExpiry: row.discount_expiry || "",
    gstRate: Number(row.gst_rate) || 0,
    hsnCode: row.hsn_code || "",
    stock: Number(row.stock) || 0,
    maxStock: row.max_stock,
    image: row.image || "",
    thumbnail: row.thumbnail || row.image || "",
    gallery: row.gallery || [],
    rating: Number(row.rating) || 0,
    reviewCount: Number(row.review_count) || 0,
    status: row.status || "active",
    createdAt: row.created_at,
    // Variant / combination product fields
    hasVariants: Boolean(row.has_variants),
    variants: Array.isArray(row.variants) ? row.variants : [],
    attributes: Array.isArray(row.attributes) ? row.attributes : [],
  }
}

export const mapProductRows = (rows) => (rows || []).map(mapProductRow)