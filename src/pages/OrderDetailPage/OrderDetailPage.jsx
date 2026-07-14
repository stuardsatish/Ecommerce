import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useSelector, useDispatch } from "react-redux"
import { doc, getDoc } from "firebase/firestore"
import { fireDB } from "../../context/FirebaseConfig"
import { addCart } from "../../context/CartSlice"
import { generateInvoice } from "../../utils/generateInvoice"
import { orderNo, statusMeta } from "../../features/orders/UserOrderCard"
import { ArrowLeft, Truck, CheckCircle2, XCircle, RotateCcw, Download, Package } from "lucide-react"
import { toast } from "react-toastify"

const cur = (n) => `₹${Number(n || 0).toFixed(2)}`
const toJsDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null)
const fmtDate = (v) => {
  const d = toJsDate(v)
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"
}

const OrderDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const user = useSelector((state) => state.user.user)

  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const snap = await getDoc(doc(fireDB, "orders", id))
        if (!snap.exists()) { if (active) { setError(true) }; return }
        const data = { id: snap.id, ...snap.data() }
        // Enrich line items with fresh product thumbnails.
        const products = await Promise.all((data.products || []).map(async (item) => {
          if (!item.productId) return item
          try {
            const pSnap = await getDoc(doc(fireDB, "products", item.productId))
            if (pSnap.exists()) {
              const p = pSnap.data()
              const img = p.thumbnail || p.image
              return { ...item, thumbnail: img, image: img }
            }
          } catch { /* keep original */ }
          return item
        }))
        if (active) setOrder({ ...data, products })
      } catch (e) {
        console.error("order detail fetch:", e)
        if (active) setError(true)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [id])

  const buyAgain = () => {
    (order?.products || []).forEach((p) =>
      dispatch(addCart({ id: p.productId, title: p.title, price: p.price, image: p.thumbnail || p.image, thumbnail: p.thumbnail || p.image, category: p.category, stock: p.stock || 0 }))
    )
    toast.success("Items added to your cart")
    navigate("/cart")
  }

  const downloadInvoice = () =>
    generateInvoice(order, { name: order.userName || user?.name, email: order.userEmail || user?.email, phone: order.userPhone || user?.phone, address: order.address || order.shippingAddress })

  const Shell = ({ children }) => (
    <div style={{ background: "#FBF9F8", minHeight: "100vh", fontFamily: "Inter, sans-serif", color: "#1B1C1C" }}>
      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "48px 24px 80px" }}>{children}</div>
    </div>
  )

  if (loading) {
    return (
      <Shell>
        <div className="animate-pulse flex flex-col" style={{ gap: "16px" }}>
          <div style={{ height: "28px", width: "240px", background: "#E4E2E1", borderRadius: "6px" }} />
          <div style={{ height: "180px", background: "#E4E2E1", borderRadius: "8px" }} />
          <div style={{ height: "320px", background: "#E4E2E1", borderRadius: "8px" }} />
        </div>
      </Shell>
    )
  }

  if (error || !order) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center text-center" style={{ gap: "16px", padding: "80px 0" }}>
          <Package size={44} style={{ color: "#E4E2E1" }} />
          <p style={{ fontWeight: 700, fontSize: "18px" }}>Order not found</p>
          <button onClick={() => navigate("/userorders")} style={{ background: "#A43B31", color: "#fff", fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", padding: "14px 28px", borderRadius: "4px" }}>Back to Orders</button>
        </div>
      </Shell>
    )
  }

  const m = statusMeta(order)
  const items = order.products || []
  const itemsTotal = items.reduce((s, p) => s + Number(p.price || 0) * Number(p.quantity || 0), 0)
  const shipping = Math.max(0, Number(order.total || 0) - itemsTotal)

  return (
    <Shell>
      {/* Back + header */}
      <button onClick={() => navigate(-1)} className="flex items-center" style={{ gap: "8px", color: "#44474C", marginBottom: "24px" }}>
        <ArrowLeft size={16} /> <span style={{ fontWeight: 600, fontSize: "14px" }}>Back to orders</span>
      </button>

      <div className="flex" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
        <div className="flex flex-col" style={{ gap: "4px" }}>
          <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "#44474C" }}>Order ID</span>
          <h1 style={{ fontWeight: 700, fontSize: "32px", letterSpacing: "-0.6px", color: "#1B1C1C" }}>#{orderNo(order)}</h1>
          <span style={{ fontWeight: 400, fontSize: "14px", color: "#44474C" }}>Placed on {fmtDate(order.createdAt)}</span>
        </div>
        <span className="flex items-center" style={{ background: m.bg, borderRadius: "12px", padding: "6px 16px", gap: "6px" }}>
          {m.icon === "truck" && <Truck size={14} style={{ color: m.color }} />}
          {m.icon === "check" && <CheckCircle2 size={14} style={{ color: m.color }} />}
          {m.icon === "x" && <XCircle size={14} style={{ color: m.color }} />}
          <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", color: m.color }}>{m.label}</span>
        </span>
      </div>

      {/* Items */}
      <div style={{ background: "#fff", border: "1px solid #E4E2E1", borderRadius: "8px", padding: "24px", marginTop: "24px" }}>
        <h2 style={{ fontWeight: 700, fontSize: "16px", marginBottom: "16px" }}>Items ({items.length})</h2>
        <div className="flex flex-col" style={{ gap: "16px" }}>
          {items.map((p, i) => (
            <div key={i} className="flex items-center" style={{ gap: "16px", borderTop: i === 0 ? "none" : "1px solid #EEF0F3", paddingTop: i === 0 ? 0 : "16px" }}>
              {(p.thumbnail || p.image) ? (
                <img src={p.thumbnail || p.image} alt={p.title} style={{ width: "64px", height: "64px", borderRadius: "6px", objectFit: "cover", background: "#E4E2E1" }} />
              ) : (
                <div style={{ width: "64px", height: "64px", borderRadius: "6px", background: "#E4E2E1" }} />
              )}
              <div className="flex flex-col flex-1" style={{ minWidth: 0 }}>
                <span className="line-clamp-1" style={{ fontWeight: 600, fontSize: "15px", color: "#1B1C1C" }}>{p.title}</span>
                <span style={{ fontSize: "13px", color: "#44474C" }}>Qty {p.quantity} · {cur(p.price)} each</span>
              </div>
              <span style={{ fontWeight: 700, fontSize: "15px", color: "#A43B31" }}>{cur(Number(p.price || 0) * Number(p.quantity || 0))}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Summary + meta */}
      <div className="flex" style={{ gap: "24px", marginTop: "24px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px", background: "#fff", border: "1px solid #E4E2E1", borderRadius: "8px", padding: "24px" }}>
          <h2 style={{ fontWeight: 700, fontSize: "16px", marginBottom: "16px" }}>Summary</h2>
          <div className="flex flex-col" style={{ gap: "10px" }}>
            <div className="flex" style={{ justifyContent: "space-between" }}><span style={{ color: "#44474C" }}>Items</span><span style={{ fontWeight: 600 }}>{cur(itemsTotal)}</span></div>
            <div className="flex" style={{ justifyContent: "space-between" }}><span style={{ color: "#44474C" }}>Shipping</span><span style={{ fontWeight: 600 }}>{shipping === 0 ? "Free" : cur(shipping)}</span></div>
            <div className="flex" style={{ justifyContent: "space-between", borderTop: "1px dashed #E4E2E1", paddingTop: "10px" }}><span style={{ fontWeight: 700 }}>Total</span><span style={{ fontWeight: 800, color: "#A43B31" }}>{cur(order.total)}</span></div>
          </div>
          <div className="flex flex-col" style={{ gap: "8px", marginTop: "20px" }}>
            <button onClick={buyAgain} className="flex items-center justify-center" style={{ height: "48px", background: "#783200", borderRadius: "4px", gap: "6px" }}>
              <RotateCcw size={14} style={{ color: "#fff" }} />
              <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "#fff" }}>Buy Again</span>
            </button>
            <button onClick={downloadInvoice} className="flex items-center justify-center" style={{ height: "48px", border: "1px solid #E4E2E1", borderRadius: "4px", gap: "6px" }}>
              <Download size={14} style={{ color: "#1B1C1C" }} />
              <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "#1B1C1C" }}>Download Invoice</span>
            </button>
          </div>
        </div>

        <div style={{ flex: "1 1 280px", background: "#fff", border: "1px solid #E4E2E1", borderRadius: "8px", padding: "24px" }}>
          <h2 style={{ fontWeight: 700, fontSize: "16px", marginBottom: "16px" }}>Delivery &amp; Payment</h2>
          <div className="flex flex-col" style={{ gap: "12px", fontSize: "14px" }}>
            <div className="flex flex-col">
              <span style={{ color: "#44474C", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.6px", fontWeight: 600 }}>Ship To</span>
              <span style={{ color: "#1B1C1C", marginTop: "2px" }}>{order.userName || user?.name || "—"}</span>
              <span style={{ color: "#44474C" }}>{order.address || order.shippingAddress || "No address on file"}</span>
            </div>
            <div className="flex flex-col">
              <span style={{ color: "#44474C", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.6px", fontWeight: 600 }}>Payment</span>
              <span style={{ color: "#1B1C1C", marginTop: "2px" }}>{order.paymentMethod || "—"} · {(order.paymentStatus || "").toUpperCase()}</span>
              {order.razorpayPaymentId && <span style={{ color: "#44474C", fontFamily: "monospace", fontSize: "13px" }}>{order.razorpayPaymentId}</span>}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  )
}

export default OrderDetailPage