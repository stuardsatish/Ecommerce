import { useEffect, useState, useRef } from "react"
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  query,
  where
} from "firebase/firestore"

import { fireDB } from "../../context/FirebaseConfig"
import { useSelector, useDispatch } from "react-redux"
import { useNavigate } from "react-router-dom"
import { addCart } from "../../context/CartSlice"
import { Archive, Clock, Star, X, CheckCircle2, ArrowLeft, Download, Package, XCircle, RotateCcw } from "lucide-react"
import { generateInvoice } from "../../utils/generateInvoice"
import { submitReview as submitReviewApi } from "../../utils/reviews"
import UserOrderCard, { orderNo } from "../../features/orders/UserOrderCard"
import useIsMobile from "../../hooks/useIsMobile"
import { toast } from "react-toastify"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import OrderCardSkeleton from "../../features/orders/OrderCardSkeleton"

const UserPastOrdersPage = () => {

  const user = useSelector((state) => state.user.user)
  const dispatch = useDispatch()
  const navigate = useNavigate()
  // Mobile design renders below `lg`; the desktop redesign at lg+.
  const isMobile = useIsMobile(1024)

  const [userData, setUserData] = useState(null)
  const [orders, setOrders] = useState([])        // delivered-only (mobile, unchanged)
  const [allOrders, setAllOrders] = useState([])  // past orders: delivered + cancelled (desktop tabs)
  const [activeTab, setActiveTab] = useState("ALL")
  const [loading, setLoading] = useState(true)

  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedOrderId, setSelectedOrderId] = useState(null)

  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  const [hoverRating, setHoverRating] = useState(0)
  const [userReviews, setUserReviews] = useState({})

  const containerRef = useRef(null)

/* ---------------- FETCH USER ---------------- */

  useEffect(() => {
    const fetchUser = async () => {
      if (!user?.uid) return
      const ref = doc(fireDB, "users", user.uid)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        setUserData(snap.data())
      }
    }
    fetchUser()
  }, [user])


/* ---------------- FETCH COMPLETED ORDERS ---------------- */

  useEffect(() => {
    const fetchOrders = async () => {
      if (!user?.uid) return
      setLoading(true)
      try {
        const q = query(
          collection(fireDB, "orders"),
          where("userId", "==", user.uid)
        )
        const snap = await getDocs(q)
        
        const toJsDate = (v) => {
          if (!v) return null
          if (v?.toDate) return v.toDate()
          if (v?.seconds) return new Date(v.seconds * 1000)
          const d = new Date(v)
          return isNaN(d.getTime()) ? null : d
        }

        // Past orders = delivered + cancelled (case-insensitive filter)
        const rawOrders = snap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(o => {
            const s = (o.orderStatus || "").toLowerCase()
            return ["delivered", "cancelled"].includes(s)
          })

        // Fetch detailed product data for each product in each order
        const enrichedOrders = await Promise.all(rawOrders.map(async (order) => {
          if (!order.products) return order;
          const enrichedProducts = await Promise.all(order.products.map(async (item) => {
            if (!item.productId) return item;
            const productRef = doc(fireDB, "products", item.productId);
            const productSnap = await getDoc(productRef);
            if (productSnap.exists()) {
              const productData = productSnap.data();
              const freshImage = productData.thumbnail || productData.image;
              return {
                ...item,
                thumbnail: freshImage,
                image: freshImage,
                category: productData.category || "general",
                stock: productData.stock || 0
              };
            }
            return item;
          }));
          return { ...order, products: enrichedProducts };
        }));

        // Sort: last/newest order at top, first/oldest order at bottom
        const sortedOrders = enrichedOrders.sort((a, b) => {
          const ta = toJsDate(a.createdAt)?.getTime() ?? 0
          const tb = toJsDate(b.createdAt)?.getTime() ?? 0
          return tb - ta
        })

        setAllOrders(sortedOrders)
        setOrders(sortedOrders.filter(o => (o.orderStatus || "").toLowerCase() === "delivered"))
      } catch (error) {
        console.error("Error fetching past orders:", error)
        setAllOrders([])
        setOrders([])
      } finally {
        setLoading(false)
      }
    }
    fetchOrders()
  }, [user])


