import React, { useState, useEffect } from "react"
import { useSelector, useDispatch } from "react-redux"
import { useNavigate } from "react-router-dom"
import { removeWishlist } from "../../context/WishlistSlice"
import { addCart } from "../../context/CartSlice"
import { Trash2, ShoppingBag, ArrowRight, ArrowLeft, ChevronRight, Share2, ShoppingCart, X, Bell } from "lucide-react"
import { collection, getDocs, getDoc, doc, query, where, orderBy, limit, addDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { fireDB, auth } from "../../context/FirebaseConfig"
import { toast } from "react-toastify"
import useIsMobile from "../../hooks/useIsMobile"

const WishlistPage = () => {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const wishlistItems = useSelector((state) => state.wishlist.wishlistItems)
  // Mobile design renders below `lg`; the desktop redesign at lg+.
  const isMobile = useIsMobile(1024)

  /* ---------- DESKTOP: enrichment + recommendations ---------- */
  const money = (n) => `₹${Number(n || 0).toFixed(2)}`
  const LOW_STOCK = 5
  const pidOf = (item) => item.productId || item.id

  const [productMap, setProductMap] = useState({})
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [recommended, setRecommended] = useState([])
  const [loadingRec, setLoadingRec] = useState(true)
  const [alertedIds, setAlertedIds] = useState([])

  const wishlistKey = wishlistItems.map(pidOf).join(",")

  // Join each wishlist item with its live product doc (stock / mrp for badges).
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoadingProducts(true)
      try {
        const ids = [...new Set(wishlistItems.map(pidOf).filter(Boolean))]
        const entries = await Promise.all(ids.map(async (pid) => {
          try {
            const snap = await getDoc(doc(fireDB, "products", String(pid)))
            return [pid, snap.exists() ? snap.data() : {}]
          } catch { return [pid, {}] }
        }))
        if (active) setProductMap(Object.fromEntries(entries))
      } finally {
        if (active) setLoadingProducts(false)
      }
    })()
    return () => { active = false }
  }, [wishlistKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Recommended: top-rated products not already in the wishlist.
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoadingRec(true)
      try {
        let snap
        try { snap = await getDocs(query(collection(fireDB, "products"), orderBy("rating", "desc"), limit(12))) }
        catch { snap = await getDocs(query(collection(fireDB, "products"), limit(12))) }
        const wishIds = new Set(wishlistItems.map(pidOf).map(String))
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !wishIds.has(String(p.id))).slice(0, 4)
        if (active) setRecommended(list)
      } catch (e) {
        console.log("recommended fetch failed:", e)
      } finally {
        if (active) setLoadingRec(false)
      }
    })()
    return () => { active = false }
  }, [wishlistKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derive a stock badge from the joined product's stock.
  const stockInfo = (pid) => {
    const stock = Number(productMap[pid]?.stock)
    if (Number.isFinite(stock)) {
      if (stock <= 0) return { status: "OUT", label: "OUT OF STOCK" }
      if (stock <= LOW_STOCK) return { status: "LOW", label: `ONLY ${stock} LEFT`, left: stock }
      return { status: "IN", label: "IN STOCK" }
    }
    return { status: "IN", label: "IN STOCK" } // unknown stock → treat as available
  }

  const mrpOf = (pid) => Number(productMap[pid]?.mrp ?? productMap[pid]?.originalPrice ?? 0)

  /* ---------- DESKTOP handlers (reuse existing Redux actions) ---------- */
  const handleRemove = async (pid) => {
    dispatch(removeWishlist(pid)) // instant UI
    try {
      const uid = auth.currentUser?.uid
      if (!uid) return
      const snap = await getDocs(query(collection(fireDB, "wishlists"), where("userId", "==", uid)))
      await Promise.all(
        snap.docs.filter((d) => String(d.data().productId) === String(pid)).map((d) => deleteDoc(d.ref))
      )
    } catch (e) {
      console.log("wishlist remove persist failed:", e)
    }
  }

  const handleAddToCart = (item) => {
    dispatch(addCart(item))
    toast.success("Added to cart")
  }

  const handleMoveAll = () => {
    const inStock = wishlistItems.filter((i) => stockInfo(pidOf(i)).status !== "OUT")
    if (!inStock.length) { toast.info("No in-stock items to move."); return }
    inStock.forEach((i) => { dispatch(addCart(i)); handleRemove(pidOf(i)) })
    toast.success(`Moved ${inStock.length} item(s) to cart`)
    navigate("/cart")
  }

  const handleShare = async () => {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: "My Wishlist", url })
      else { await navigator.clipboard.writeText(url); toast.success("Wishlist link copied to clipboard!") }
    } catch { /* user dismissed the share sheet */ }
  }

  const handleNotify = async (pid) => {
    const uid = auth.currentUser?.uid
    if (!uid) { navigate("/login"); return }
    try {
      await addDoc(collection(fireDB, "stockAlerts"), { userId: uid, productId: String(pid), createdAt: serverTimestamp() })
      setAlertedIds((prev) => [...prev, String(pid)])
      toast.success("We'll notify you when it's back in stock")
    } catch (e) {
      console.log("stock alert failed:", e)
      toast.error("Could not set the alert")
    }
  }

  /* ============================================================
     MOBILE LAYOUT (≤640px) — shares all Redux state/handlers.
  ============================================================ */
  if (isMobile) {
    return (
      <div className="min-h-screen w-full" style={{ background: "#FBF9F8", fontFamily: "Inter, sans-serif", overflowX: "hidden", maxWidth: "100vw" }}>
        {wishlistItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: "100vh", gap: "16px", padding: "96px 24px 0" }}>
            <ShoppingBag size={44} color="#C4C6CD" />
            <p style={{ color: "#74777D", fontSize: "14px", fontWeight: 600 }}>Your wishlist is empty.</p>
            <button onClick={() => navigate("/products")} style={{ background: "#A43B31", color: "#fff", fontWeight: 700, fontSize: "14px", padding: "12px 24px", borderRadius: "9999px" }}>
              Explore Products
            </button>
          </div>
        ) : (
          <main className="grid grid-cols-2" style={{ gap: "16px", padding: "96px 20px 24px" }}>
            {wishlistItems.map((item) => {
              const pid = item.productId || item.id
              return (
                <div key={pid} className="relative bg-white flex flex-col overflow-hidden" style={{ borderRadius: "12px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                  <button
                    onClick={() => dispatch(removeWishlist(pid))}
                    aria-label="Remove from wishlist"
                    className="absolute z-20 flex items-center justify-center"
                    style={{ top: "12px", right: "12px", width: "32px", height: "32px", background: "rgba(255,255,255,0.9)", borderRadius: "9999px", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
                  >
                    <Trash2 size={15} color="#A43B31" />
                  </button>

                  <div onClick={() => navigate(`/product/${pid}`)} className="w-full cursor-pointer" style={{ background: "#F6F3F2", padding: "8px" }}>
                    <div className="w-full aspect-square">
                      <img src={item.thumbnail || item.image} alt={item.title} loading="lazy" className="w-full h-full" style={{ objectFit: "cover", borderRadius: "8px" }} />
                    </div>
                  </div>

                  <div className="flex flex-col flex-1" style={{ padding: "12px" }}>
                    <div onClick={() => navigate(`/product/${pid}`)} className="cursor-pointer">
                      <p style={{ color: "#74777D", fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.6px" }}>{item.category}</p>
                      <h3 style={{ color: "#1B1C1C", fontWeight: 700, fontSize: "14px", lineHeight: "18px", marginTop: "4px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.title}</h3>
                    </div>
                    <div style={{ marginTop: "auto" }}>
                      <span style={{ color: "#1B1C1C", fontWeight: 600, fontSize: "18px" }}>${Number(item.price || 0).toFixed(2)}</span>
                      <button
                        onClick={() => { dispatch(addCart(item)); navigate("/cart") }}
                        className="w-full flex items-center justify-center"
                        style={{ marginTop: "8px", height: "36px", borderRadius: "9999px", background: "#A43B31", color: "#fff", fontWeight: 700, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", gap: "6px" }}
                      >
                        <ShoppingBag size={14} /> Add to Cart
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </main>
        )}
      </div>
    )
  }

  return (
    <div className="hidden lg:block" style={{ background: "#F7F9FB", minHeight: "100vh", fontFamily: "Inter, sans-serif", color: "#191C1E" }}>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "48px 64px 80px" }}>

        {/* SECTION 1 — HEADER */}
        <div className="flex" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
          <div className="flex flex-col" style={{ gap: "8px" }}>
            <div className="flex items-center" style={{ gap: "8px" }}>
              <button onClick={() => navigate("/")} style={{ fontWeight: 500, fontSize: "12px", color: "#44474C" }}>Home</button>
              <ChevronRight size={12} style={{ color: "#44474C" }} />
              <span style={{ fontWeight: 500, fontSize: "12px", color: "#191C1E" }}>Wishlist</span>
            </div>
            <h1 style={{ fontWeight: 700, fontSize: "48px", letterSpacing: "-0.96px", color: "#A43B31", paddingTop: "8px" }}>My Wishlist</h1>
            <p style={{ fontWeight: 400, fontSize: "16px", color: "#44474C" }}>
              You have <strong className="font-bold">{wishlistItems.length}</strong> {wishlistItems.length === 1 ? "item" : "items"} saved for later.
            </p>
          </div>

          {wishlistItems.length > 0 && (
            <div className="flex" style={{ gap: "24px", alignItems: "flex-start" }}>
              <button onClick={handleShare} className="flex items-center" style={{ padding: "12px 24px", gap: "8px", background: "#fff", border: "1px solid #E4E2E1", borderRadius: "8px" }}>
                <Share2 size={16} style={{ color: "#44474C" }} />
                <span style={{ fontWeight: 400, fontSize: "16px", color: "#44474C" }}>Share Wishlist</span>
              </button>
              <button onClick={handleMoveAll} className="flex items-center" style={{ padding: "13px 24px", gap: "8px", background: "#A43B31", borderRadius: "8px", boxShadow: "0px 10px 15px -3px rgba(31,16,142,0.2)" }}>
                <ShoppingCart size={16} style={{ color: "#fff" }} />
                <span style={{ fontWeight: 400, fontSize: "16px", color: "#fff" }}>Move All to Cart</span>
              </button>
            </div>
          )}
        </div>

        {/* SECTION 2 — WISHLIST GRID */}
        <div style={{ marginTop: "40px" }}>
          {wishlistItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ gap: "16px", padding: "80px 0" }}>
              <div className="flex items-center justify-center" style={{ width: "96px", height: "96px", borderRadius: "9999px", background: "#EDEBF6" }}>
                <ShoppingBag size={40} style={{ color: "#A43B31" }} />
              </div>
              <h2 style={{ fontWeight: 700, fontSize: "22px", color: "#191C1E" }}>Your wishlist is empty</h2>
              <p style={{ fontSize: "16px", color: "#44474C" }}>Save items you love to find them here later.</p>
              <button onClick={() => navigate("/products")} style={{ background: "#A43B31", color: "#fff", fontWeight: 700, fontSize: "16px", padding: "14px 32px", borderRadius: "8px" }}>Explore Products</button>
            </div>
          ) : loadingProducts ? (
            <div className="grid grid-cols-4" style={{ gap: "24px" }}>
              {[...Array(4)].map((_, i) => (
                <div key={i} className="animate-pulse" style={{ background: "#fff", border: "1px solid #E4E2E1", borderRadius: "8px" }}>
                  <div style={{ height: "340px", background: "#E4E2E1", borderRadius: "8px 8px 0 0" }} />
                  <div style={{ padding: "24px" }}>
                    <div style={{ height: "12px", width: "50%", background: "#E4E2E1", borderRadius: "4px", marginBottom: "10px" }} />
                    <div style={{ height: "14px", width: "80%", background: "#E4E2E1", borderRadius: "4px", marginBottom: "14px" }} />
                    <div style={{ height: "18px", width: "40%", background: "#E4E2E1", borderRadius: "4px", marginBottom: "14px" }} />
                    <div style={{ height: "48px", background: "#E4E2E1", borderRadius: "4px" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-4" style={{ gap: "24px" }}>
              {wishlistItems.map((item) => {
                const pid = pidOf(item)
                const info = stockInfo(pid)
                const out = info.status === "OUT"
                const mrp = mrpOf(pid)
                const img = item.thumbnail || item.image
                const notified = alertedIds.includes(String(pid))
                return (
                  <div key={pid} className="group flex flex-col" style={{ background: "#fff", border: "1px solid #E4E2E1", borderRadius: "8px", isolation: "isolate" }}>
                    {/* IMAGE AREA */}
                    <div className="relative" style={{ height: "340px", background: "#E4E2E1", overflow: "hidden", borderRadius: "8px 8px 0 0" }}>
                      {img && (
                        <img src={img} alt={item.title} onClick={() => navigate(`/product/${pid}`)} className="cursor-pointer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      )}
                      {out && (
                        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
                          <span style={{ background: "#fff", borderRadius: "12px", padding: "8px 16px", fontWeight: 700, fontSize: "12px", letterSpacing: "1.2px", textTransform: "uppercase", color: "#191C1E", boxShadow: "0px 4px 12px rgba(0,0,0,0.15)" }}>Out of Stock</span>
                        </div>
                      )}
                      {!out && info.status === "IN" && (
                        <span className="absolute" style={{ left: "12px", bottom: "12px", background: "#D1FAE5", borderRadius: "2px", padding: "2.5px 8px", fontWeight: 700, fontSize: "10px", textTransform: "uppercase", color: "#065F46" }}>In Stock</span>
                      )}
                      {!out && info.status === "LOW" && (
                        <span className="absolute" style={{ left: "12px", bottom: "12px", background: "#FFEDD5", borderRadius: "2px", padding: "2.5px 8px", fontWeight: 700, fontSize: "10px", textTransform: "uppercase", color: "#9A3412" }}>Only {info.left} Left</span>
                      )}
                      <button onClick={() => handleRemove(pid)} aria-label="Remove from wishlist" className="absolute opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity" style={{ top: "13px", right: "13px", width: "28px", height: "34px", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(4px)", borderRadius: "12px" }}>
                        <X size={12} style={{ color: "#BA1A1A" }} />
                      </button>
                    </div>

                    {/* BODY */}
                    <div className="flex flex-col" style={{ padding: "24px", gap: "8px" }}>
                      <span style={{ fontWeight: 400, fontSize: "16px", letterSpacing: "1.6px", textTransform: "uppercase", color: "#777584" }}>{item.brand || item.category || "PRODUCT"}</span>
                      <span className="line-clamp-1" style={{ fontWeight: 400, fontSize: "16px", color: "#191C1E" }}>{item.title}</span>
                      <div className="flex items-center" style={{ gap: "8px" }}>
                        <span style={{ fontWeight: 700, fontSize: "18px", color: "#A43B31" }}>{money(item.price)}</span>
                        {mrp > Number(item.price) && (
                          <span style={{ fontWeight: 400, fontSize: "14px", color: "#44474C", textDecoration: "line-through" }}>{money(mrp)}</span>
                        )}
                      </div>
                      {out ? (
                        <button onClick={() => handleNotify(pid)} disabled={notified} className="w-full flex items-center justify-center" style={{ height: "48px", padding: "12px 0", borderRadius: "4px", gap: "8px", background: "#D8DADC", opacity: notified ? 0.7 : 1 }}>
                          <Bell size={15} style={{ color: "#44474C" }} />
                          <span style={{ fontWeight: 400, fontSize: "16px", color: "#44474C" }}>{notified ? "Notified" : "Notify Me"}</span>
                        </button>
                      ) : (
                        <button onClick={() => handleAddToCart(item)} className="w-full flex items-center justify-center" style={{ height: "48px", padding: "12px 0", borderRadius: "4px", gap: "8px", background: "#A43B31" }}>
                          <ShoppingCart size={15} style={{ color: "#fff" }} />
                          <span style={{ fontWeight: 400, fontSize: "16px", color: "#fff" }}>Add to Cart</span>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* SECTION 3 — RECOMMENDATIONS */}
        {wishlistItems.length > 0 && (
          <div className="flex flex-col" style={{ borderTop: "1px solid #E4E2E1", paddingTop: "64px", marginTop: "64px", gap: "40px" }}>
            <div className="flex" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontWeight: 400, fontSize: "16px", color: "#191C1E" }}>Recommended For You</h2>
              <button onClick={() => navigate("/products")} className="flex items-center" style={{ gap: "6px" }}>
                <span style={{ fontWeight: 400, fontSize: "16px", color: "#A43B31" }}>View Catalog</span>
                <ArrowRight size={12} style={{ color: "#A43B31" }} />
              </button>
            </div>
            <div className="flex" style={{ gap: "24px", overflowX: "auto" }}>
              {loadingRec ? (
                [...Array(4)].map((_, i) => (
                  <div key={i} className="animate-pulse" style={{ minWidth: "280px", width: "280px", padding: "12px", background: "rgba(242,244,246,0.5)", borderRadius: "8px" }}>
                    <div style={{ width: "100%", height: "254px", background: "#E4E2E1", borderRadius: "4px", marginBottom: "10px" }} />
                    <div style={{ height: "14px", width: "70%", background: "#E4E2E1", borderRadius: "4px", marginBottom: "8px" }} />
                    <div style={{ height: "14px", width: "40%", background: "#E4E2E1", borderRadius: "4px" }} />
                  </div>
                ))
              ) : recommended.length === 0 ? (
                <p style={{ fontSize: "14px", color: "#44474C" }}>No recommendations right now.</p>
              ) : (
                recommended.map((p) => (
                  <button key={p.id} onClick={() => navigate(`/product/${p.id}`)} className="flex flex-col text-left" style={{ minWidth: "280px", width: "280px", padding: "12px", gap: "4px", background: "rgba(242,244,246,0.5)", borderRadius: "8px" }}>
                    {(p.thumbnail || p.image) ? (
                      <img src={p.thumbnail || p.image} alt={p.title || p.name} style={{ width: "100%", height: "254px", objectFit: "cover", borderRadius: "4px" }} />
                    ) : (
                      <div style={{ width: "100%", height: "254px", background: "#E4E2E1", borderRadius: "4px" }} />
                    )}
                    <span className="line-clamp-1" style={{ fontWeight: 400, fontSize: "16px", color: "#191C1E" }}>{p.title || p.name}</span>
                    <span style={{ fontWeight: 700, fontSize: "16px", color: "#A43B31" }}>{money(p.price)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default WishlistPage