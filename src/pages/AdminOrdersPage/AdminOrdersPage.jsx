import { useEffect, useLayoutEffect, useState, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import {
    collection,
    onSnapshot,
    doc,
    getDoc,
    query,
    orderBy,
    updateDoc
} from "firebase/firestore"

import { fireDB } from "../../context/FirebaseConfig"
import { generateInvoice } from "../../utils/generateInvoice"
import SearchBar from "../../components/SearchBar"
import PaginatedOrderTable from "../../features/orders/PaginatedOrderTable"
import useIsMobile from "../../hooks/useIsMobile"
import {
    Truck, CreditCard, Package, X, Download, Printer,
    CheckCircle2, PackageCheck
} from "lucide-react"
import gsap from "gsap"

/* ============================== FONTS ============================== */
// (tabs: Confirmed / Shipped / Delivered)
const MANROPE = "'Manrope', sans-serif"
const MONO = "'JetBrains Mono', monospace"
const INTER = "'Inter', sans-serif"

/* ============================== HELPERS ============================== */
const toDate = (v) => {
    if (!v) return null
    if (v?.toDate) return v.toDate()
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}
const formatINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Compute the correct final (discounted) price for an order line item.
 *
 * The old deployed backend stored finalPrice = originalPrice when it couldn't
 * parse the new MRP / Discounted-Price message format (the parsePrice regex
 * was stripping the decimal dot so ₹7.55 → 755, then the fallback set
 * finalPrice = catalog MRP). We detect that case by checking whether the
 * stored finalPrice ≥ originalPrice while a non-zero discount% exists, and
 * recompute from the discount percentage so the UI is always correct.
 */
const resolvedFinalPrice = (p) => {
    const mrp  = Number(p.originalPrice ?? p.price ?? 0)
    const disc = Number(p.discount || 0)
    const stored = Number(p.finalPrice ?? p.price ?? 0)
    if (disc > 0 && stored >= mrp && mrp > 0) {
        // Old-backend bug: finalPrice was set to MRP — recompute correctly.
        return Math.round(mrp * (1 - disc / 100) * 100) / 100
    }
    return stored || mrp
}
const fmtDateTime = (d) =>
    d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) +
        " • " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "—"
const initials = (name) => {
    if (!name) return "?"
    return String(name).trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()
}
const hashColor = (str) => {
    const colors = ["#7C3AED", "#2170E4", "#843700", "#783200", "#A43B31", "#0058BE"]
    let h = 0
    const s = String(str || "x")
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
    return colors[Math.abs(h) % colors.length]
}

const TABS = [
    { key: "confirmed", title: "Confirmed Orders", statuses: ["placed", "confirmed"], color: "#A43B31", activeBadgeBg: "rgba(99,14,212,0.12)", emptyIcon: CheckCircle2, emptyTitle: "No Orders to Dispatch" },
    { key: "shipped", title: "Shipped", statuses: ["shipped"], color: "#843700", activeBadgeBg: "rgba(132,55,0,0.12)", emptyIcon: Truck, emptyTitle: "No Active Shipments" },
    { key: "delivered", title: "Delivered", statuses: ["delivered"], color: "#783200", activeBadgeBg: "rgba(120,50,0,0.12)", emptyIcon: PackageCheck, emptyTitle: "No Completed Orders Yet" },
]
const INACTIVE_BADGE = { background: "rgba(74,68,85,0.08)", color: "#44474C" }