/* ---------------- FETCH USER REVIEWS ---------------- */

  useEffect(() => {
    const fetchUserReviews = async () => {
      if (!user?.uid) return
      try {
        const q = query(
          collection(fireDB, "reviews"),
          where("userId", "==", user.uid)
        )
        const snap = await getDocs(q)
        const reviewsMap = {}
        snap.docs.forEach(d => {
          const data = d.data()
          if (data.productId) {
            reviewsMap[data.productId] = {
              rating: data.rating,
              comment: data.comment || ""
            }
          }
        })
        setUserReviews(reviewsMap)
      } catch (error) {
        console.error("Error fetching reviews:", error)
      }
    }
    fetchUserReviews()
  }, [user])


/* ---------------- OPEN REVIEW MODAL ---------------- */

  const openReviewModal = (product, orderId) => {
    setSelectedProduct(product)
    setSelectedOrderId(orderId)
    const existing = userReviews[product.productId]
    if (existing) {
      setRating(existing.rating)
      setComment(existing.comment || "")
    } else {
      setRating(0)
      setComment("")
    }
  }


/* ---------------- SUBMIT REVIEW ---------------- */

  const submitReview = async () => {
    if (!rating) {
      toast.error("Please add a rating")
      return
    }

    try {
      await submitReviewApi({
        productId: selectedProduct.productId,
        productTitle: selectedProduct.title,
        rating: Number(rating),
        comment: comment || "",
      })
      setUserReviews(prev => ({
        ...prev,
        [selectedProduct.productId]: { rating: Number(rating), comment: comment || "" }
      }))
      setSelectedProduct(null)
      setRating(0)
      setComment("")
      toast.success("Your feedback has been deployed.")
    } catch (error) {
      console.error("Review error:", error)
      toast.error(error.message || "Transmission failed. Please try again.")
    }
  }

  useGSAP(() => {
    if (isMobile) return;
    if (gsap.utils.toArray(".order-card").length > 0) {
      gsap.from(".order-card", {
        y: 30,
        opacity: 0,
        stagger: 0.1,
        duration: 0.8,
        ease: "power3.out",
        clearProps: "opacity,transform"
      })
    }
    if (gsap.utils.toArray(".header-text").length > 0) {
      gsap.from(".header-text", {
        x: -50,
        opacity: 0,
        duration: 1.2,
        ease: "power4.out"
      })
    }
  }, { scope: containerRef, dependencies: [orders, loading, isMobile] })


