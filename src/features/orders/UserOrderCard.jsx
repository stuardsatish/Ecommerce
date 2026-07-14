import { Truck, CheckCircle2, XCircle, RotateCcw, Star } from "lucide-react"

/* Shared between /userorders and /userpastorders.
   Layout matches the reference: 2 columns —
     LEFT  : order info (top) + product thumbnails & summary (bottom)
     RIGHT : status badge (top) + action buttons (bottom)
   Buttons: delivered/cancelled → Buy Again + View Details; ongoing → View Details only. */

const cur = (n) => `₹${Number(n || 0).toFixed(2)}`
const toJsDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null)
const fmtDate = (v) => {
  const d = toJsDate(v)
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"
}
export const orderNo = (o) => {
  if (!o) return ""
  return o.externalOrderId ? String(o.externalOrderId).replace(/^#/, "") : (o.id || o.orderId || "")
}
export const statusMeta = (o) => {
  const s = (o.orderStatus || "").toLowerCase()
  if (s === "delivered") return { key: "DELIVERED", label: "Delivered", bg: "#DCFCE7", color: "#15803D", icon: "check" }
  if (s === "cancelled") return { key: "CANCELLED", label: "Cancelled", bg: "#FFDAD6", color: "#BA1A1A", icon: "x" }
  if (s === "shipped") return { key: "IN_TRANSIT", label: "In Transit", bg: "#39B8FD", color: "#004666", icon: "truck" }
  return { key: "PROCESSING", label: "Processing", bg: "#BEE3FB", color: "#004666", icon: "truck" }
}

export default function UserOrderCard({ order, onBuyAgain, onViewDetails, onReviewClick = () => {}, userReviews = {} }) {
  const m = statusMeta(order)
  const items = order.products || []
  const thumbs = items.slice(0, 2)
  const extra = items.length - 2
  const isDone = m.key === "DELIVERED" || m.key === "CANCELLED"

  return (
    <div className="order-card flex flex-col" style={{ background: "#fff", border: "1px solid #E4E2E1", borderRadius: "8px", padding: "24px", gap: "24px", boxShadow: "0px 1px 2px rgba(16,24,40,0.04), 0px 1px 3px rgba(16,24,40,0.08)" }}>
      <div className="flex" style={{ gap: "24px", alignItems: "stretch", width: "100%" }}>
        {/* LEFT — order info (top) + products (bottom) */}
        <div className="flex flex-col" style={{ justifyContent: "space-between", gap: "24px", flexGrow: 1, minWidth: 0 }}>
          <div className="flex flex-col">
            <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "#44474C" }}>Order ID</span>
            <span style={{ fontWeight: 600, fontSize: "20px", color: "#1B1C1C", paddingTop: "4px" }}>#{orderNo(order)}</span>
            <span style={{ fontWeight: 400, fontSize: "14px", color: "#44474C" }}>Placed on {fmtDate(order.createdAt)}</span>
          </div>

          <div className="flex items-center" style={{ gap: "16px" }}>
            <div className="flex">
              {thumbs.map((p, idx) => (
                (p.thumbnail || p.image) ? (
                  <img key={idx} src={p.thumbnail || p.image} alt={p.title} style={{ width: "64px", height: "64px", border: "2px solid #fff", borderRadius: "4px", objectFit: "cover", marginLeft: idx === 0 ? 0 : "-16px", background: "#E4E2E1", boxShadow: "0 0 0 1px #E4E2E1" }} />
                ) : (
                  <div key={idx} style={{ width: "64px", height: "64px", border: "2px solid #fff", borderRadius: "4px", marginLeft: idx === 0 ? 0 : "-16px", background: "#E4E2E1" }} />
                )
              ))}
              {extra > 0 && (
                <div className="flex items-center justify-center" style={{ width: "64px", height: "64px", background: "#DEE9FC", border: "2px solid #fff", borderRadius: "4px", marginLeft: "-16px", fontWeight: 400, fontSize: "16px", color: "#44474C" }}>+{extra}</div>
              )}
            </div>
            <div className="flex flex-col" style={{ justifyContent: "center" }}>
              <span style={{ fontWeight: 400, fontSize: "14px", color: "#1B1C1C" }}>{items.length > 1 ? `${items.length} items in total` : (items[0]?.title || "1 item")}</span>
              <span style={{ fontWeight: 500, fontSize: "14px", color: "#44474C" }}>Total: {cur(order.total)}</span>
            </div>
          </div>
        </div>

        {/* RIGHT — status badge (top) + buttons (bottom) */}
        <div className="flex flex-col items-end" style={{ justifyContent: "space-between", width: "180px", minWidth: "180px" }}>
          <span className="flex items-center" style={{ background: m.bg, borderRadius: "12px", padding: "4px 16px", gap: "4px" }}>
            {m.icon === "truck" && <Truck size={13} style={{ color: m.color }} />}
            {m.icon === "check" && <CheckCircle2 size={12} style={{ color: m.color }} />}
            {m.icon === "x" && <XCircle size={12} style={{ color: m.color }} />}
            <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", color: m.color }}>{m.label}</span>
          </span>

          <div className="flex flex-col" style={{ gap: "8px", width: "100%", marginTop: "16px" }}>
            {isDone && (
              <button onClick={() => onBuyAgain(order)} className="flex items-center justify-center" style={{ width: "100%", height: "48px", background: "#783200", borderRadius: "4px", gap: "4px" }}>
                <RotateCcw size={14} style={{ color: "#fff" }} />
                <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "#fff" }}>{m.key === "DELIVERED" ? "Buy Again" : "Reorder"}</span>
              </button>
            )}
            <button onClick={() => onViewDetails(order)} className="flex items-center justify-center" style={{ width: "100%", height: "50px", border: "1px solid #E4E2E1", borderRadius: "4px", background: "#fff" }}>
              <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "#1B1C1C" }}>View Details</span>
            </button>
          </div>
        </div>
      </div>

      {/* REVIEWS SECTION — Render products and review actions for delivered orders on desktop */}
      {order.orderStatus === "delivered" && items.length > 0 && (
        <div style={{ borderTop: "1px solid #E4E2E1", paddingTop: "16px", width: "100%" }}>
          <p style={{ fontWeight: 700, fontSize: "14px", color: "#1B1C1C", marginBottom: "12px" }}>Product Reviews</p>
          <div className="flex flex-col" style={{ gap: "12px" }}>
            {items.map((item, index) => (
              <div key={index} className="flex items-center justify-between" style={{ gap: "12px" }}>
                <div className="flex items-center" style={{ gap: "12px", minWidth: 0 }}>
                  <div className="flex-shrink-0 flex items-center justify-center" style={{ width: "40px", height: "40px", background: "#F6F3F2", borderRadius: "6px", padding: "2px" }}>
                    <img src={item.thumbnail || item.image || "https://via.placeholder.com/64"} alt="" className="w-full h-full" style={{ objectFit: "cover", borderRadius: "4px" }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: "14px", color: "#1B1C1C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</p>
                    <p style={{ fontSize: "12px", color: "#74777D" }}>Qty: {item.quantity}</p>
                  </div>
                </div>
                {userReviews && userReviews[item.productId] ? (
                  <button onClick={() => onReviewClick(item, order.id)} className="flex items-center" style={{ gap: "4px", fontSize: "12px", fontWeight: 700, color: "#A43B31", background: "transparent", border: "none", cursor: "pointer" }}>
                    <div className="flex items-center" style={{ gap: "2px", marginRight: "4px" }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star key={star} size={14} style={{ fill: userReviews[item.productId].rating >= star ? "#D4AF37" : "none", color: userReviews[item.productId].rating >= star ? "#D4AF37" : "#C4C6CD" }} />
                      ))}
                    </div>
                    <span>(Edit Review)</span>
                  </button>
                ) : (
                  <button onClick={() => onReviewClick(item, order.id)} className="flex items-center" style={{ gap: "4px", fontSize: "12px", fontWeight: 700, color: "#A43B31", background: "transparent", border: "none", cursor: "pointer" }}>
                    <Star size={14} /> Write Review
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}