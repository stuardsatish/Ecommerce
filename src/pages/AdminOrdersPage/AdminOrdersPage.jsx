import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  query,
  orderBy,
  updateDoc,
} from "firebase/firestore";

import { fireDB } from "../../context/FirebaseConfig";
import { generateInvoice } from "../../utils/generateInvoice";
import {
  paymentMethodLabel,
  paymentStatusLabel,
  isCodPending,
} from "../../utils/paymentLabels";
import SearchBar from "../../components/SearchBar";
import PaginatedOrderTable from "../../features/orders/PaginatedOrderTable";
import useIsMobile from "../../hooks/useIsMobile";
import {
  Truck,
  CreditCard,
  Package,
  X,
  Download,
  Printer,
  CheckCircle2,
  PackageCheck,
  Banknote,
} from "lucide-react";
import gsap from "gsap";

/* ============================== FONTS ============================== */
// (tabs: Confirmed / Shipped / Delivered)
const MANROPE = "'Manrope', sans-serif";
const MONO = "'JetBrains Mono', monospace";
const INTER = "'Inter', sans-serif";

/* ============================== HELPERS ============================== */
const toDate = (v) => {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Address may be a plain string OR the profile/order object shape
// ({ street, city, state, pincode }). Normalise to a single readable line so
// React never receives a raw object as a child.
const formatAddress = (v) => {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    return [v.street, v.city, v.state, v.pincode, v.country]
      .map((s) => String(s ?? "").trim())
      .filter(Boolean)
      .join(", ");
  }
  return "";
};

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
  const mrp = Number(p.originalPrice ?? p.price ?? 0);
  const disc = Number(p.discount || 0);
  const stored = Number(p.finalPrice ?? p.price ?? 0);
  if (disc > 0 && stored >= mrp && mrp > 0) {
    // Old-backend bug: finalPrice was set to MRP — recompute correctly.
    return Math.round(mrp * (1 - disc / 100) * 100) / 100;
  }
  return stored || mrp;
};
const fmtDateTime = (d) =>
  d
    ? d.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }) +
      " • " +
      d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—";
const initials = (name) => {
  if (!name) return "?";
  return String(name)
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
};
const hashColor = (str) => {
  const colors = [
    "var(--color-accent-strong)",
    "var(--color-info)",
    "var(--color-accent-strong)",
    "var(--color-accent-strong)",
    "var(--color-primary)",
    "var(--color-info)",
  ];
  let h = 0;
  const s = String(str || "x");
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
};

const TABS = [
  {
    key: "confirmed",
    title: "Confirmed Orders",
    statuses: ["placed", "confirmed"],
    color: "var(--color-primary)",
    activeBadgeBg: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
    emptyIcon: CheckCircle2,
    emptyTitle: "No Orders to Dispatch",
  },
  {
    key: "shipped",
    title: "Shipped",
    statuses: ["shipped"],
    color: "var(--color-accent-strong)",
    activeBadgeBg:
      "color-mix(in srgb, var(--color-accent-strong) 12%, transparent)",
    emptyIcon: Truck,
    emptyTitle: "No Active Shipments",
  },
  {
    key: "delivered",
    title: "Delivered",
    statuses: ["delivered"],
    color: "var(--color-accent-strong)",
    activeBadgeBg:
      "color-mix(in srgb, var(--color-accent-strong) 12%, transparent)",
    emptyIcon: PackageCheck,
    emptyTitle: "No Completed Orders Yet",
  },
];
const INACTIVE_BADGE = {
  background: "var(--color-surface-muted)",
  color: "var(--color-body)",
};

const AdminOrdersPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true); // Search + active tab are initialised from (and reflected back to) the URL
  // so links like ?tab=confirmed&page=2&search=John are deep-linkable.
  const [searchTerm, setSearchTerm] = useState(
    () => searchParams.get("search") || "",
  );
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get("tab");
    return TABS.some((x) => x.key === t) ? t : "confirmed";
  });
  const [productImages, setProductImages] = useState({}); // productId -> real thumbnail
  const [drawerUserAddress, setDrawerUserAddress] = useState("");

  const containerRef = useRef(null);
  const drawerRef = useRef(null); // Mobile layout: this page is built with fixed-pixel inline styles, so we
  // branch the big chrome dimensions (header, side padding, drawer width) on a
  // viewport check instead of CSS media queries.

  const isMobile = useIsMobile(768);
  const sidePad = isMobile
    ? "16px"
    : "48px"; /* ---------------- URL PARAM SYNC ---------------- */ // Merge a partial update into the query string (drops empty values).

  const updateParams = (updates) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(updates).forEach(([k, v]) => {
          if (v === "" || v == null) next.delete(k);
          else next.set(k, String(v));
        });
        return next;
      },
      { replace: true },
    );
  };
  const handleSearchChange = (v) => {
    setSearchTerm(v);
    updateParams({ search: v });
  }; // The active tab's PaginatedOrderTable reports its page up for URL reflection.
  const handleActivePage = (p) =>
    updateParams({
      page: p,
    }); /* ---------------- REALTIME ORDERS LISTENER (kept) ---------------- */

  useEffect(() => {
    const q = query(collection(fireDB, "orders"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setOrders(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []); /* ---------------- TAB BUCKETING ---------------- */ // Search is applied per-tab inside <PaginatedOrderTable>, so this returns the
  // full (unfiltered) bucket — tab badge counts therefore always show totals.
  // Confirmed tab intentionally includes still-"placed" (paid, not-yet-actioned) orders.

  const ordersForTab = (tab) =>
    orders.filter((o) =>
      tab.statuses.includes(o.orderStatus),
    ); /* ---------------- ORDER ACTIONS (kept) ---------------- */

  const updateStatus = async (orderId, status) => {
    try {
      // Delivery and payment are tracked independently: shipping an order
      // never changes its paymentStatus. COD is marked paid explicitly by
      // the admin (Mark Payment as Paid) when cash is actually collected.
      await updateDoc(doc(fireDB, "orders", orderId), { orderStatus: status });
    } catch (err) {
      console.log(err);
    }
  }; /* Mark a COD order's payment as collected (cash received). */

  const markAsPaid = async (orderId) => {
    try {
      await updateDoc(doc(fireDB, "orders", orderId), {
        paymentStatus: "paid",
      }); // Reflect immediately in the open drawer without waiting for the snapshot.
      setSelectedOrder((prev) =>
        prev && prev.id === orderId ? { ...prev, paymentStatus: "paid" } : prev,
      );
    } catch (err) {
      console.log(err);
    }
  }; /* ---------------- TAB SWITCH ---------------- */ // All three panels stay mounted (so each keeps its own page); we just toggle
  // visibility and fade the newly-active panel in.

  const switchTab = (newTab) => {
    if (newTab === activeTab) return;
    setActiveTab(newTab);
    updateParams({ tab: newTab });
    gsap.fromTo(
      `.tab-panel-${newTab}`,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" },
    );
  }; /* ---------------- DRAWER ---------------- */

  const openOrder = (order) => setSelectedOrder(order);
  const closeDrawer = () => {
    if (drawerRef.current) {
      gsap.to(drawerRef.current, {
        xPercent: 100,
        duration: 0.3,
        ease: "power3.in",
        onComplete: () => setSelectedOrder(null),
      });
    } else {
      setSelectedOrder(null);
    }
  }; // Animate transform (not `right`) so a realtime re-render can't reset the
  // drawer position; layout effect runs pre-paint to avoid an open-state flash.
  useLayoutEffect(() => {
    if (selectedOrder && drawerRef.current) {
      gsap.set(drawerRef.current, { xPercent: 100 });
      gsap.to(drawerRef.current, {
        xPercent: 0,
        duration: 0.4,
        ease: "power3.out",
      });
    }
  }, [selectedOrder]); // Order line items don't store an image — fetch each product's real thumbnail
  // from the products collection when the drawer opens.

  useEffect(() => {
    if (!selectedOrder?.products?.length) return;
    const ids = [
      ...new Set(
        selectedOrder.products
          .map((p) => p.productId)
          .filter((id) => id && !(id in productImages)),
      ),
    ];
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const found = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const snap = await getDoc(doc(fireDB, "products", id));
            if (snap.exists()) {
              const d = snap.data();
              found[id] =
                d.thumbnail ||
                d.image ||
                (Array.isArray(d.gallery) ? d.gallery[0] : "") ||
                "";
            } else found[id] = "";
          } catch {
            found[id] = "";
          }
        }),
      );
      if (!cancelled) setProductImages((prev) => ({ ...prev, ...found }));
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOrder, productImages]); // Fetch user address from Firestore as fallback for older orders
  // that were saved before userAddress was added to the order document.

  useEffect(() => {
    setDrawerUserAddress("");
    if (!selectedOrder) return;
    if (
      selectedOrder.userAddress ||
      selectedOrder.address ||
      selectedOrder.shippingAddress
    )
      return;
    if (!selectedOrder.userId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(fireDB, "users", selectedOrder.userId));
        if (!cancelled && snap.exists())
          setDrawerUserAddress(snap.data().address || "");
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOrder]); /* ---------------- LOAD ANIMATIONS ---------------- */

  useEffect(() => {
    if (!orders.length) return;
    const ctx = gsap.context(() => {
      gsap.from(".analytics-card", {
        y: 20,
        opacity: 0,
        stagger: 0.1,
        duration: 0.6,
        ease: "power3.out",
      });
    }, containerRef);
    return () => ctx.revert();
  }, [
    orders.length,
  ]); /* ---------------- ORDER CARD STAGGER (per tab) ---------------- */

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(".order-card", {
        opacity: 0,
        y: 20,
        scale: 0.97,
        stagger: 0.06,
        duration: 0.35,
        ease: "power3.out",
        delay: 0.1,
      });
    }, containerRef);
    return () => ctx.revert();
  }, [
    activeTab,
    orders.length,
  ]); /* ---------------- ANALYTICS (realtime from orders) ---------------- */

  const total = orders.length;
  const placedCount = orders.filter((o) => o.orderStatus === "placed").length;
  const shippedCount = orders.filter((o) => o.orderStatus === "shipped").length;
  const deliveredCount = orders.filter(
    (o) => o.orderStatus === "delivered",
  ).length; /* ---------------- INVOICE DOWNLOAD (professional PDF) ---------------- */

  const downloadInvoice = (order) => {
    try {
      generateInvoice(order, {
        name: order.userName,
        email: order.userEmail,
        phone: order.userPhone || order.phone,
        address: order.userAddress || order.address || order.shippingAddress,
      });
    } catch (err) {
      console.error("Invoice error:", err);
    }
  }; /* ============================== ORDER CARD ============================== */

  const OrderCard = ({ order, column }) => {
    const av = order.userAvatar;
    const avBg = hashColor(order.userName);
    return (
      <div
        className="order-card cursor-pointer"
        onClick={() => openOrder(order)}
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          boxShadow: "0px 1px 2px rgba(0,0,0,0.05)",
          borderRadius: "24px",
          padding: "24px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
                        {/* Row 1 — header */}               {" "}
        <div className="flex items-start justify-between">
                             {" "}
          <div>
                                   {" "}
            <p
              style={{
                fontFamily: MONO,
                fontSize: "12px",
                color: "var(--color-body)",
                letterSpacing: "0.6px",
              }}
            >
              #
              {order.externalOrderId
                ? String(order.externalOrderId).replace(/^#/, "")
                : order.id}
            </p>
                                   {" "}
            <p
              style={{
                fontFamily: MANROPE,
                fontWeight: 800,
                fontSize: "24px",
                color: "var(--color-ink)",
                marginTop: "2px",
              }}
            >
              {formatINR(order.total)}
            </p>
                               {" "}
          </div>
                             {" "}
          {av ? (
            <img
              src={av}
              alt=""
              className="flex-shrink-0"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "9999px",
                border: "2px solid var(--color-inverse)",
                boxShadow: "0px 1px 4px rgba(0,0,0,0.1)",
                objectFit: "cover",
              }}
            />
          ) : (
            <span
              className="flex items-center justify-center flex-shrink-0 text-inverse font-bold"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "9999px",
                border: "2px solid var(--color-inverse)",
                boxShadow: "0px 1px 4px rgba(0,0,0,0.1)",
                background: avBg,
                fontSize: "13px",
              }}
            >
              {initials(order.userName)}
            </span>
          )}
                         {" "}
        </div>
                        {/* Row 2 — customer */}               {" "}
        <p
          style={{
            fontFamily: INTER,
            fontWeight: 700,
            fontSize: "16px",
            color: "var(--color-ink)",
          }}
        >
          {order.userName || "Guest"}
        </p>
                        {/* Row 3 — products */}               {" "}
        <div
          style={{
            background: "var(--color-surface-muted)",
            border: "1px solid var(--color-border)",
            borderRadius: "12px",
            padding: "12px",
            maxHeight: "104px",
            overflowY: "auto",
          }}
        >
                             {" "}
          {(order.products || []).map((p, i) => (
            <p
              key={i}
              style={{
                fontFamily: MONO,
                fontWeight: 500,
                fontSize: "13px",
                color: "var(--color-body)",
                lineHeight: "22px",
              }}
            >
                                          {p.title} x{p.quantity}               
                     {" "}
            </p>
          ))}
                             {" "}
          {(!order.products || order.products.length === 0) && (
            <p
              style={{
                fontFamily: MONO,
                fontSize: "13px",
                color: "var(--color-body)",
                opacity: 0.5,
              }}
            >
              No items
            </p>
          )}
                         {" "}
        </div>
                        {/* Row 4 — payment method + paid/unpaid badge */}     
                 {" "}
        <div className="flex items-center gap-2 flex-wrap">
                             {" "}
          {String(order.paymentMethod || "").toLowerCase() === "cod" ? (
            <Banknote size={14} style={{ color: "var(--color-body)" }} />
          ) : (
            <CreditCard size={14} style={{ color: "var(--color-body)" }} />
          )}
                             {" "}
          <span
            style={{
              fontFamily: INTER,
              fontWeight: 500,
              fontSize: "12px",
              color: "var(--color-body)",
              letterSpacing: "0.6px",
            }}
          >
            {order.paymentMethod
              ? paymentMethodLabel(order.paymentMethod)
              : "Paid via Credit Card"}
          </span>
                             {" "}
          {order.paymentStatus &&
            (() => {
              const paid = String(order.paymentStatus).toLowerCase() === "paid";
              return (
                <span
                  style={{
                    fontFamily: INTER,
                    fontWeight: 700,
                    fontSize: "10px",
                    padding: "2px 9px",
                    borderRadius: "9999px",
                    background: paid
                      ? "var(--color-success-subtle)"
                      : "color-mix(in srgb, var(--color-accent-strong) 14%, transparent)",
                    color: paid
                      ? "var(--color-success)"
                      : "var(--color-accent-strong)",
                  }}
                >
                                                  {paid ? "Paid" : "Unpaid"}   
                                         {" "}
                </span>
              );
            })()}
                         {" "}
        </div>
                       {" "}
        {/* COD: collect cash → mark paid, from any tab, without opening the drawer */}
                       {" "}
        {isCodPending(order) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              markAsPaid(order.id);
            }}
            className="w-full flex items-center justify-center gap-2 text-inverse"
            style={{
              background: "var(--color-primary)",
              borderRadius: "12px",
              height: "44px",
              fontFamily: INTER,
              fontWeight: 700,
              fontSize: "14px",
              boxShadow: "0px 2px 6px rgba(0,0,0,0.1)",
            }}
          >
                                    <Banknote size={15} /> Mark Payment as Paid
                               {" "}
          </button>
        )}
                        {/* Row 5 — action (per tab) */}               {" "}
        {column === "confirmed" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              updateStatus(order.id, "shipped");
            }}
            className="w-full text-inverse"
            style={{
              background: "var(--color-primary)",
              borderRadius: "12px",
              height: "52px",
              boxShadow: "0px 4px 6px rgba(0,0,0,0.1)",
              fontFamily: INTER,
              fontWeight: 700,
              fontSize: "16px",
            }}
          >
            Initiate Transit
          </button>
        )}
                       {" "}
        {column === "shipped" && (
          <div className="flex flex-col gap-3">
                                   {" "}
            <div className="flex items-center justify-between">
                                         {" "}
              <span
                style={{
                  background:
                    "color-mix(in srgb, var(--color-accent-strong) 10%, transparent)",
                  color: "var(--color-accent-strong)",
                  borderRadius: "9999px",
                  padding: "4px 10px",
                  fontFamily: INTER,
                  fontWeight: 700,
                  fontSize: "12px",
                  letterSpacing: "0.6px",
                }}
              >
                Out for Delivery
              </span>
                                         {" "}
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: "12px",
                  color: "var(--color-body)",
                }}
              >
                ETA: 2h
              </span>
                                     {" "}
            </div>
                                   {" "}
            <button
              onClick={(e) => {
                e.stopPropagation();
                updateStatus(order.id, "delivered");
              }}
              className="w-full"
              style={{
                background: "var(--color-accent-subtle)",
                color: "var(--color-body)",
                borderRadius: "12px",
                height: "44px",
                fontFamily: INTER,
                fontWeight: 700,
                fontSize: "14px",
              }}
            >
              Mark Delivered
            </button>
                               {" "}
          </div>
        )}
                   {" "}
      </div>
    );
  }; /* ============================== ORDER CARD SKELETON ============================== */ // Mirrors OrderCard: header (id + total + avatar), customer line, products
  // box, payment row, and an action button — same container radius/padding.

  const OrderCardSkeletonCard = () => {
    const bar = (style) => (
      <div
        className="animate-pulse"
        style={{
          background: "var(--color-surface-muted)",
          borderRadius: "6px",
          ...style,
        }}
      />
    );
    return (
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          boxShadow: "0px 1px 2px rgba(0,0,0,0.05)",
          borderRadius: "24px",
          padding: "24px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
                        {/* Row 1 — header */}               {" "}
        <div className="flex items-start justify-between">
                             {" "}
          <div className="flex flex-col" style={{ gap: "6px" }}>
                                    {bar({ width: "90px", height: "12px" })}   
                                {bar({ width: "120px", height: "24px" })}       
                       {" "}
          </div>
                             {" "}
          {bar({ width: "40px", height: "40px", borderRadius: "9999px" })}     
                   {" "}
        </div>
                        {/* Row 2 — customer */}               {" "}
        {bar({ width: "60%", height: "16px" })}               {" "}
        {/* Row 3 — products box */}               {" "}
        <div
          style={{
            background: "var(--color-surface-muted)",
            border: "1px solid var(--color-border)",
            borderRadius: "12px",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
                             {" "}
          {bar({
            width: "80%",
            height: "13px",
            background: "var(--color-border)",
          })}
                             {" "}
          {bar({
            width: "65%",
            height: "13px",
            background: "var(--color-border)",
          })}
                         {" "}
        </div>
                        {/* Row 4 — payment */}               {" "}
        {bar({ width: "50%", height: "12px" })}               {" "}
        {/* Row 5 — action */}               {" "}
        {bar({ width: "100%", height: "52px", borderRadius: "12px" })}         
         {" "}
      </div>
    );
  }; /* ============================== ANALYTICS CARD ============================== */

  const cardBase = {
    background: "color-mix(in srgb, var(--color-surface) 40%, transparent)",
    border:
      "1px solid color-mix(in srgb, var(--color-surface) 30%, transparent)",
    boxShadow:
      "0px 8px 32px color-mix(in srgb, var(--color-accent) 5%, transparent)",
    backdropFilter: "blur(12px)",
    borderRadius: "24px",
    padding: "24px",
    minHeight: "126px",
  };
  const labelStyle = {
    fontFamily: MONO,
    fontSize: "13px",
    color: "var(--color-body)",
    opacity: 0.7,
  };
  const valueStyle = {
    fontFamily: MANROPE,
    fontWeight: 800,
    fontSize: "36px",
    letterSpacing: "-0.9px",
  }; // While the orders listener is still pending, show a pulsing bar in place of
  // the derived stat so the analytics cards don't flash a misleading "0".
  const statSkel = (
    <span
      aria-hidden="true"
      className="animate-pulse"
      style={{
        display: "inline-block",
        width: "72px",
        height: "36px",
        background: "var(--color-surface-muted)",
        borderRadius: "8px",
      }}
    />
  ); /* ============================== DRAWER ============================== */

  const Drawer = () => {
    const o = selectedOrder;
    if (!o) return null;
    const created = toDate(o.createdAt);
    const status = o.orderStatus;
    const paymentDone = ["confirmed", "shipped", "delivered"].includes(status);
    const processingDone = ["shipped", "delivered"].includes(status);
    const productsCount = o.products?.length || 0;

    const TimelineStep = ({ title, subtitle, done, last }) => (
      <div className="flex gap-4">
                       {" "}
        <div className="flex flex-col items-center">
                             {" "}
          <span
            style={{
              width: "20px",
              height: "20px",
              borderRadius: "9999px",
              background: done ? "var(--color-primary)" : "var(--color-border)",
              boxShadow: done
                ? "0px 0px 0px 4px color-mix(in srgb, var(--color-accent) 20%, transparent)"
                : "none",
            }}
          />
                             {" "}
          {!last && (
            <span
              style={{
                width: "2px",
                flex: 1,
                minHeight: "32px",
                background: "var(--color-border)",
                marginTop: "4px",
              }}
            />
          )}
                         {" "}
        </div>
                       {" "}
        <div style={{ paddingBottom: last ? 0 : "12px" }}>
                             {" "}
          <p
            style={{
              fontFamily: INTER,
              fontWeight: 700,
              fontSize: "16px",
              color: done ? "var(--color-ink)" : "var(--color-ink)",
              opacity: done ? 1 : 0.4,
            }}
          >
            {title}
          </p>
                             {" "}
          <p
            style={{
              fontFamily: INTER,
              fontWeight: 500,
              fontSize: "14px",
              color: "var(--color-body)",
              opacity: done ? 1 : 0.4,
            }}
          >
            {subtitle}
          </p>
                         {" "}
        </div>
                   {" "}
      </div>
    );

    return (
      <div
        ref={drawerRef}
        className="fixed top-0 bottom-0 overflow-y-auto"
        style={{
          right: 0,
          width: "500px",
          maxWidth: "100vw",
          background: "var(--color-background)",
          borderLeft: "1px solid var(--color-border)",
          boxShadow: "0px 25px 50px -12px rgba(0,0,0,0.25)",
          zIndex: 50,
        }}
      >
                       {" "}
        <div
          style={{
            padding: isMobile ? "20px" : "32px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
                              {/* Top row */}                   {" "}
          <div className="flex items-center justify-between">
                                   {" "}
            <h2
              style={{
                fontFamily: INTER,
                fontWeight: 800,
                fontSize: "30px",
                color: "var(--color-ink)",
                letterSpacing: "-0.75px",
              }}
            >
              Order Details
            </h2>
                                   {" "}
            <button
              onClick={closeDrawer}
              className="flex items-center justify-center"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "9999px",
                background: "var(--color-surface-muted)",
              }}
            >
              <X size={18} style={{ color: "var(--color-body)" }} />
            </button>
                               {" "}
          </div>
                              {/* Summary row */}                   {" "}
          <div
            className="flex items-start justify-between"
            style={{
              borderBottom: "1px solid var(--color-border)",
              paddingBottom: "16px",
            }}
          >
                                   {" "}
            <div>
                                         {" "}
              <p
                style={{
                  fontFamily: INTER,
                  fontWeight: 700,
                  fontSize: "12px",
                  color: "var(--color-body)",
                  letterSpacing: "1.8px",
                }}
              >
                ORDER ID
              </p>
                                         {" "}
              <p
                style={{
                  fontFamily: MONO,
                  fontWeight: 800,
                  fontSize: "18px",
                  color: "var(--color-ink)",
                }}
              >
                #
                {o.externalOrderId
                  ? String(o.externalOrderId).replace(/^#/, "")
                  : o.id}
              </p>
                                     {" "}
            </div>
                                   {" "}
            <div className="text-right">
                                         {" "}
              <p
                style={{
                  fontFamily: INTER,
                  fontWeight: 700,
                  fontSize: "12px",
                  color: "var(--color-body)",
                  letterSpacing: "1.8px",
                }}
              >
                TOTAL AMOUNT
              </p>
                                         {" "}
              <p
                style={{
                  fontFamily: INTER,
                  fontWeight: 800,
                  fontSize: "18px",
                  color: "var(--color-primary)",
                  letterSpacing: "-1.5px",
                }}
              >
                {formatINR(o.total)}.00
              </p>
                                     {" "}
            </div>
                               {" "}
          </div>
                              {/* Timeline */}                   {" "}
          <div style={{ paddingTop: "8px" }}>
                                   {" "}
            <div
              className="flex items-center gap-3"
              style={{ marginBottom: "20px" }}
            >
                                         {" "}
              <span
                style={{
                  width: "4px",
                  height: "20px",
                  background: "var(--color-primary)",
                  borderRadius: "9999px",
                }}
              />
                                         {" "}
              <h3
                style={{
                  fontFamily: INTER,
                  fontWeight: 700,
                  fontSize: "18px",
                  color: "var(--color-ink)",
                }}
              >
                Order Timeline
              </h3>
                                     {" "}
            </div>
                                   {" "}
            <TimelineStep
              title="Order Placed"
              subtitle={fmtDateTime(created)}
              done
            />
                                   {" "}
            <TimelineStep
              title="Payment Confirmed"
              subtitle={paymentDone ? fmtDateTime(created) : "Pending"}
              done={paymentDone}
            />
                                   {" "}
            <TimelineStep
              title="Processing"
              subtitle={
                processingDone
                  ? "Dispatched from warehouse"
                  : "Awaiting Warehouse Confirmation"
              }
              done={processingDone}
              last
            />
                               {" "}
          </div>
                              {/* Customer Information */}                   {" "}
          <div
            className="relative"
            style={{
              background: "var(--color-surface-muted)",
              border: "1px solid var(--color-border)",
              boxShadow: "0px 1px 2px rgba(0,0,0,0.05)",
              borderRadius: "24px",
              padding: "64px 32px 32px",
              marginTop: "40px",
            }}
          >
                                   {" "}
            {o.userAvatar ? (
              <img
                src={o.userAvatar}
                alt=""
                className="absolute"
                style={{
                  top: "-40px",
                  left: "32px",
                  width: "80px",
                  height: "80px",
                  borderRadius: "24px",
                  boxShadow:
                    "0px 0px 0px 2px var(--color-inverse), 0px 4px 6px rgba(0,0,0,0.1)",
                  objectFit: "cover",
                }}
              />
            ) : (
              <span
                className="absolute flex items-center justify-center text-inverse font-bold"
                style={{
                  top: "-40px",
                  left: "32px",
                  width: "80px",
                  height: "80px",
                  borderRadius: "24px",
                  boxShadow:
                    "0px 0px 0px 2px var(--color-inverse), 0px 4px 6px rgba(0,0,0,0.1)",
                  background: hashColor(o.userName),
                  fontSize: "28px",
                  fontFamily: MANROPE,
                }}
              >
                {initials(o.userName)}
              </span>
            )}
                                   {" "}
            <h3
              style={{
                fontFamily: INTER,
                fontWeight: 700,
                fontSize: "18px",
                color: "var(--color-ink)",
                marginBottom: "12px",
              }}
            >
              Customer Information
            </h3>
                                   {" "}
            <p
              style={{
                fontFamily: INTER,
                fontWeight: 800,
                fontSize: "20px",
                color: "var(--color-ink)",
              }}
            >
              {o.userName || "Guest"}
            </p>
                                   {" "}
            <p
              style={{
                fontFamily: INTER,
                fontWeight: 500,
                fontSize: "14px",
                color: "var(--color-body)",
              }}
            >
              {o.userEmail || "—"}
              {o.userPhone ? ` • ${o.userPhone}` : ""}
            </p>
                                   {" "}
            <div style={{ marginTop: "20px" }}>
                                         {" "}
              <p
                style={{
                  fontFamily: INTER,
                  fontWeight: 700,
                  fontSize: "12px",
                  color: "var(--color-body)",
                  letterSpacing: "2.4px",
                  textTransform: "uppercase",
                }}
              >
                Shipping Address
              </p>
                                         {" "}
              <p
                style={{
                  fontFamily: INTER,
                  fontWeight: 500,
                  fontSize: "14px",
                  lineHeight: "23px",
                  color: "var(--color-ink)",
                  marginTop: "4px",
                }}
              >
                {formatAddress(o.userAddress) ||
                  formatAddress(o.address) ||
                  formatAddress(o.shippingAddress) ||
                  formatAddress(drawerUserAddress) ||
                  "No address on file"}
              </p>
                                     {" "}
            </div>
                                   {" "}
            <div style={{ marginTop: "20px" }}>
                                         {" "}
              <p
                style={{
                  fontFamily: INTER,
                  fontWeight: 700,
                  fontSize: "12px",
                  color: "var(--color-body)",
                  letterSpacing: "2.4px",
                  textTransform: "uppercase",
                }}
              >
                Payment Method
              </p>
                                         {" "}
              <div
                className="flex items-center gap-2 flex-wrap"
                style={{ marginTop: "4px" }}
              >
                                               {" "}
                {String(o.paymentMethod || "").toLowerCase() === "cod" ? (
                  <Banknote
                    size={16}
                    style={{ color: "var(--color-primary)" }}
                  />
                ) : (
                  <CreditCard
                    size={16}
                    style={{ color: "var(--color-primary)" }}
                  />
                )}
                                               {" "}
                <span
                  style={{
                    fontFamily: INTER,
                    fontWeight: 500,
                    fontSize: "14px",
                    color: "var(--color-ink)",
                  }}
                >
                  {o.paymentMethod
                    ? paymentMethodLabel(o.paymentMethod)
                    : "Credit Card"}
                </span>
                                                {/* Payment status badge */}   
                                           {" "}
                {(() => {
                  const paid =
                    String(o.paymentStatus || "").toLowerCase() === "paid";
                  return (
                    <span
                      style={{
                        fontFamily: INTER,
                        fontWeight: 700,
                        fontSize: "11px",
                        padding: "2px 10px",
                        borderRadius: "9999px",
                        background: paid
                          ? "var(--color-success-subtle)"
                          : "color-mix(in srgb, var(--color-accent-strong) 14%, transparent)",
                        color: paid
                          ? "var(--color-success)"
                          : "var(--color-accent-strong)",
                        border: `1px solid ${paid ? "var(--color-success)" : "var(--color-accent-strong)"}`,
                      }}
                    >
                                                                 {" "}
                      {paid
                        ? "Paid"
                        : paymentStatusLabel(o.paymentStatus, o.paymentMethod)}
                                                             {" "}
                    </span>
                  );
                })()}
                                           {" "}
              </div>
                                         {" "}
              {o.razorpayPaymentId && (
                <div
                  className="flex items-center gap-2"
                  style={{ marginTop: "8px" }}
                >
                                                     {" "}
                  <span
                    style={{
                      fontFamily: INTER,
                      fontWeight: 600,
                      fontSize: "12px",
                      color: "var(--color-body)",
                    }}
                  >
                    Txn ID
                  </span>
                                                     {" "}
                  <span
                    style={{
                      fontFamily: MONO,
                      fontWeight: 500,
                      fontSize: "13px",
                      color: "var(--color-ink)",
                      background:
                        "color-mix(in srgb, var(--color-accent) 8%, transparent)",
                      padding: "2px 8px",
                      borderRadius: "6px",
                    }}
                  >
                    {o.razorpayPaymentId}
                  </span>
                                                 {" "}
                </div>
              )}
                                         {" "}
              {/* COD: let admin mark payment collected */}                     
                   {" "}
              {isCodPending(o) && (
                <button
                  onClick={() => markAsPaid(o.id)}
                  className="flex items-center gap-2"
                  style={{
                    marginTop: "12px",
                    background: "var(--color-primary)",
                    color: "var(--color-inverse)",
                    fontFamily: INTER,
                    fontWeight: 700,
                    fontSize: "13px",
                    padding: "8px 14px",
                    borderRadius: "10px",
                    boxShadow: "0px 2px 6px rgba(0,0,0,0.1)",
                  }}
                >
                                                      <Banknote size={15} />{" "}
                  Mark Payment as Paid                                {" "}
                </button>
              )}
                                     {" "}
            </div>
                               {" "}
          </div>
                              {/* Ordered Products */}                   {" "}
          <div style={{ paddingTop: "32px" }}>
                                   {" "}
            <div
              className="flex items-center justify-between"
              style={{ marginBottom: "16px" }}
            >
                                         {" "}
              <h3
                style={{
                  fontFamily: INTER,
                  fontWeight: 700,
                  fontSize: "18px",
                  color: "var(--color-ink)",
                }}
              >
                Ordered Products
              </h3>
                                         {" "}
              <span
                style={{
                  background: "var(--color-accent-subtle)",
                  fontFamily: INTER,
                  fontWeight: 700,
                  fontSize: "12px",
                  color: "var(--color-ink)",
                  padding: "4px 12px",
                  borderRadius: "9999px",
                }}
              >
                {productsCount} ITEMS
              </span>
                                     {" "}
            </div>
                                   {" "}
            <div className="flex flex-col gap-3">
                                         {" "}
              {(o.products || []).map((p, i) => (
                <div
                  key={i}
                  className="flex items-center gap-5"
                  style={{
                    background:
                      "color-mix(in srgb, var(--color-surface) 50%, transparent)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "24px",
                    padding: "20px",
                  }}
                >
                                                     {" "}
                  <span
                    className="flex items-center justify-center flex-shrink-0 overflow-hidden"
                    style={{
                      width: "64px",
                      height: "64px",
                      background:
                        "color-mix(in srgb, var(--color-accent) 20%, transparent)",
                      borderRadius: "12px",
                    }}
                  >
                                                           {" "}
                    {productImages[p.productId] || p.image ? (
                      <img
                        src={productImages[p.productId] || p.image}
                        alt={p.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Package
                        size={22}
                        style={{ color: "var(--color-primary)" }}
                      />
                    )}
                                                       {" "}
                  </span>
                                                     {" "}
                  <div className="flex-1 min-w-0">
                                                           {" "}
                    <p
                      style={{
                        fontFamily: INTER,
                        fontWeight: 700,
                        fontSize: "16px",
                        color: "var(--color-ink)",
                      }}
                      className="truncate"
                    >
                      {p.title}
                    </p>
                                                           {" "}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        flexWrap: "wrap",
                      }}
                    >
                                                                 {" "}
                      <p
                        style={{
                          fontFamily: INTER,
                          fontWeight: 500,
                          fontSize: "12px",
                          color: "var(--color-body)",
                        }}
                      >
                        Qty: {p.quantity} •
                      </p>
                                                                 {" "}
                      <p
                        style={{
                          fontFamily: INTER,
                          fontWeight: 700,
                          fontSize: "12px",
                          color: "var(--color-primary)",
                        }}
                      >
                        {formatINR(resolvedFinalPrice(p))} each
                      </p>
                                                                 {" "}
                      {Number(p.discount) > 0 && (
                        <p
                          style={{
                            fontFamily: INTER,
                            fontWeight: 400,
                            fontSize: "11px",
                            color: "var(--color-muted)",
                            textDecoration: "line-through",
                          }}
                        >
                          {formatINR(p.originalPrice ?? p.price ?? 0)}
                        </p>
                      )}
                                                             {" "}
                    </div>
                                                       {" "}
                  </div>
                                                     {" "}
                  <div style={{ textAlign: "right" }}>
                                                           {" "}
                    <p
                      style={{
                        fontFamily: INTER,
                        fontWeight: 800,
                        fontSize: "18px",
                        color: "var(--color-ink)",
                      }}
                    >
                      {formatINR(resolvedFinalPrice(p) * p.quantity)}
                    </p>
                                                           {" "}
                    {Number(p.discount) > 0 && (
                      <p
                        style={{
                          fontFamily: INTER,
                          fontWeight: 400,
                          fontSize: "11px",
                          color: "var(--color-muted)",
                        }}
                      >
                        {Math.round(Number(p.discount))}% OFF
                      </p>
                    )}
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
              ))}
                                     {" "}
            </div>
                               {" "}
          </div>
                              {/* Price Summary + GST breakdown */}             
               {" "}
          <div style={{ paddingTop: "32px" }}>
                                   {" "}
            <h3
              style={{
                fontFamily: INTER,
                fontWeight: 700,
                fontSize: "18px",
                color: "var(--color-ink)",
                marginBottom: "16px",
              }}
            >
              Price Summary
            </h3>
                                   {" "}
            <div
              className="flex flex-col"
              style={{ gap: "8px", fontFamily: INTER, fontSize: "14px" }}
            >
                                         {" "}
              {o.taxableTotal != null && (
                <div className="flex justify-between">
                  <span style={{ color: "var(--color-body)" }}>
                    Taxable Value
                  </span>
                  <span style={{ fontWeight: 600, color: "var(--color-ink)" }}>
                    {formatINR(o.taxableTotal)}
                  </span>
                </div>
              )}
                                         {" "}
              {o.taxableTotal != null &&
                (o.isInterState ? (
                  <div className="flex justify-between">
                    <span style={{ color: "var(--color-body)" }}>IGST</span>
                    <span
                      style={{ fontWeight: 600, color: "var(--color-ink)" }}
                    >
                      {formatINR(o.totalIgst)}
                    </span>
                  </div>
                ) : (
                  <>
                                                       {" "}
                    <div className="flex justify-between">
                      <span style={{ color: "var(--color-body)" }}>CGST</span>
                      <span
                        style={{ fontWeight: 600, color: "var(--color-ink)" }}
                      >
                        {formatINR(o.totalCgst)}
                      </span>
                    </div>
                                                       {" "}
                    <div className="flex justify-between">
                      <span style={{ color: "var(--color-body)" }}>SGST</span>
                      <span
                        style={{ fontWeight: 600, color: "var(--color-ink)" }}
                      >
                        {formatINR(o.totalSgst)}
                      </span>
                    </div>
                                                   {" "}
                  </>
                ))}
                                         {" "}
              {Number(o.shipping) > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: "var(--color-body)" }}>Shipping</span>
                  <span style={{ fontWeight: 600, color: "var(--color-ink)" }}>
                    {formatINR(o.shipping)}
                  </span>
                </div>
              )}
                                         {" "}
              {Number(o.promoDiscount) > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: "var(--color-body)" }}>
                    Promo Discount{o.promoCode ? ` (${o.promoCode})` : ""}
                  </span>
                  <span
                    style={{ fontWeight: 600, color: "var(--color-success)" }}
                  >
                    -{formatINR(o.promoDiscount)}
                  </span>
                </div>
              )}
                                         {" "}
              <div
                className="flex justify-between"
                style={{
                  borderTop: "1px dashed var(--color-border)",
                  paddingTop: "10px",
                  marginTop: "4px",
                }}
              >
                                               {" "}
                <span style={{ fontWeight: 800, color: "var(--color-ink)" }}>
                  Grand Total
                </span>
                                               {" "}
                <span
                  style={{ fontWeight: 800, color: "var(--color-primary)" }}
                >
                  {formatINR(o.total)}
                </span>
                                           {" "}
              </div>
                                     {" "}
            </div>
                               {" "}
          </div>
                              {/* Bottom actions */}                   {" "}
          <div
            className="flex gap-4"
            style={{
              paddingTop: "32px",
              borderTop: "1px solid var(--color-border)",
            }}
          >
                                   {" "}
            <button
              onClick={() => downloadInvoice(o)}
              className="flex items-center justify-center gap-2 text-inverse flex-1"
              style={{
                background: "var(--color-primary)",
                borderRadius: "24px",
                height: "64px",
                fontFamily: INTER,
                fontWeight: 700,
                fontSize: "16px",
              }}
            >
                                          <Download size={18} /> Download
              Invoice                        {" "}
            </button>
                                   {" "}
            <button
              onClick={() => window.print()}
              className="flex items-center justify-center flex-shrink-0"
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "24px",
                border: "2px solid var(--color-border)",
              }}
            >
                                         {" "}
              <Printer size={20} style={{ color: "var(--color-body)" }} />     
                               {" "}
            </button>
                               {" "}
          </div>
                         {" "}
        </div>
                   {" "}
      </div>
    );
  }; /* ============================== RENDER ============================== */

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen"
      style={{
        background: "var(--color-background)",
        fontFamily: INTER,
        marginTop: isMobile ? "96px" : 0,
      }}
    >
                  {/* Background blobs */}           {" "}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
                       {" "}
        <div
          className="absolute"
          style={{
            top: "-100px",
            left: "-100px",
            width: "576px",
            height: "576px",
            borderRadius: "9999px",
            background:
              "color-mix(in srgb, var(--color-accent) 15%, transparent)",
            filter: "blur(70px)",
          }}
        />
                       {" "}
        <div
          className="absolute"
          style={{
            bottom: "-150px",
            right: "-150px",
            width: "704px",
            height: "704px",
            borderRadius: "9999px",
            background:
              "color-mix(in srgb, var(--color-info) 10%, transparent)",
            filter: "blur(80px)",
          }}
        />
                       {" "}
        <div
          className="absolute"
          style={{
            bottom: "-100px",
            left: "40%",
            width: "512px",
            height: "512px",
            borderRadius: "9999px",
            background:
              "color-mix(in srgb, var(--color-accent-strong) 10%, transparent)",
            filter: "blur(60px)",
          }}
        />
                   {" "}
      </div>
                  {/* Main content */}           {" "}
      <div
        style={{
          padding: isMobile ? "16px 0 48px" : "24px 0 48px",
          display: "flex",
          flexDirection: "column",
        }}
      >
                        {/* Analytics cards */}               {" "}
        <div
          className="grid grid-cols-2 lg:grid-cols-4"
          style={{
            gap: isMobile ? "12px" : "24px",
            padding: `0 ${sidePad}`,
            marginBottom: isMobile ? "24px" : "40px",
          }}
        >
                             {" "}
          <div
            className="analytics-card flex flex-col"
            style={{ ...cardBase, gap: "12px" }}
          >
                                   {" "}
            <div className="flex items-center justify-between">
                                         {" "}
              <span style={labelStyle}>TOTAL ORDERS</span>                     
                   {" "}
              <span
                style={{
                  background:
                    "color-mix(in srgb, var(--color-info) 10%, transparent)",
                  color: "var(--color-info)",
                  fontFamily: MONO,
                  fontSize: "12px",
                  letterSpacing: "0.6px",
                  borderRadius: "9999px",
                  padding: "4px 10px",
                }}
              >
                +12.4%
              </span>
                                     {" "}
            </div>
                                   {" "}
            <span style={{ ...valueStyle, color: "var(--color-primary)" }}>
              {loading ? statSkel : total}
            </span>
                               {" "}
          </div>
                             {" "}
          <div
            className="analytics-card flex flex-col"
            style={{ ...cardBase, gap: "12px" }}
          >
                                   {" "}
            <div className="flex items-center justify-between">
                                         {" "}
              <span style={labelStyle}>AWAITING CONFIRMATION</span>             
                           {" "}
              <span
                style={{
                  background:
                    "color-mix(in srgb, var(--color-accent-strong) 10%, transparent)",
                  color: "var(--color-accent-strong)",
                  fontFamily: MONO,
                  fontSize: "12px",
                  letterSpacing: "0.6px",
                  borderRadius: "9999px",
                  padding: "4px 10px",
                }}
              >
                Action Required
              </span>
                                     {" "}
            </div>
                                   {" "}
            <span style={{ ...valueStyle, color: "var(--color-ink)" }}>
              {loading ? statSkel : placedCount}
            </span>
                               {" "}
          </div>
                             {" "}
          <div
            className="analytics-card flex flex-col"
            style={{ ...cardBase, gap: "12px" }}
          >
                                   {" "}
            <div className="flex items-center justify-between">
                                         {" "}
              <span style={labelStyle}>IN TRANSIT</span>
                                         {" "}
              <Truck
                size={20}
                style={{ color: "var(--color-info)", opacity: 0.5 }}
              />
                                     {" "}
            </div>
                                   {" "}
            <span style={{ ...valueStyle, color: "var(--color-info)" }}>
              {loading ? statSkel : shippedCount}
            </span>
                               {" "}
          </div>
                             {" "}
          <div
            className="analytics-card flex flex-col"
            style={{ ...cardBase, gap: "12px" }}
          >
                                    <span style={labelStyle}>DELIVERED</span>   
                               {" "}
            <span
              style={{ ...valueStyle, color: "var(--color-accent-strong)" }}
            >
              {loading ? statSkel : deliveredCount}
            </span>
                                   {" "}
            <div
              style={{
                background:
                  "color-mix(in srgb, var(--color-accent-strong) 10%, transparent)",
                height: "8px",
                borderRadius: "9999px",
                overflow: "hidden",
              }}
            >
                                         {" "}
              <div
                style={{
                  height: "100%",
                  width: `${total ? (deliveredCount / total) * 100 : 0}%`,
                  background: "var(--color-accent-strong)",
                  borderRadius: "9999px",
                }}
              />
                                     {" "}
            </div>
                               {" "}
          </div>
                         {" "}
        </div>
                       {" "}
        {/* Tab bar + search — tabs on the left, search on the right (stacks below
            the tabs on narrow screens). Tabs scroll horizontally if they overflow. */}
                       {" "}
        <div
          className={`flex ${isMobile ? "flex-col gap-3" : "items-center gap-6"}`}
          style={{
            borderBottom: "1px solid var(--color-border)",
            padding: `0 ${sidePad}`,
            paddingBottom: isMobile ? "12px" : "0",
          }}
        >
                             {" "}
          <div
            className="flex no-scrollbar"
            style={{
              overflowX: "auto",
              ...(isMobile ? {} : { flex: 1, minWidth: 0 }),
            }}
          >
                                   {" "}
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              const count = ordersForTab(tab).length;
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
                    color: isActive ? tab.color : "var(--color-ink)",
                    opacity: isActive ? 1 : 0.6,
                    borderBottom: `3px solid ${isActive ? tab.color : "transparent"}`,
                    background: "transparent",
                    transition: "all 0.2s ease",
                  }}
                >
                                                     {" "}
                  {isActive && (
                    <span
                      style={{
                        width: "8px",
                        height: "20px",
                        background: tab.color,
                        borderRadius: "9999px",
                      }}
                    />
                  )}
                                                      {tab.title}               
                                     {" "}
                  <span
                    style={{
                      fontFamily: MONO,
                      fontWeight: 700,
                      fontSize: "12px",
                      borderRadius: "9999px",
                      padding: "3px 10px",
                      minWidth: "28px",
                      textAlign: "center",
                      ...(isActive
                        ? { background: tab.activeBadgeBg, color: tab.color }
                        : INACTIVE_BADGE),
                    }}
                  >
                    {count}
                  </span>
                                                 {" "}
                </button>
              );
            })}
                               {" "}
          </div>
                             {" "}
          <div
            className="flex-shrink-0"
            style={{ width: isMobile ? "100%" : "340px" }}
          >
                                   {" "}
            <SearchBar
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search by Order ID or customer…"
            />
                               {" "}
          </div>
                         {" "}
        </div>
                       {" "}
        {/* Tab panels — all three stay mounted so each keeps its own page/search state */}
                       {" "}
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const list = ordersForTab(tab);
          const EmptyIcon = tab.emptyIcon;
          return (
            <div
              key={tab.key}
              className={`tab-panel tab-panel-${tab.key} ${isActive ? "" : "hidden"}`}
              style={{
                padding: isMobile ? "24px 16px" : "40px 48px",
                minHeight: "calc(100vh - 300px)",
              }}
            >
                                          {/* Panel header */}                 
                       {" "}
              <div
                className="flex items-center justify-between"
                style={{ marginBottom: isMobile ? "20px" : "32px" }}
              >
                                               {" "}
                <div className="flex items-center gap-3 sm:gap-4">
                                                     {" "}
                  <span
                    style={{
                      width: "8px",
                      height: isMobile ? "28px" : "40px",
                      background: tab.color,
                      borderRadius: "9999px",
                      flexShrink: 0,
                    }}
                  />
                                                     {" "}
                  <h2
                    style={{
                      fontFamily: MANROPE,
                      fontWeight: 800,
                      fontSize: isMobile ? "22px" : "32px",
                      color: "var(--color-ink)",
                      letterSpacing: isMobile ? "-0.5px" : "-1px",
                      textTransform: "uppercase",
                    }}
                  >
                    {tab.title}
                  </h2>
                                                     {" "}
                  <span
                    style={{
                      fontFamily: MONO,
                      fontWeight: 700,
                      fontSize: isMobile ? "14px" : "18px",
                      borderRadius: "9999px",
                      padding: isMobile ? "4px 12px" : "6px 16px",
                      background: tab.activeBadgeBg,
                      color: tab.color,
                      flexShrink: 0,
                    }}
                  >
                    {list.length}
                  </span>
                                                 {" "}
                </div>
                                           {" "}
              </div>
                                         {" "}
              <PaginatedOrderTable
                orders={list}
                search={searchTerm}
                active={isActive}
                onActivePageChange={handleActivePage}
                loading={loading}
                renderSkeleton={() => <OrderCardSkeletonCard />}
                skeletonCount={6}
                renderItem={(order) => (
                  <OrderCard key={order.id} order={order} column={tab.key} />
                )}
                emptyState={
                  <div
                    className="flex flex-col items-center justify-center text-center"
                    style={{
                      border: "2px dashed var(--color-border)",
                      borderRadius: "32px",
                      padding: "80px 48px",
                      background:
                        "color-mix(in srgb, var(--color-surface) 40%, transparent)",
                      backdropFilter: "blur(12px)",
                      gap: "16px",
                    }}
                  >
                                                           {" "}
                    <EmptyIcon
                      size={48}
                      style={{ color: tab.color, opacity: 0.3 }}
                    />
                                                           {" "}
                    <p
                      style={{
                        fontFamily: MANROPE,
                        fontWeight: 800,
                        fontSize: "28px",
                        color: "var(--color-ink)",
                        letterSpacing: "-0.5px",
                      }}
                    >
                      {tab.emptyTitle}
                    </p>
                                                           {" "}
                    <p
                      style={{
                        fontFamily: INTER,
                        fontWeight: 500,
                        fontSize: "16px",
                        color: "var(--color-body)",
                        opacity: 0.6,
                      }}
                    >
                      All quiet here. New orders will appear instantly.
                    </p>
                                                       {" "}
                  </div>
                }
              />
                                     {" "}
            </div>
          );
        })}
                   {" "}
      </div>
                 {" "}
      {/* Backdrop + Drawer (inlined so its DOM node stays stable across re-renders) */}
                 {" "}
      {selectedOrder && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 40, background: "var(--color-overlay)" }}
          onClick={closeDrawer}
        />
      )}
                  {Drawer()}       {" "}
    </div>
  );
};

export default AdminOrdersPage;