/* ---------------- UI ---------------- */

  /* ============================================================
     MOBILE LAYOUT (≤640px) — shares all Firebase data/handlers.
  ============================================================ */
  /* ---------------- DESKTOP TABS + HANDLERS ---------------- */
  const TABS = [
    { key: "ALL", label: "All Past Orders" },
    { key: "DELIVERED", label: "Delivered" },
    { key: "CANCELLED", label: "Cancelled" },
  ]
  const tabFilter = (o) => {
    const s = (o.orderStatus || "").toLowerCase()
    if (activeTab === "DELIVERED") return s === "delivered"
    if (activeTab === "CANCELLED") return s === "cancelled"
    return true // ALL past
  }
  const desktopOrders = allOrders.filter(tabFilter)
  const handleBuyAgain = (o) => {
    (o.products || []).forEach((p) =>
      dispatch(addCart({ id: p.productId, title: p.title, price: p.price, image: p.thumbnail || p.image, thumbnail: p.thumbnail || p.image, category: p.category, stock: p.stock || 0 }))
    )
    toast.success("Items added to your cart")
    navigate("/cart")
  }
  const handleViewDetails = (o) => navigate(`/order/${o.id}`)

  if (isMobile) {
    return (
      <div className="min-h-screen w-full" style={{ background: "#FBF9F8", fontFamily: "Inter, sans-serif", overflowX: "hidden", maxWidth: "100vw" }}>
        <main style={{ padding: "96px 20px 24px" }}>
          {loading ? (
            <div className="flex flex-col" style={{ gap: "16px" }}>
              {[...Array(3)].map((_, i) => <OrderCardSkeleton key={i} />)}
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: "60vh", gap: "16px" }}>
              <Archive size={44} color="#C4C6CD" />
              <p style={{ color: "#74777D", fontSize: "14px", fontWeight: 600 }}>No past orders yet.</p>
              <button onClick={() => navigate("/products")} style={{ background: "#A43B31", color: "#fff", fontWeight: 700, fontSize: "14px", padding: "12px 24px", borderRadius: "9999px" }}>
                Start Shopping
              </button>
            </div>
          ) : (
            <div className="flex flex-col" style={{ gap: "16px" }}>
              {orders.map((order) => (
                <div key={order.id} className="bg-white" style={{ borderRadius: "12px", padding: "16px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                  <div className="flex items-center justify-between" style={{ borderBottom: "1px solid #F0EEED", paddingBottom: "12px", marginBottom: "12px", gap: "8px" }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: "10px", color: "#74777D", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.6px" }}>Order</span>
                      <p style={{ fontWeight: 700, fontSize: "14px", color: "#1B1C1C" }}>#{orderNo(order)}</p>
                    </div>
                    <div className="flex items-center flex-shrink-0" style={{ gap: "10px" }}>
                      <span style={{ fontWeight: 800, fontSize: "16px", color: "#A43B31" }}>${Number(order.total).toFixed(2)}</span>
                      <span className="flex items-center" style={{ gap: "4px", padding: "4px 10px", borderRadius: "9999px", fontSize: "10px", fontWeight: 600, background: "#E8F5E9", color: "#A43B31" }}>
                        <CheckCircle2 size={10} /> Delivered
                      </span>
                      <button
                        onClick={() => generateInvoice(order, { name: order.userName || userData?.name, email: order.userEmail || userData?.email, phone: order.userPhone || userData?.phone, address: order.address || order.shippingAddress })}
                        aria-label="Download invoice"
                        className="flex items-center justify-center"
                        style={{ width: "28px", height: "28px", borderRadius: "8px", background: "#1B1C1C", color: "#fff" }}
                      >
                        <Download size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col" style={{ gap: "10px" }}>
                    {order.products?.map((item, index) => (
                      <div key={index} className="flex items-center justify-between" style={{ gap: "10px" }}>
                        <div className="flex items-center" style={{ gap: "10px", minWidth: 0 }}>
                          <div className="flex-shrink-0 flex items-center justify-center" style={{ width: "44px", height: "44px", background: "#F6F3F2", borderRadius: "8px", padding: "4px" }}>
                            <img src={item.thumbnail || item.image || "https://via.placeholder.com/64"} alt="" className="w-full h-full" style={{ objectFit: "cover", borderRadius: "4px" }} />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <h4 style={{ fontWeight: 600, fontSize: "13px", color: "#1B1C1C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</h4>
                            <p style={{ fontSize: "11px", color: "#74777D" }}>Qty: {item.quantity}</p>
                          </div>
                        </div>
                        {userReviews && userReviews[item.productId] ? (
                          <button onClick={() => openReviewModal(item, order.id)} className="flex items-center flex-shrink-0" style={{ gap: "4px", fontSize: "11px", fontWeight: 700, color: "#A43B31", background: "transparent", border: "none", cursor: "pointer" }}>
                            <div className="flex items-center" style={{ gap: "2px", marginRight: "4px" }}>
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star key={star} size={10} style={{ fill: userReviews[item.productId].rating >= star ? "#D4AF37" : "none", color: userReviews[item.productId].rating >= star ? "#D4AF37" : "#C4C6CD" }} />
                              ))}
                            </div>
                            <span style={{ fontSize: "10px", fontWeight: 600 }}>(Edit)</span>
                          </button>
                        ) : (
                          <button onClick={() => openReviewModal(item, order.id)} className="flex items-center flex-shrink-0" style={{ gap: "4px", fontSize: "11px", fontWeight: 700, color: "#A43B31", background: "transparent", border: "none", cursor: "pointer" }}>
                            <Star size={12} /> Review
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* MOBILE REVIEW MODAL (bottom sheet) — reuses existing review state/handlers */}
        {selectedProduct && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setSelectedProduct(null)}>
            <div onClick={(e) => e.stopPropagation()} className="w-full bg-white" style={{ borderRadius: "16px 16px 0 0", padding: "20px", fontFamily: "Inter, sans-serif" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
                <h2 style={{ fontWeight: 700, fontSize: "18px", color: "#1B1C1C" }}>Write a Review</h2>
                <button onClick={() => setSelectedProduct(null)} aria-label="Close"><X size={20} color="#74777D" /></button>
              </div>
              <p style={{ fontSize: "13px", color: "#74777D", marginBottom: "16px" }}>{selectedProduct.title}</p>
              <div className="flex" style={{ gap: "8px", marginBottom: "16px" }}>
                {[1, 2, 3, 4, 5].map((star) => {
                  const on = (hoverRating || rating) >= star
                  return (
                    <button key={star} onClick={() => setRating(star)} onMouseEnter={() => setHoverRating(star)} onMouseLeave={() => setHoverRating(0)} className="active:scale-90" style={{ transition: "transform 0.15s" }}>
                      <Star size={30} style={{ fill: on ? "#D4AF37" : "none", color: on ? "#D4AF37" : "#C4C6CD" }} />
                    </button>
                  )
                })}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Share your thoughts about this product…"
                style={{ width: "100%", height: "96px", background: "#F6F3F2", borderRadius: "12px", padding: "12px", fontSize: "14px", color: "#1B1C1C", border: "1px solid rgba(228,226,225,0.6)", resize: "none", outline: "none", fontFamily: "Inter, sans-serif" }}
              />
              <button onClick={submitReview} className="w-full flex items-center justify-center" style={{ marginTop: "16px", height: "48px", background: "#A43B31", borderRadius: "9999px", color: "#fff", fontWeight: 700, fontSize: "16px" }}>
                Submit Review
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="hidden lg:block" style={{ background: "#FBF9F8", minHeight: "100vh", fontFamily: "Inter, sans-serif", color: "#1B1C1C" }}>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "48px 40px 80px" }}>

        {/* SECTION 1 — HEADER */}
        <div className="header-text flex flex-col" style={{ gap: "4px", paddingBottom: "8px" }}>
          <h1 style={{ fontWeight: 700, fontSize: "36px", letterSpacing: "-0.72px", color: "#1B1C1C" }}>My Orders</h1>
          <p style={{ fontWeight: 400, fontSize: "16px", color: "#44474C" }}>Your order history — all past purchases.</p>
        </div>

        {/* SECTION 2 — FILTER TABS */}
        <div className="flex" style={{ borderBottom: "1px solid #E4E2E1", gap: "16px", paddingBottom: "4px", marginTop: "24px" }}>
          {TABS.map((t) => {
            const act = activeTab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{ padding: "8px 16px", fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", color: act ? "#A43B31" : "#44474C", borderBottom: act ? "2px solid #A43B31" : "2px solid transparent", marginBottom: "-5px" }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* SECTION 3 — PAST ORDER CARDS */}
        <div className="flex flex-col" style={{ gap: "24px", marginTop: "24px" }}>
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse flex" style={{ background: "#fff", border: "1px solid #E4E2E1", borderRadius: "4px", padding: "24px", gap: "24px" }}>
                <div className="flex flex-col" style={{ gap: "16px", flexGrow: 1 }}>
                  <div style={{ height: "14px", width: "120px", background: "#E4E2E1", borderRadius: "4px" }} />
                  <div style={{ height: "22px", width: "180px", background: "#E4E2E1", borderRadius: "4px" }} />
                  <div className="flex" style={{ gap: "16px" }}>
                    <div style={{ width: "64px", height: "64px", background: "#E4E2E1", borderRadius: "4px" }} />
                    <div style={{ height: "16px", width: "160px", background: "#E4E2E1", borderRadius: "4px", marginTop: "12px" }} />
                  </div>
                </div>
                <div className="flex flex-col" style={{ gap: "8px", width: "180px" }}>
                  <div style={{ height: "48px", background: "#E4E2E1", borderRadius: "4px" }} />
                  <div style={{ height: "50px", background: "#E4E2E1", borderRadius: "4px" }} />
                </div>
              </div>
            ))
          ) : desktopOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ gap: "16px", padding: "80px 0", border: "1px dashed #E4E2E1", borderRadius: "8px", background: "#fff" }}>
              <Package size={44} style={{ color: "#E4E2E1" }} />
              <p style={{ fontWeight: 700, fontSize: "18px", color: "#1B1C1C" }}>No past orders yet</p>
              <p style={{ fontSize: "14px", color: "#44474C" }}>When you complete orders, they'll appear here.</p>
              <button onClick={() => navigate("/products")} style={{ background: "#A43B31", color: "#fff", fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", padding: "14px 28px", borderRadius: "4px" }}>Start Shopping</button>
            </div>
          ) : (
            desktopOrders.map((order) => (
              <UserOrderCard key={order.id} order={order} onBuyAgain={handleBuyAgain} onViewDetails={handleViewDetails} onReviewClick={openReviewModal} userReviews={userReviews} />
            ))
          )}
        </div>
      </div>
      {/* DESKTOP REVIEW MODAL */}
      {selectedProduct && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setSelectedProduct(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white" style={{ borderRadius: "16px", padding: "24px", fontFamily: "Inter, sans-serif", boxShadow: "0 10px 25px rgba(0,0,0,0.1)" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
              <h2 style={{ fontWeight: 700, fontSize: "18px", color: "#1B1C1C" }}>Write a Review</h2>
              <button onClick={() => setSelectedProduct(null)} aria-label="Close"><X size={20} color="#74777D" /></button>
            </div>
            <p style={{ fontSize: "13px", color: "#74777D", marginBottom: "16px" }}>{selectedProduct.title}</p>
            <div className="flex" style={{ gap: "8px", marginBottom: "16px" }}>
              {[1, 2, 3, 4, 5].map((star) => {
                const on = (hoverRating || rating) >= star
                return (
                  <button key={star} onClick={() => setRating(star)} onMouseEnter={() => setHoverRating(star)} onMouseLeave={() => setHoverRating(0)} className="active:scale-90" style={{ transition: "transform 0.15s" }}>
                    <Star size={30} style={{ fill: on ? "#D4AF37" : "none", color: on ? "#D4AF37" : "#C4C6CD" }} />
                  </button>
                )
              })}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share your thoughts about this product…"
              style={{ width: "100%", height: "96px", background: "#F6F3F2", borderRadius: "12px", padding: "12px", fontSize: "14px", color: "#1B1C1C", border: "1px solid rgba(228,226,225,0.6)", resize: "none", outline: "none", fontFamily: "Inter, sans-serif" }}
            />
            <button onClick={submitReview} className="w-full flex items-center justify-center" style={{ marginTop: "16px", height: "48px", background: "#A43B31", borderRadius: "9999px", color: "#fff", fontWeight: 700, fontSize: "16px" }}>
              Submit Review
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default UserPastOrdersPage