const AdminOrdersPage = () => {
    const [searchParams, setSearchParams] = useSearchParams()
    const [orders, setOrders] = useState([])
    // Search + active tab are initialised from (and reflected back to) the URL
    // so links like ?tab=confirmed&page=2&search=John are deep-linkable.
    const [searchTerm, setSearchTerm] = useState(() => searchParams.get("search") || "")
    const [selectedOrder, setSelectedOrder] = useState(null)
    const [activeTab, setActiveTab] = useState(() => {
        const t = searchParams.get("tab")
        return TABS.some((x) => x.key === t) ? t : "confirmed"
    })
    const [productImages, setProductImages] = useState({}) // productId -> real thumbnail
    const [drawerUserAddress, setDrawerUserAddress] = useState("")

    const containerRef = useRef(null)
    const drawerRef = useRef(null)

    // Mobile layout: this page is built with fixed-pixel inline styles, so we
    // branch the big chrome dimensions (header, side padding, drawer width) on a
    // viewport check instead of CSS media queries.
    const isMobile = useIsMobile(768)
    const sidePad = isMobile ? "16px" : "48px"

    /* ---------------- URL PARAM SYNC ---------------- */
    // Merge a partial update into the query string (drops empty values).
    const updateParams = (updates) => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev)
                Object.entries(updates).forEach(([k, v]) => {
                    if (v === "" || v == null) next.delete(k)
                    else next.set(k, String(v))
                })
                return next
            },
            { replace: true }
        )
    }
    const handleSearchChange = (v) => {
        setSearchTerm(v)
        updateParams({ search: v })
    }
    // The active tab's PaginatedOrderTable reports its page up for URL reflection.
    const handleActivePage = (p) => updateParams({ page: p })

    /* ---------------- REALTIME ORDERS LISTENER (kept) ---------------- */
    useEffect(() => {
        const q = query(collection(fireDB, "orders"), orderBy("createdAt", "desc"))
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setOrders(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })))
        })
        return () => unsubscribe()
    }, [])

    /* ---------------- TAB BUCKETING ---------------- */
    // Search is applied per-tab inside <PaginatedOrderTable>, so this returns the
    // full (unfiltered) bucket — tab badge counts therefore always show totals.
    // Confirmed tab intentionally includes still-"placed" (paid, not-yet-actioned) orders.
    const ordersForTab = (tab) => orders.filter((o) => tab.statuses.includes(o.orderStatus))

    /* ---------------- ORDER ACTIONS (kept) ---------------- */
    const updateStatus = async (orderId, status) => {
        try {
            await updateDoc(doc(fireDB, "orders", orderId), { orderStatus: status })
        } catch (err) {
            console.log(err)
        }
    }

    /* ---------------- TAB SWITCH ---------------- */
    // All three panels stay mounted (so each keeps its own page); we just toggle
    // visibility and fade the newly-active panel in.
    const switchTab = (newTab) => {
        if (newTab === activeTab) return
        setActiveTab(newTab)
        updateParams({ tab: newTab })
        gsap.fromTo(`.tab-panel-${newTab}`, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" })
    }

    /* ---------------- DRAWER ---------------- */
    const openOrder = (order) => setSelectedOrder(order)
    const closeDrawer = () => {
        if (drawerRef.current) {
            gsap.to(drawerRef.current, { xPercent: 100, duration: 0.3, ease: "power3.in", onComplete: () => setSelectedOrder(null) })
        } else {
            setSelectedOrder(null)
        }
    }
    // Animate transform (not `right`) so a realtime re-render can't reset the
    // drawer position; layout effect runs pre-paint to avoid an open-state flash.
    useLayoutEffect(() => {
        if (selectedOrder && drawerRef.current) {
            gsap.set(drawerRef.current, { xPercent: 100 })
            gsap.to(drawerRef.current, { xPercent: 0, duration: 0.4, ease: "power3.out" })
        }
    }, [selectedOrder])

    // Order line items don't store an image — fetch each product's real thumbnail
    // from the products collection when the drawer opens.
    useEffect(() => {
        if (!selectedOrder?.products?.length) return
        const ids = [...new Set(selectedOrder.products.map((p) => p.productId).filter((id) => id && !(id in productImages)))]
        if (ids.length === 0) return
        let cancelled = false
            ; (async () => {
                const found = {}
                await Promise.all(ids.map(async (id) => {
                    try {
                        const snap = await getDoc(doc(fireDB, "products", id))
                        if (snap.exists()) {
                            const d = snap.data()
                            found[id] = d.thumbnail || d.image || (Array.isArray(d.gallery) ? d.gallery[0] : "") || ""
                        } else found[id] = ""
                    } catch { found[id] = "" }
                }))
                if (!cancelled) setProductImages((prev) => ({ ...prev, ...found }))
            })()
        return () => { cancelled = true }
    }, [selectedOrder, productImages])

    // Fetch user address from Firestore as fallback for older orders
    // that were saved before userAddress was added to the order document.
    useEffect(() => {
        setDrawerUserAddress("")
        if (!selectedOrder) return
        if (selectedOrder.userAddress || selectedOrder.address || selectedOrder.shippingAddress) return
        if (!selectedOrder.userId) return
        let cancelled = false
        ;(async () => {
            try {
                const snap = await getDoc(doc(fireDB, "users", selectedOrder.userId))
                if (!cancelled && snap.exists()) setDrawerUserAddress(snap.data().address || "")
            } catch { /* non-fatal */ }
        })()
        return () => { cancelled = true }
    }, [selectedOrder])

    /* ---------------- LOAD ANIMATIONS ---------------- */
    useEffect(() => {
        if (!orders.length) return
        const ctx = gsap.context(() => {
            gsap.from(".analytics-card", { y: 20, opacity: 0, stagger: 0.1, duration: 0.6, ease: "power3.out" })
        }, containerRef)
        return () => ctx.revert()
    }, [orders.length])

    /* ---------------- ORDER CARD STAGGER (per tab) ---------------- */
    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.from(".order-card", { opacity: 0, y: 20, scale: 0.97, stagger: 0.06, duration: 0.35, ease: "power3.out", delay: 0.1 })
        }, containerRef)
        return () => ctx.revert()
    }, [activeTab, orders.length])

    /* ---------------- ANALYTICS (realtime from orders) ---------------- */
    const total = orders.length
    const placedCount = orders.filter((o) => o.orderStatus === "placed").length
    const shippedCount = orders.filter((o) => o.orderStatus === "shipped").length
    const deliveredCount = orders.filter((o) => o.orderStatus === "delivered").length

    /* ---------------- INVOICE DOWNLOAD (professional PDF) ---------------- */
    const downloadInvoice = (order) => {
        try {
            generateInvoice(order, {
                name: order.userName,
                email: order.userEmail,
                phone: order.userPhone || order.phone,
                address: order.userAddress || order.address || order.shippingAddress,
            })
        } catch (err) {
            console.error("Invoice error:", err)
        }
    }

    /* ============================== ORDER CARD ============================== */
    const OrderCard = ({ order, column }) => {
        const av = order.userAvatar
        const avBg = hashColor(order.userName)
        return (
            <div
                className="order-card cursor-pointer"
                onClick={() => openOrder(order)}
                style={{ background: "#fff", border: "1px solid rgba(204,195,216,0.3)", boxShadow: "0px 1px 2px rgba(0,0,0,0.05)", borderRadius: "24px", padding: "24px", width: "100%", display: "flex", flexDirection: "column", gap: "16px" }}
            >
                {/* Row 1 — header */}
                <div className="flex items-start justify-between">
                    <div>
                        <p style={{ fontFamily: MONO, fontSize: "12px", color: "#44474C", letterSpacing: "0.6px" }}>#{order.externalOrderId ? String(order.externalOrderId).replace(/^#/, "") : order.id}</p>
                        <p style={{ fontFamily: MANROPE, fontWeight: 800, fontSize: "24px", color: "#1B1C1C", marginTop: "2px" }}>{formatINR(order.total)}</p>
                    </div>
                    {av ? (
                        <img src={av} alt="" className="flex-shrink-0" style={{ width: "40px", height: "40px", borderRadius: "9999px", border: "2px solid #fff", boxShadow: "0px 1px 4px rgba(0,0,0,0.1)", objectFit: "cover" }} />
                    ) : (
                        <span className="flex items-center justify-center flex-shrink-0 text-white font-bold" style={{ width: "40px", height: "40px", borderRadius: "9999px", border: "2px solid #fff", boxShadow: "0px 1px 4px rgba(0,0,0,0.1)", background: avBg, fontSize: "13px" }}>{initials(order.userName)}</span>
                    )}
                </div>

                {/* Row 2 — customer */}
                <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "16px", color: "#1B1C1C" }}>{order.userName || "Guest"}</p>

                {/* Row 3 — products */}
                <div style={{ background: "rgba(249,241,255,0.5)", border: "1px solid rgba(204,195,216,0.1)", borderRadius: "12px", padding: "12px", maxHeight: "104px", overflowY: "auto" }}>
                    {(order.products || []).map((p, i) => (
                        <p key={i} style={{ fontFamily: MONO, fontWeight: 500, fontSize: "13px", color: "#44474C", lineHeight: "22px" }}>
                            {p.title} x{p.quantity}
                        </p>
                    ))}
                    {(!order.products || order.products.length === 0) && (
                        <p style={{ fontFamily: MONO, fontSize: "13px", color: "#44474C", opacity: 0.5 }}>No items</p>
                    )}
                </div>

                {/* Row 4 — payment */}
                <div className="flex items-center gap-2">
                    <CreditCard size={14} style={{ color: "#44474C" }} />
                    <span style={{ fontFamily: INTER, fontWeight: 500, fontSize: "12px", color: "#44474C", letterSpacing: "0.6px" }}>{order.paymentMethod || "Paid via Credit Card"}</span>
                </div>

                {/* Row 5 — action (per tab) */}
                {column === "confirmed" && (
                    <button onClick={(e) => { e.stopPropagation(); updateStatus(order.id, "shipped") }} className="w-full text-white" style={{ background: "#A43B31", borderRadius: "12px", height: "52px", boxShadow: "0px 4px 6px rgba(0,0,0,0.1)", fontFamily: INTER, fontWeight: 700, fontSize: "16px" }}>Initiate Transit</button>
                )}
                {column === "shipped" && (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <span style={{ background: "rgba(132,55,0,0.1)", color: "#843700", borderRadius: "9999px", padding: "4px 10px", fontFamily: INTER, fontWeight: 700, fontSize: "12px", letterSpacing: "0.6px" }}>Out for Delivery</span>
                            <span style={{ fontFamily: MONO, fontSize: "12px", color: "#44474C" }}>ETA: 2h</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); updateStatus(order.id, "delivered") }} className="w-full" style={{ background: "#E8DFEE", color: "#44474C", borderRadius: "12px", height: "44px", fontFamily: INTER, fontWeight: 700, fontSize: "14px" }}>Mark Delivered</button>
                    </div>
                )}
            </div>
        )
    }

    /* ============================== ANALYTICS CARD ============================== */
    const cardBase = { background: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.3)", boxShadow: "0px 8px 32px rgba(124,58,237,0.05)", backdropFilter: "blur(12px)", borderRadius: "24px", padding: "24px", minHeight: "126px" }
    const labelStyle = { fontFamily: MONO, fontSize: "13px", color: "#44474C", opacity: 0.7 }
    const valueStyle = { fontFamily: MANROPE, fontWeight: 800, fontSize: "36px", letterSpacing: "-0.9px" }

    /* ============================== DRAWER ============================== */
    const Drawer = () => {
        const o = selectedOrder
        if (!o) return null
        const created = toDate(o.createdAt)
        const status = o.orderStatus
        const paymentDone = ["confirmed", "shipped", "delivered"].includes(status)
        const processingDone = ["shipped", "delivered"].includes(status)
        const productsCount = o.products?.length || 0

        const TimelineStep = ({ title, subtitle, done, last }) => (
            <div className="flex gap-4">
                <div className="flex flex-col items-center">
                    <span style={{ width: "20px", height: "20px", borderRadius: "9999px", background: done ? "#A43B31" : "#CCC3D8", boxShadow: done ? "0px 0px 0px 4px rgba(99,14,212,0.2)" : "none" }} />
                    {!last && <span style={{ width: "2px", flex: 1, minHeight: "32px", background: "#CCC3D8", marginTop: "4px" }} />}
                </div>
                <div style={{ paddingBottom: last ? 0 : "12px" }}>
                    <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "16px", color: done ? "#1B1C1C" : "#1B1C1C", opacity: done ? 1 : 0.4 }}>{title}</p>
                    <p style={{ fontFamily: INTER, fontWeight: 500, fontSize: "14px", color: "#44474C", opacity: done ? 1 : 0.4 }}>{subtitle}</p>
                </div>
            </div>
        )

        return (
            <div ref={drawerRef} className="fixed top-0 bottom-0 overflow-y-auto" style={{ right: 0, width: "500px", maxWidth: "100vw", background: "#FBF9F8", borderLeft: "1px solid #CCC3D8", boxShadow: "0px 25px 50px -12px rgba(0,0,0,0.25)", zIndex: 50 }}>
                <div style={{ padding: isMobile ? "20px" : "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
                    {/* Top row */}
                    <div className="flex items-center justify-between">
                        <h2 style={{ fontFamily: INTER, fontWeight: 800, fontSize: "30px", color: "#1B1C1C", letterSpacing: "-0.75px" }}>Order Details</h2>
                        <button onClick={closeDrawer} className="flex items-center justify-center" style={{ width: "40px", height: "40px", borderRadius: "9999px", background: "rgba(204,195,216,0.2)" }}><X size={18} style={{ color: "#44474C" }} /></button>
                    </div>

                    {/* Summary row */}
                    <div className="flex items-start justify-between" style={{ borderBottom: "1px solid rgba(204,195,216,0.3)", paddingBottom: "16px" }}>
                        <div>
                            <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "#44474C", letterSpacing: "1.8px" }}>ORDER ID</p>
                            <p style={{ fontFamily: MONO, fontWeight: 800, fontSize: "18px", color: "#1B1C1C" }}>#{o.externalOrderId ? String(o.externalOrderId).replace(/^#/, "") : o.id}</p>
                        </div>
                        <div className="text-right">
                            <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "#44474C", letterSpacing: "1.8px" }}>TOTAL AMOUNT</p>
                            <p style={{ fontFamily: INTER, fontWeight: 800, fontSize: "18px", color: "#A43B31", letterSpacing: "-1.5px" }}>{formatINR(o.total)}.00</p>
                        </div>
                    </div>

                    {/* Timeline */}
                    <div style={{ paddingTop: "8px" }}>
                        <div className="flex items-center gap-3" style={{ marginBottom: "20px" }}>
                            <span style={{ width: "4px", height: "20px", background: "#A43B31", borderRadius: "9999px" }} />
                            <h3 style={{ fontFamily: INTER, fontWeight: 700, fontSize: "18px", color: "#1B1C1C" }}>Order Timeline</h3>
                        </div>
                        <TimelineStep title="Order Placed" subtitle={fmtDateTime(created)} done />
                        <TimelineStep title="Payment Confirmed" subtitle={paymentDone ? fmtDateTime(created) : "Pending"} done={paymentDone} />
                        <TimelineStep title="Processing" subtitle={processingDone ? "Dispatched from warehouse" : "Awaiting Warehouse Confirmation"} done={processingDone} last />
                    </div>

                    {/* Customer Information */}
                    <div className="relative" style={{ background: "#F9F1FF", border: "1px solid rgba(204,195,216,0.3)", boxShadow: "0px 1px 2px rgba(0,0,0,0.05)", borderRadius: "24px", padding: "64px 32px 32px", marginTop: "40px" }}>
                        {o.userAvatar ? (
                            <img src={o.userAvatar} alt="" className="absolute" style={{ top: "-40px", left: "32px", width: "80px", height: "80px", borderRadius: "24px", boxShadow: "0px 0px 0px 2px #fff, 0px 4px 6px rgba(0,0,0,0.1)", objectFit: "cover" }} />
                        ) : (
                            <span className="absolute flex items-center justify-center text-white font-bold" style={{ top: "-40px", left: "32px", width: "80px", height: "80px", borderRadius: "24px", boxShadow: "0px 0px 0px 2px #fff, 0px 4px 6px rgba(0,0,0,0.1)", background: hashColor(o.userName), fontSize: "28px", fontFamily: MANROPE }}>{initials(o.userName)}</span>
                        )}
                        <h3 style={{ fontFamily: INTER, fontWeight: 700, fontSize: "18px", color: "#1B1C1C", marginBottom: "12px" }}>Customer Information</h3>
                        <p style={{ fontFamily: INTER, fontWeight: 800, fontSize: "20px", color: "#1B1C1C" }}>{o.userName || "Guest"}</p>
                        <p style={{ fontFamily: INTER, fontWeight: 500, fontSize: "14px", color: "#44474C" }}>{o.userEmail || "—"}{o.userPhone ? ` • ${o.userPhone}` : ""}</p>

                        <div style={{ marginTop: "20px" }}>
                            <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "#44474C", letterSpacing: "2.4px", textTransform: "uppercase" }}>Shipping Address</p>
                            <p style={{ fontFamily: INTER, fontWeight: 500, fontSize: "14px", lineHeight: "23px", color: "#1B1C1C", marginTop: "4px" }}>{o.userAddress || o.address || o.shippingAddress || drawerUserAddress || "No address on file"}</p>
                        </div>

                        <div style={{ marginTop: "20px" }}>
                            <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "#44474C", letterSpacing: "2.4px", textTransform: "uppercase" }}>Payment Method</p>
                            <div className="flex items-center gap-2" style={{ marginTop: "4px" }}>
                                <CreditCard size={16} style={{ color: "#A43B31" }} />
                                <span style={{ fontFamily: INTER, fontWeight: 500, fontSize: "14px", color: "#1B1C1C" }}>{o.paymentMethod || "Credit Card"}</span>
                            </div>
                            {o.razorpayPaymentId && (
                                <div className="flex items-center gap-2" style={{ marginTop: "8px" }}>
                                    <span style={{ fontFamily: INTER, fontWeight: 600, fontSize: "12px", color: "#44474C" }}>Txn ID</span>
                                    <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: "13px", color: "#1B1C1C", background: "rgba(99,14,212,0.08)", padding: "2px 8px", borderRadius: "6px" }}>{o.razorpayPaymentId}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Ordered Products */}
                    <div style={{ paddingTop: "32px" }}>
                        <div className="flex items-center justify-between" style={{ marginBottom: "16px" }}>
                            <h3 style={{ fontFamily: INTER, fontWeight: 700, fontSize: "18px", color: "#1B1C1C" }}>Ordered Products</h3>
                            <span style={{ background: "#EDE5F4", fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "#1B1C1C", padding: "4px 12px", borderRadius: "9999px" }}>{productsCount} ITEMS</span>
                        </div>
                        <div className="flex flex-col gap-3">
                            {(o.products || []).map((p, i) => (
                                <div key={i} className="flex items-center gap-5" style={{ background: "rgba(255,255,255,0.5)", border: "1px solid rgba(204,195,216,0.3)", borderRadius: "24px", padding: "20px" }}>
                                    <span className="flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ width: "64px", height: "64px", background: "rgba(124,58,237,0.2)", borderRadius: "12px" }}>
                                        {(productImages[p.productId] || p.image) ? <img src={productImages[p.productId] || p.image} alt={p.title} className="w-full h-full object-cover" /> : <Package size={22} style={{ color: "#A43B31" }} />}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "16px", color: "#1B1C1C" }} className="truncate">{p.title}</p>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                            <p style={{ fontFamily: INTER, fontWeight: 500, fontSize: "12px", color: "#44474C" }}>Qty: {p.quantity} •</p>
                                            <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "#A43B31" }}>{formatINR(resolvedFinalPrice(p))} each</p>
                                            {Number(p.discount) > 0 && (
                                                <p style={{ fontFamily: INTER, fontWeight: 400, fontSize: "11px", color: "#74777D", textDecoration: "line-through" }}>{formatINR(p.originalPrice ?? p.price ?? 0)}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                        <p style={{ fontFamily: INTER, fontWeight: 800, fontSize: "18px", color: "#1B1C1C" }}>{formatINR(resolvedFinalPrice(p) * p.quantity)}</p>
                                        {Number(p.discount) > 0 && (
                                            <p style={{ fontFamily: INTER, fontWeight: 400, fontSize: "11px", color: "#74777D" }}>{Math.round(Number(p.discount))}% OFF</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Bottom actions */}
                    <div className="flex gap-4" style={{ paddingTop: "32px", borderTop: "1px solid rgba(204,195,216,0.2)" }}>
                        <button onClick={() => downloadInvoice(o)} className="flex items-center justify-center gap-2 text-white flex-1" style={{ background: "#A43B31", borderRadius: "24px", height: "64px", fontFamily: INTER, fontWeight: 700, fontSize: "16px" }}>
                            <Download size={18} /> Download Invoice
                        </button>
                        <button onClick={() => window.print()} className="flex items-center justify-center flex-shrink-0" style={{ width: "64px", height: "64px", borderRadius: "24px", border: "2px solid rgba(204,195,216,0.3)" }}>
                            <Printer size={20} style={{ color: "#44474C" }} />
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    /* ============================== RENDER ============================== */
    return (
        <div ref={containerRef} className="relative min-h-screen" style={{ background: "#FBF9F8", fontFamily: INTER, marginTop: isMobile ? "96px" : 0 }}>
            {/* Background blobs */}
            <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
                <div className="absolute" style={{ top: "-100px", left: "-100px", width: "576px", height: "576px", borderRadius: "9999px", background: "rgba(99,14,212,0.15)", filter: "blur(70px)" }} />
                <div className="absolute" style={{ bottom: "-150px", right: "-150px", width: "704px", height: "704px", borderRadius: "9999px", background: "rgba(0,88,190,0.10)", filter: "blur(80px)" }} />
                <div className="absolute" style={{ bottom: "-100px", left: "40%", width: "512px", height: "512px", borderRadius: "9999px", background: "rgba(170,73,0,0.10)", filter: "blur(60px)" }} />
            </div>

            {/* Main content */}
            <div style={{ padding: isMobile ? "16px 0 48px" : "24px 0 48px", display: "flex", flexDirection: "column" }}>
                {/* Analytics cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: isMobile ? "12px" : "24px", padding: `0 ${sidePad}`, marginBottom: isMobile ? "24px" : "40px" }}>
                    <div className="analytics-card flex flex-col" style={{ ...cardBase, gap: "12px" }}>
                        <div className="flex items-center justify-between">
                            <span style={labelStyle}>TOTAL ORDERS</span>
                            <span style={{ background: "rgba(0,88,190,0.1)", color: "#0058BE", fontFamily: MONO, fontSize: "12px", letterSpacing: "0.6px", borderRadius: "9999px", padding: "4px 10px" }}>+12.4%</span>
                        </div>
                        <span style={{ ...valueStyle, color: "#A43B31" }}>{total}</span>
                    </div>

                    <div className="analytics-card flex flex-col" style={{ ...cardBase, gap: "12px" }}>
                        <div className="flex items-center justify-between">
                            <span style={labelStyle}>AWAITING CONFIRMATION</span>
                            <span style={{ background: "rgba(132,55,0,0.1)", color: "#843700", fontFamily: MONO, fontSize: "12px", letterSpacing: "0.6px", borderRadius: "9999px", padding: "4px 10px" }}>Action Required</span>
                        </div>
                        <span style={{ ...valueStyle, color: "#1B1C1C" }}>{placedCount}</span>
                    </div>

                    <div className="analytics-card flex flex-col" style={{ ...cardBase, gap: "12px" }}>
                        <div className="flex items-center justify-between">
                            <span style={labelStyle}>IN TRANSIT</span>
                            <Truck size={20} style={{ color: "#2170E4", opacity: 0.5 }} />
                        </div>
                        <span style={{ ...valueStyle, color: "#2170E4" }}>{shippedCount}</span>
                    </div>

                    <div className="analytics-card flex flex-col" style={{ ...cardBase, gap: "12px" }}>
                        <span style={labelStyle}>DELIVERED</span>
                        <span style={{ ...valueStyle, color: "#783200" }}>{deliveredCount}</span>
                        <div style={{ background: "rgba(120,50,0,0.1)", height: "8px", borderRadius: "9999px", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${total ? (deliveredCount / total) * 100 : 0}%`, background: "#783200", borderRadius: "9999px" }} />
                        </div>
                    </div>
                </div>

                {/* Tab bar + search — tabs on the left, search on the right (stacks below
            the tabs on narrow screens). Tabs scroll horizontally if they overflow. */}
                <div className={`flex ${isMobile ? "flex-col gap-3" : "items-center gap-6"}`} style={{ borderBottom: "1px solid rgba(204,195,216,0.3)", padding: `0 ${sidePad}`, paddingBottom: isMobile ? "12px" : "0" }}>
                    <div className="flex no-scrollbar" style={{ overflowX: "auto", ...(isMobile ? {} : { flex: 1, minWidth: 0 }) }}>
                        {TABS.map((tab) => {
                            const isActive = activeTab === tab.key
                            const count = ordersForTab(tab).length
                            return (
                                <button
                                    key={tab.key}
                                    onClick={() => switchTab(tab.key)}
                                    className="flex items-center flex-shrink-0"
                                    style={{
                                        gap: "10px",
                                        padding: isMobile ? "16px 16px" : "20px 32px",
                                        whiteSpace: "nowrap",
                                        fontFamily: INTER,
                                        fontSize: "15px",
                                        fontWeight: isActive ? 700 : 600,
                                        color: isActive ? tab.color : "#1B1C1C",
                                        opacity: isActive ? 1 : 0.6,
                                        borderBottom: `3px solid ${isActive ? tab.color : "transparent"}`,
                                        background: "transparent",
                                        transition: "all 0.2s ease",
                                    }}
                                >
                                    {isActive && <span style={{ width: "8px", height: "20px", background: tab.color, borderRadius: "9999px" }} />}
                                    {tab.title}
                                    <span style={{
                                        fontFamily: MONO, fontWeight: 700, fontSize: "12px", borderRadius: "9999px",
                                        padding: "3px 10px", minWidth: "28px", textAlign: "center",
                                        ...(isActive ? { background: tab.activeBadgeBg, color: tab.color } : INACTIVE_BADGE),
                                    }}>{count}</span>
                                </button>
                            )
                        })}
                    </div>
                    <div className="flex-shrink-0" style={{ width: isMobile ? "100%" : "340px" }}>
                        <SearchBar
                            value={searchTerm}
                            onChange={handleSearchChange}
                            placeholder="Search by Order ID or customer…"
                        />
                    </div>
                </div>

                {/* Tab panels — all three stay mounted so each keeps its own page/search state */}
                {TABS.map((tab) => {
                    const isActive = activeTab === tab.key
                    const list = ordersForTab(tab)
                    const EmptyIcon = tab.emptyIcon
                    return (
                        <div
                            key={tab.key}
                            className={`tab-panel tab-panel-${tab.key} ${isActive ? "" : "hidden"}`}
                            style={{ padding: isMobile ? "24px 16px" : "40px 48px", minHeight: "calc(100vh - 300px)" }}
                        >
                            {/* Panel header */}
                            <div className="flex items-center justify-between" style={{ marginBottom: isMobile ? "20px" : "32px" }}>
                                <div className="flex items-center gap-3 sm:gap-4">
                                    <span style={{ width: "8px", height: isMobile ? "28px" : "40px", background: tab.color, borderRadius: "9999px", flexShrink: 0 }} />
                                    <h2 style={{ fontFamily: MANROPE, fontWeight: 800, fontSize: isMobile ? "22px" : "32px", color: "#1B1C1C", letterSpacing: isMobile ? "-0.5px" : "-1px", textTransform: "uppercase" }}>{tab.title}</h2>
                                    <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: isMobile ? "14px" : "18px", borderRadius: "9999px", padding: isMobile ? "4px 12px" : "6px 16px", background: tab.activeBadgeBg, color: tab.color, flexShrink: 0 }}>{list.length}</span>
                                </div>
                            </div>

                            <PaginatedOrderTable
                                orders={list}
                                search={searchTerm}
                                active={isActive}
                                onActivePageChange={handleActivePage}
                                renderItem={(order) => <OrderCard key={order.id} order={order} column={tab.key} />}
                                emptyState={
                                    <div className="flex flex-col items-center justify-center text-center" style={{ border: "2px dashed rgba(204,195,216,0.5)", borderRadius: "32px", padding: "80px 48px", background: "rgba(255,255,255,0.4)", backdropFilter: "blur(12px)", gap: "16px" }}>
                                        <EmptyIcon size={48} style={{ color: tab.color, opacity: 0.3 }} />
                                        <p style={{ fontFamily: MANROPE, fontWeight: 800, fontSize: "28px", color: "#1B1C1C", letterSpacing: "-0.5px" }}>{tab.emptyTitle}</p>
                                        <p style={{ fontFamily: INTER, fontWeight: 500, fontSize: "16px", color: "#44474C", opacity: 0.6 }}>All quiet here. New orders will appear instantly.</p>
                                    </div>
                                }
                            />
                        </div>
                    )
                })}
            </div>

            {/* Backdrop + Drawer (inlined so its DOM node stays stable across re-renders) */}
            {selectedOrder && (
                <div className="fixed inset-0" style={{ zIndex: 40, background: "rgba(29,26,36,0.2)" }} onClick={closeDrawer} />
            )}
            {Drawer()}
        </div>
    )
}

export default AdminOrdersPage