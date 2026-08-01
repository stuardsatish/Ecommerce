import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  where,
} from "firebase/firestore";
import { fireDB, auth } from "../../context/FirebaseConfig";
import { toast } from "react-toastify";
import generateInvoice from "../../utils/generateInvoice";
import useIsMobile from "../../hooks/useIsMobile";
import {
  Receipt,
  Search,
  Plus,
  Minus,
  Trash2,
  X,
  User,
  Phone,
  Mail,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShoppingBag,
  Banknote,
  CreditCard,
  Smartphone,
  MoreHorizontal,
  BadgeCheck,
  Clock,
  Package,
  Zap,
  ScanLine,
  PauseCircle,
  RotateCcw,
  Printer,
  Tag,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

/* ── design tokens (match existing admin pages) ─────────────────────────── */
const C = {
  brand: "var(--color-primary)",
  brandDark: "var(--color-error)",
  surface: "var(--color-surface-muted)",
  border: "var(--color-border)",
  textP: "var(--color-ink)",
  textS: "var(--color-body)",
  textMuted: "var(--color-muted)",
  white: "var(--color-surface)",
  green: "var(--color-success)",
  greenBg: "var(--color-success-subtle)",
  red: "var(--color-error)",
  redBg: "var(--color-error-subtle)",
  blueBg: "var(--color-info-subtle)",
  blueText: "var(--color-body)",
};
const INTER = "'Inter', sans-serif";
const MANROPE = "'Manrope', sans-serif";
const MONO = "'JetBrains Mono', monospace";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const HELD_KEY = "billing_held_bills";

/* ── helpers ────────────────────────────────────────────────────────────── */
const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function getAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  const user = auth.currentUser;
  if (user) {
    try {
      headers.Authorization = `Bearer ${await user.getIdToken()}`;
    } catch {
      /* */
    }
  }
  return headers;
}

/** discounted unit price from a catalog product doc (product/category, larger wins) */
const unitPriceOf = (p) => {
  const price = Number(p.price || 0);
  const disc = Math.max(
    Number(p.discount || 0),
    Number(p.categoryDiscount || 0),
  );
  return {
    mrp: price,
    discount: disc,
    finalPrice: price - (price * disc) / 100,
    gstRate: Number(p.gstRate || 0),
  };
};

const toDateSafe = (v) => {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const isToday = (d) => {
  if (!d) return false;
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────────────────────────────────── */
const BillingPage = () => {
  const isMobile = useIsMobile(900); /* ── catalog + aggregates ── */

  const [products, setProducts] = useState([]);
  const [topSellers, setTopSellers] = useState([]);
  const [recentBills, setRecentBills] = useState([]);
  const [today, setToday] = useState({
    count: 0,
    revenue: 0,
  }); /* ── bill state ── */

  const [billItems, setBillItems] = useState([]);
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" });
  const [customerOpen, setCustomerOpen] = useState(false);
  const [custSearching, setCustSearching] =
    useState(false); /* ── search / scan ── */

  const [searchQuery, setSearchQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [skuInput, setSkuInput] = useState("");
  const searchRef = useRef(null); /* ── pricing controls ── */

  const [manualDiscount, setManualDiscount] = useState("");
  const [manualDiscountType, setManualDiscountType] = useState("flat"); // "flat" | "percent"
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null); // { code, discount }
  const [promoLoading, setPromoLoading] = useState(false); /* ── payment ── */

  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentStatus, setPaymentStatus] = useState("paid"); /* ── flow ── */

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { success, orderId, order } | { success:false, error }
  /* ── held bills ── */

  const [heldBills, setHeldBills] = useState([]);
  const [heldOpen, setHeldOpen] =
    useState(
      false,
    ); /* ─────────────────────────── data loading ─────────────────────────── */

  const loadCatalog = useCallback(async () => {
    try {
      const snap = await getDocs(collection(fireDB, "products"));
      setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Failed to load products:", e);
      toast.error("Could not load product catalog");
    }
  }, []);

  const loadTopSellers = useCallback(async (catalog) => {
    try {
      const q = query(
        collection(fireDB, "productStats"),
        orderBy("totalQuantity", "desc"),
        limit(8),
      );
      const snap = await getDocs(q);
      const byId = new Map(catalog.map((p) => [p.id, p]));
      const list = snap.docs
        .map((d) => byId.get(d.id))
        .filter(Boolean)
        .filter((p) => Number(p.stock || 0) > 0)
        .slice(0, 6);
      setTopSellers(list);
    } catch (e) {
      console.warn("Top sellers unavailable:", e);
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      // orderBy createdAt (single-field index, always available), filter billing client-side.
      const q = query(
        collection(fireDB, "orders"),
        orderBy("createdAt", "desc"),
        limit(60),
      );
      const snap = await getDocs(q);
      const billing = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((o) => o.source === "billing");
      setRecentBills(billing.slice(0, 15));
      const todays = billing.filter((o) => isToday(toDateSafe(o.createdAt)));
      setToday({
        count: todays.length,
        revenue: todays.reduce((s, o) => s + Number(o.total || 0), 0),
      });
    } catch (e) {
      console.warn("Recent bills unavailable:", e);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(fireDB, "products")).catch(
        () => null,
      );
      if (snap) {
        const catalog = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setProducts(catalog);
        loadTopSellers(catalog);
      }
      loadRecent();
    })(); // held bills from localStorage
    try {
      setHeldBills(JSON.parse(localStorage.getItem(HELD_KEY) || "[]"));
    } catch {
      setHeldBills([]);
    }
  }, [
    loadTopSellers,
    loadRecent,
  ]); /* ─────────────────────────── derived totals ─────────────────────────── */

  const subtotal = useMemo(
    () => billItems.reduce((s, it) => s + it.finalPrice * it.quantity, 0),
    [billItems],
  );
  const subtotalR = Math.round(subtotal * 100) / 100;

  const promoDiscount = useMemo(
    () => Math.min(Number(appliedPromo?.discount || 0), subtotalR),
    [appliedPromo, subtotalR],
  );

  const manualDiscountAmount = useMemo(() => {
    const raw = Math.max(0, Number(manualDiscount) || 0);
    if (raw <= 0) return 0;
    const amt =
      manualDiscountType === "percent"
        ? Math.round((subtotalR * Math.min(raw, 100)) / 100)
        : raw;
    return Math.max(0, amt);
  }, [manualDiscount, manualDiscountType, subtotalR]);

  const grandTotal = Math.max(
    0,
    Math.round(subtotalR - promoDiscount - manualDiscountAmount),
  ); // GST is included in each item's price; sum per-item (rates vary by product).
  const gstOnGoods = billItems.reduce((s, it) => {
    const rate = Number(it.gstRate || 0);
    if (rate <= 0) return s;
    const taxable = (it.finalPrice * 100) / (100 + rate);
    return s + (it.finalPrice - taxable) * it.quantity;
  }, 0);
  const totalItems = billItems.reduce(
    (s, it) => s + it.quantity,
    0,
  ); /* ─────────────────────────── search results ─────────────────────────── */

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => {
        const t = String(p.title || "").toLowerCase();
        const s = String(p.sku || "").toLowerCase();
        const c = String(p.category || "").toLowerCase();
        return t.includes(q) || s.includes(q) || c.includes(q);
      })
      .slice(0, 8);
  }, [
    searchQuery,
    products,
  ]); /* ─────────────────────────── bill mutations ─────────────────────────── */

  const addToBill = useCallback((p) => {
    if (!p) return;
    const stock = Number(p.stock || 0);
    if (stock <= 0) {
      toast.warn(`"${p.title}" is out of stock`, { theme: "dark" });
      return;
    }
    const { mrp, discount, finalPrice, gstRate } = unitPriceOf(p);
    setBillItems((prev) => {
      const idx = prev.findIndex((it) => it.productId === p.id);
      if (idx >= 0) {
        const cur = prev[idx];
        if (cur.quantity + 1 > stock) {
          toast.warn(`Only ${stock} in stock for "${p.title}"`, {
            theme: "dark",
          });
          return prev;
        }
        const next = [...prev];
        next[idx] = { ...cur, quantity: cur.quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          productId: p.id,
          title: p.title || "Product",
          category: p.category || "general",
          sku: p.sku || "",
          thumbnail: p.thumbnail || "",
          stock,
          mrp,
          discount,
          finalPrice,
          gstRate,
          quantity: 1,
        },
      ];
    });
  }, []);

  const changeQty = (productId, delta) => {
    setBillItems((prev) =>
      prev.flatMap((it) => {
        if (it.productId !== productId) return [it];
        const next = it.quantity + delta;
        if (next <= 0) return [];
        if (next > it.stock) {
          toast.warn(`Only ${it.stock} in stock for "${it.title}"`, {
            theme: "dark",
          });
          return [it];
        }
        return [{ ...it, quantity: next }];
      }),
    );
  };

  const setQty = (productId, value) => {
    const v = Math.floor(Number(value) || 0);
    setBillItems((prev) =>
      prev.flatMap((it) => {
        if (it.productId !== productId) return [it];
        if (v <= 0) return [it];
        const clamped = Math.min(v, it.stock);
        if (v > it.stock)
          toast.warn(`Only ${it.stock} in stock for "${it.title}"`, {
            theme: "dark",
          });
        return [{ ...it, quantity: clamped }];
      }),
    );
  };

  const removeItem = (productId) =>
    setBillItems((prev) => prev.filter((it) => it.productId !== productId));

  const resetBill = useCallback(() => {
    setBillItems([]);
    setCustomer({ name: "", phone: "", email: "" });
    setManualDiscount("");
    setManualDiscountType("flat");
    setPromoInput("");
    setAppliedPromo(null);
    setPaymentMethod("Cash");
    setPaymentStatus("paid");
    setSearchQuery("");
    setSkuInput("");
    setResult(null);
  }, []); /* ─────────────────────────── SKU / scan entry ─────────────────────────── */

  const handleSkuEnter = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = skuInput.trim().toLowerCase();
    if (!code) return;
    const hit = products.find(
      (p) =>
        String(p.sku || "").toLowerCase() === code ||
        p.id.toLowerCase() === code,
    );
    if (hit) {
      addToBill(hit);
      setSkuInput("");
    } else
      toast.error(`No product with SKU "${skuInput.trim()}"`, {
        theme: "dark",
      });
  }; /* ─────────────────────────── customer lookup ─────────────────────────── */

  const searchCustomer = async () => {
    const phone = customer.phone.trim();
    const email = customer.email.trim();
    if (!phone && !email) {
      toast.info("Enter a phone or email to search", { theme: "dark" });
      return;
    }
    setCustSearching(true);
    try {
      let snap;
      if (phone)
        snap = await getDocs(
          query(
            collection(fireDB, "users"),
            where("phone", "==", phone),
            limit(1),
          ),
        );
      if ((!snap || snap.empty) && email)
        snap = await getDocs(
          query(
            collection(fireDB, "users"),
            where("email", "==", email),
            limit(1),
          ),
        );
      if (snap && !snap.empty) {
        const d = snap.docs[0].data();
        setCustomer({
          name: d.name || "",
          phone: d.phone || phone,
          email: d.email || email,
        });
        toast.success(`Found: ${d.name || "customer"}`, { theme: "dark" });
      } else {
        toast.info("No matching customer — will bill as walk-in", {
          theme: "dark",
        });
      }
    } catch (e) {
      console.error(e);
      toast.error("Customer lookup failed", { theme: "dark" });
    } finally {
      setCustSearching(false);
    }
  }; /* ─────────────────────────── promo apply ─────────────────────────── */

  const applyPromo = async () => {
    const code = promoInput.trim();
    if (!code) return;
    if (subtotalR <= 0) {
      toast.info("Add items before applying a promo", { theme: "dark" });
      return;
    }
    setPromoLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/promo/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ code, subtotal: subtotalR }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setAppliedPromo({
          code: data.code,
          discount: Number(data.discount || 0),
        });
        toast.success(
          `Promo ${data.code} applied — ${money(data.discount)} off`,
          { theme: "dark" },
        );
      } else {
        setAppliedPromo(null);
        toast.error(data.error || "Invalid promo code", { theme: "dark" });
      }
    } catch {
      toast.error("Could not validate promo", { theme: "dark" });
    } finally {
      setPromoLoading(false);
    }
  };
  const clearPromo = () => {
    setAppliedPromo(null);
    setPromoInput("");
  }; /* ─────────────────────────── hold / recall ─────────────────────────── */

  const persistHeld = (list) => {
    setHeldBills(list);
    try {
      localStorage.setItem(HELD_KEY, JSON.stringify(list));
    } catch {
      /* */
    }
  };
  const holdBill = () => {
    if (!billItems.length) {
      toast.info("Nothing to hold", { theme: "dark" });
      return;
    }
    const entry = {
      id: `held_${Date.now()}`,
      customerName: customer.name || "Walk-in",
      customerPhone: customer.phone || "",
      customerEmail: customer.email || "",
      items: billItems,
      total: grandTotal,
      itemCount: totalItems,
      heldAt: new Date().toISOString(),
    };
    persistHeld([entry, ...heldBills]);
    toast.success("Bill held", { theme: "dark" });
    resetBill();
    setHeldOpen(true);
  };
  const recallBill = (entry) => {
    if (
      billItems.length &&
      !window.confirm("Replace the current bill with the held one?")
    )
      return;
    setBillItems(entry.items || []);
    setCustomer({
      name: entry.customerName === "Walk-in" ? "" : entry.customerName,
      phone: entry.customerPhone || "",
      email: entry.customerEmail || "",
    });
    if (entry.customerName && entry.customerName !== "Walk-in")
      setCustomerOpen(true);
    persistHeld(heldBills.filter((h) => h.id !== entry.id));
    setResult(null);
    toast.info("Bill recalled", { theme: "dark" });
  };
  const deleteHeld = (id) =>
    persistHeld(
      heldBills.filter((h) => h.id !== id),
    ); /* ─────────────────────────── generate bill ─────────────────────────── */

  const printInvoice = useCallback(async (order) => {
    try {
      await generateInvoice(order, {
        name: order.userName,
        email: order.userEmail,
        phone: order.userPhone,
        address: "In-Store Pickup",
      });
    } catch (e) {
      console.error("Invoice generation failed:", e);
      toast.error("Could not generate invoice PDF", { theme: "dark" });
    }
  }, []);

  const generateBill = useCallback(async () => {
    if (!billItems.length) {
      toast.info("Add items to the bill first", { theme: "dark" });
      return;
    } // client-side stock guard
    for (const it of billItems) {
      if (it.quantity > it.stock) {
        toast.error(`Not enough stock for "${it.title}"`, { theme: "dark" });
        return;
      }
    }
    setLoading(true);
    setResult(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/orders/billing-create`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: billItems.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
          })),
          customerName: customer.name.trim(),
          customerPhone: customer.phone.trim(),
          customerEmail: customer.email.trim(),
          paymentMethod,
          paymentStatus,
          promoCode: appliedPromo?.code || "",
          manualDiscount: Number(manualDiscount) || 0,
          manualDiscountType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setResult({ success: true, orderId: data.orderId, order: data.order });
        toast.success(`Bill ${data.orderId} created!`, { theme: "dark" }); // auto-download invoice
        printInvoice(data.order); // clear the bill inputs so a second click can't double-charge — but keep
        // `result` so the success banner + re-print stay available.
        setBillItems([]);
        setCustomer({ name: "", phone: "", email: "" });
        setManualDiscount("");
        setManualDiscountType("flat");
        setPromoInput("");
        setAppliedPromo(null);
        setSearchQuery("");
        setSkuInput(""); // refresh aggregates + catalog (stock changed)
        loadCatalog();
        loadRecent();
      } else {
        setResult({
          success: false,
          error: data.error || "Failed to create bill",
        });
        toast.error(data.error || "Failed to create bill", { theme: "dark" });
      }
    } catch (err) {
      const msg = err.message || "Network error — could not reach the server";
      setResult({ success: false, error: msg });
      toast.error(msg, { theme: "dark" });
    } finally {
      setLoading(false);
    }
  }, [
    billItems,
    customer,
    paymentMethod,
    paymentStatus,
    appliedPromo,
    manualDiscount,
    manualDiscountType,
    printInvoice,
    loadCatalog,
    loadRecent,
  ]); /* ─────────────────────────── keyboard shortcuts ─────────────────────────── */

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea";
      if (e.key === "F2" || (e.key === "/" && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F5") {
        e.preventDefault();
        if (!loading) generateBill();
      } else if (e.key === "Escape") {
        if (showResults) setShowResults(false);
        else if (!typing) resetBill();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    loading,
    generateBill,
    resetBill,
    showResults,
  ]); /* ─────────────────────────── styles ─────────────────────────── */

  const card = {
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: "16px",
    padding: "24px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
  };
  const label = {
    fontFamily: MANROPE,
    fontWeight: 700,
    fontSize: "13px",
    letterSpacing: "0.6px",
    textTransform: "uppercase",
    color: C.textS,
    marginBottom: "12px",
    display: "block",
  };
  const input = {
    width: "100%",
    height: "44px",
    background: C.surface,
    border: `1.5px solid ${C.border}`,
    borderRadius: "10px",
    padding: "0 14px",
    fontFamily: INTER,
    fontSize: "14px",
    color: C.textP,
    outline: "none",
    boxSizing: "border-box",
  };
  const iconBtn = (active) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    height: "48px",
    borderRadius: "10px",
    border: active ? `2px solid ${C.brand}` : `1.5px solid ${C.border}`,
    background: active
      ? "color-mix(in srgb, var(--color-primary) 9%, transparent)"
      : C.white,
    color: active ? C.brand : C.textS,
    fontFamily: MANROPE,
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    transition: "all 0.15s",
  }); /* ─────────────────────────── render ─────────────────────────── */

  return (
    <div
      style={{
        background: C.surface,
        minHeight: "100vh",
        fontFamily: INTER,
        color: C.textP,
      }}
    >
           {" "}
      <div
        style={{
          maxWidth: "1400px",
          margin: "0 auto",
          padding: isMobile ? "24px 16px 96px" : "40px 32px 80px",
        }}
      >
                {/* ── HEADER ── */}       {" "}
        <div
          style={{
            marginBottom: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
                   {" "}
          <div>
                       {" "}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                marginBottom: "8px",
              }}
            >
                           {" "}
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "12px",
                  background:
                    "color-mix(in srgb, var(--color-primary) 9%, transparent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                                <Receipt size={22} color={C.brand} />           
                 {" "}
              </div>
                           {" "}
              <h1
                style={{
                  fontFamily: MANROPE,
                  fontWeight: 800,
                  fontSize: isMobile ? "22px" : "28px",
                  letterSpacing: "-0.5px",
                  margin: 0,
                }}
              >
                                Billing Counter              {" "}
              </h1>
                         {" "}
            </div>
                       {" "}
            <p
              style={{
                color: C.textS,
                fontSize: "15px",
                margin: 0,
                paddingLeft: isMobile ? 0 : "58px",
              }}
            >
                            Create bills for walk-in customers. Search products,
              add to bill, and generate an invoice.            {" "}
            </p>
                     {" "}
          </div>
                   {" "}
          <div
            style={{
              ...card,
              padding: "12px 18px",
              display: "flex",
              gap: "22px",
              alignItems: "center",
              boxShadow: "none",
            }}
          >
                       {" "}
            <div style={{ textAlign: "center" }}>
                           {" "}
              <div
                style={{
                  fontFamily: MONO,
                  fontWeight: 800,
                  fontSize: "20px",
                  color: C.brand,
                }}
              >
                #{today.count + 1}
              </div>
                           {" "}
              <div
                style={{
                  fontSize: "11px",
                  color: C.textMuted,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Bill Today
              </div>
                         {" "}
            </div>
                       {" "}
            <div
              style={{ width: "1px", height: "34px", background: C.border }}
            />
                       {" "}
            <div style={{ textAlign: "center" }}>
                           {" "}
              <div
                style={{
                  fontFamily: MONO,
                  fontWeight: 800,
                  fontSize: "20px",
                  color: C.green,
                }}
              >
                {money(today.revenue)}
              </div>
                           {" "}
              <div
                style={{
                  fontSize: "11px",
                  color: C.textMuted,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Today's Sales
              </div>
                         {" "}
            </div>
                     {" "}
          </div>
                 {" "}
        </div>
                {/* ── SUCCESS BANNER ── */}       {" "}
        {result?.success && (
          <div
            style={{
              ...card,
              background: C.greenBg,
              border: `1.5px solid var(--color-success-border)`,
              marginBottom: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "14px",
            }}
          >
                       {" "}
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <CheckCircle2 size={24} color={C.green} />         
                 {" "}
              <div>
                               {" "}
                <div
                  style={{
                    fontFamily: MANROPE,
                    fontWeight: 700,
                    fontSize: "16px",
                    color: C.green,
                  }}
                >
                  Bill Created Successfully
                </div>
                               {" "}
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: "13px",
                    color: C.green,
                    marginTop: "2px",
                  }}
                >
                  Order ID: {result.orderId}
                </div>
                             {" "}
              </div>
                         {" "}
            </div>
                       {" "}
            <div style={{ display: "flex", gap: "10px" }}>
                           {" "}
              <button
                onClick={() => printInvoice(result.order)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  height: "44px",
                  padding: "0 18px",
                  borderRadius: "10px",
                  border: `1.5px solid ${C.green}`,
                  background: C.white,
                  color: C.green,
                  fontFamily: MANROPE,
                  fontWeight: 700,
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                                <Printer size={16} /> Print Invoice            
                 {" "}
              </button>
                           {" "}
              <button
                onClick={resetBill}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  height: "44px",
                  padding: "0 18px",
                  borderRadius: "10px",
                  border: "none",
                  background: C.green,
                  color: C.white,
                  fontFamily: MANROPE,
                  fontWeight: 700,
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                                <Receipt size={16} /> New Bill            
                 {" "}
              </button>
                         {" "}
            </div>
                     {" "}
          </div>
        )}
                {/* ── TWO-COLUMN LAYOUT ── */}       {" "}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 400px",
            gap: "24px",
            alignItems: "start",
          }}
        >
                    {/* ═══════════ LEFT PANEL ═══════════ */}         {" "}
          <div
            style={{ display: "flex", flexDirection: "column", gap: "20px" }}
          >
                        {/* SEARCH + SCAN */}           {" "}
            <div style={card}>
                           {" "}
              <label style={label}>
                <Search
                  size={13}
                  style={{ marginRight: "6px", verticalAlign: "middle" }}
                />
                Search Products
              </label>
                           {" "}
              <div style={{ position: "relative" }}>
                               {" "}
                <div style={{ position: "relative" }}>
                                   {" "}
                  <Search
                    size={17}
                    color={C.textMuted}
                    style={{
                      position: "absolute",
                      left: "14px",
                      top: "50%",
                      transform: "translateY(-50%)",
                    }}
                  />
                                   {" "}
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowResults(true);
                    }}
                    onFocus={() => setShowResults(true)}
                    placeholder="Search by name, SKU, or category…  (F2 or /)"
                    style={{ ...input, paddingLeft: "40px" }}
                  />
                                   {" "}
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setShowResults(false);
                      }}
                      style={{
                        position: "absolute",
                        right: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: C.textMuted,
                      }}
                    >
                                            <X size={16} />                 
                       {" "}
                    </button>
                  )}
                                 {" "}
                </div>
                               {" "}
                {showResults && searchResults.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "50px",
                      left: 0,
                      right: 0,
                      zIndex: 30,
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: "12px",
                      boxShadow: "0 8px 28px rgba(0,0,0,0.12)",
                      maxHeight: "340px",
                      overflowY: "auto",
                      padding: "6px",
                    }}
                  >
                                       {" "}
                    {searchResults.map((p) => {
                      const { mrp, discount, finalPrice } = unitPriceOf(p);
                      const oos = Number(p.stock || 0) <= 0;
                      return (
                        <button
                          key={p.id}
                          disabled={oos}
                          onClick={() => {
                            addToBill(p);
                            setSearchQuery("");
                            setShowResults(false);
                            searchRef.current?.focus();
                          }}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            padding: "10px",
                            border: "none",
                            background: "none",
                            borderRadius: "8px",
                            cursor: oos ? "not-allowed" : "pointer",
                            textAlign: "left",
                            opacity: oos ? 0.5 : 1,
                          }}
                          onMouseEnter={(e) => {
                            if (!oos)
                              e.currentTarget.style.background = C.surface;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "none";
                          }}
                        >
                                                   {" "}
                          <div
                            style={{
                              width: "40px",
                              height: "40px",
                              borderRadius: "8px",
                              background: C.surface,
                              flexShrink: 0,
                              overflow: "hidden",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                                                       {" "}
                            {p.thumbnail ? (
                              <img
                                src={p.thumbnail}
                                alt=""
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                }}
                              />
                            ) : (
                              <Package size={18} color={C.textMuted} />
                            )}
                                                     {" "}
                          </div>
                                                   {" "}
                          <div style={{ flex: 1, minWidth: 0 }}>
                                                       {" "}
                            <div
                              style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: C.textP,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {p.title}
                            </div>
                                                       {" "}
                            <div
                              style={{
                                fontSize: "11px",
                                color: C.textMuted,
                                fontFamily: MONO,
                              }}
                            >
                              {p.sku || "—"} · {p.category || "general"}
                            </div>
                                                     {" "}
                          </div>
                                                   {" "}
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                                                       {" "}
                            <div
                              style={{
                                fontSize: "13px",
                                fontWeight: 700,
                                color: C.brand,
                              }}
                            >
                              {money(finalPrice)}
                            </div>
                                                       {" "}
                            <div
                              style={{
                                fontSize: "10px",
                                color: oos ? C.red : C.textMuted,
                                fontWeight: 600,
                              }}
                            >
                                                           {" "}
                              {oos ? "Out of stock" : `${p.stock} in stock`}
                              {discount > 0 ? ` · ${discount}% off` : ""}       
                                                 {" "}
                            </div>
                                                     {" "}
                          </div>
                                                   {" "}
                          {!oos && (
                            <Plus
                              size={16}
                              color={C.brand}
                              style={{ flexShrink: 0 }}
                            />
                          )}
                                                 {" "}
                        </button>
                      );
                    })}
                                     {" "}
                  </div>
                )}
                             {" "}
              </div>
                            {/* SKU / barcode quick entry */}             {" "}
              <div style={{ position: "relative", marginTop: "12px" }}>
                               {" "}
                <ScanLine
                  size={17}
                  color={C.textMuted}
                  style={{
                    position: "absolute",
                    left: "14px",
                    top: "50%",
                    transform: "translateY(-50%)",
                  }}
                />
                               {" "}
                <input
                  value={skuInput}
                  onChange={(e) => setSkuInput(e.target.value)}
                  onKeyDown={handleSkuEnter}
                  placeholder="Scan barcode / enter SKU, then press Enter"
                  style={{
                    ...input,
                    paddingLeft: "40px",
                    fontFamily: MONO,
                    fontSize: "13px",
                  }}
                />
                             {" "}
              </div>
                         {" "}
            </div>
                        {/* QUICK ADD — TOP SELLERS */}           {" "}
            {topSellers.length > 0 && (
              <div style={card}>
                               {" "}
                <label style={label}>
                  <Zap
                    size={13}
                    style={{ marginRight: "6px", verticalAlign: "middle" }}
                  />
                  Quick Add — Top Sellers
                </label>
                               {" "}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "repeat(2,1fr)"
                      : "repeat(3,1fr)",
                    gap: "10px",
                  }}
                >
                                   {" "}
                  {topSellers.map((p) => {
                    const { finalPrice } = unitPriceOf(p);
                    return (
                      <button
                        key={p.id}
                        onClick={() => addToBill(p)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "10px",
                          borderRadius: "10px",
                          border: `1px solid ${C.border}`,
                          background: C.surface,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                                               {" "}
                        <div
                          style={{
                            width: "34px",
                            height: "34px",
                            borderRadius: "8px",
                            background: C.white,
                            flexShrink: 0,
                            overflow: "hidden",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                                                   {" "}
                          {p.thumbnail ? (
                            <img
                              src={p.thumbnail}
                              alt=""
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          ) : (
                            <Package size={15} color={C.textMuted} />
                          )}
                                                 {" "}
                        </div>
                                               {" "}
                        <div style={{ flex: 1, minWidth: 0 }}>
                                                   {" "}
                          <div
                            style={{
                              fontSize: "12px",
                              fontWeight: 600,
                              color: C.textP,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {p.title}
                          </div>
                                                   {" "}
                          <div
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              color: C.brand,
                            }}
                          >
                            {money(finalPrice)}
                          </div>
                                                 {" "}
                        </div>
                                               {" "}
                        <Plus
                          size={15}
                          color={C.brand}
                          style={{ flexShrink: 0 }}
                        />
                                             {" "}
                      </button>
                    );
                  })}
                                 {" "}
                </div>
                             {" "}
              </div>
            )}
                        {/* CURRENT BILL TABLE */}           {" "}
            <div style={card}>
                           {" "}
              <label style={label}>
                <ShoppingBag
                  size={13}
                  style={{ marginRight: "6px", verticalAlign: "middle" }}
                />
                Current Bill ({totalItems} {totalItems === 1 ? "item" : "items"}
                )
              </label>
                           {" "}
              {billItems.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "40px 0",
                    color: C.textMuted,
                    fontSize: "14px",
                  }}
                >
                                   {" "}
                  <Package
                    size={30}
                    style={{ opacity: 0.4, marginBottom: "10px" }}
                  />
                  <br />                  No items added yet — search or scan to
                  add products                {" "}
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                                   {" "}
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "13px",
                      minWidth: "560px",
                    }}
                  >
                                       {" "}
                    <thead>
                                           {" "}
                      <tr
                        style={{
                          borderBottom: `1.5px solid ${C.border}`,
                          color: C.textMuted,
                        }}
                      >
                                               {" "}
                        {[
                          "#",
                          "Product",
                          "MRP",
                          "Disc",
                          "Price",
                          "Qty",
                          "Total",
                          "",
                        ].map((h, i) => (
                          <th
                            key={i}
                            style={{
                              textAlign: i >= 2 && i <= 6 ? "right" : "left",
                              padding: "8px 6px",
                              fontSize: "11px",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: "0.4px",
                              ...(i === 5 ? { textAlign: "center" } : {}),
                            }}
                          >
                            {h}
                          </th>
                        ))}
                                             {" "}
                      </tr>
                                         {" "}
                    </thead>
                                       {" "}
                    <tbody>
                                           {" "}
                      {billItems.map((it, idx) => (
                        <tr
                          key={it.productId}
                          style={{ borderBottom: `1px solid ${C.border}` }}
                        >
                                                   {" "}
                          <td
                            style={{ padding: "10px 6px", color: C.textMuted }}
                          >
                            {idx + 1}
                          </td>
                                                   {" "}
                          <td style={{ padding: "10px 6px" }}>
                                                       {" "}
                            <div style={{ fontWeight: 600, color: C.textP }}>
                              {it.title}
                            </div>
                                                       {" "}
                            <div
                              style={{
                                fontSize: "11px",
                                color: C.textMuted,
                                fontFamily: MONO,
                              }}
                            >
                              {it.sku || "—"}
                            </div>
                                                     {" "}
                          </td>
                                                   {" "}
                          <td
                            style={{
                              padding: "10px 6px",
                              textAlign: "right",
                              color: it.discount > 0 ? C.textMuted : C.textP,
                              textDecoration:
                                it.discount > 0 ? "line-through" : "none",
                            }}
                          >
                            {money(it.mrp)}
                          </td>
                                                   {" "}
                          <td
                            style={{
                              padding: "10px 6px",
                              textAlign: "right",
                              color: it.discount > 0 ? C.green : C.textMuted,
                            }}
                          >
                            {it.discount > 0 ? `${it.discount}%` : "—"}
                          </td>
                                                   {" "}
                          <td
                            style={{
                              padding: "10px 6px",
                              textAlign: "right",
                              fontWeight: 600,
                            }}
                          >
                            {money(it.finalPrice)}
                          </td>
                                                   {" "}
                          <td style={{ padding: "10px 6px" }}>
                                                       {" "}
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "4px",
                              }}
                            >
                                                           {" "}
                              <button
                                onClick={() => changeQty(it.productId, -1)}
                                style={qtyBtn}
                              >
                                <Minus size={13} />
                              </button>
                                                           {" "}
                              <input
                                value={it.quantity}
                                onChange={(e) =>
                                  setQty(it.productId, e.target.value)
                                }
                                style={{
                                  width: "38px",
                                  height: "28px",
                                  textAlign: "center",
                                  border: `1px solid ${C.border}`,
                                  borderRadius: "6px",
                                  fontFamily: MONO,
                                  fontSize: "13px",
                                  background: C.white,
                                  color: C.textP,
                                }}
                              />
                                                           {" "}
                              <button
                                onClick={() => changeQty(it.productId, 1)}
                                style={qtyBtn}
                              >
                                <Plus size={13} />
                              </button>
                                                         {" "}
                            </div>
                                                     {" "}
                          </td>
                                                   {" "}
                          <td
                            style={{
                              padding: "10px 6px",
                              textAlign: "right",
                              fontWeight: 700,
                              color: C.brand,
                            }}
                          >
                            {money(it.finalPrice * it.quantity)}
                          </td>
                                                   {" "}
                          <td
                            style={{ padding: "10px 6px", textAlign: "right" }}
                          >
                                                       {" "}
                            <button
                              onClick={() => removeItem(it.productId)}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: C.textMuted,
                              }}
                              title="Remove"
                            >
                                                            <Trash2 size={15} />
                                                         {" "}
                            </button>
                                                     {" "}
                          </td>
                                                 {" "}
                        </tr>
                      ))}
                                         {" "}
                    </tbody>
                                     {" "}
                  </table>
                                   {" "}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "12px",
                      paddingTop: "14px",
                      fontSize: "14px",
                    }}
                  >
                                       {" "}
                    <span style={{ color: C.textS, fontWeight: 600 }}>
                      Subtotal
                    </span>
                                       {" "}
                    <span
                      style={{
                        fontFamily: MANROPE,
                        fontWeight: 800,
                        color: C.textP,
                      }}
                    >
                      {money(subtotalR)}
                    </span>
                                     {" "}
                  </div>
                                 {" "}
                </div>
              )}
                         {" "}
            </div>
                        {/* CUSTOMER DETAILS */}           {" "}
            <div style={card}>
                           {" "}
              <button
                onClick={() => setCustomerOpen((o) => !o)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                               {" "}
                <span style={{ ...label, marginBottom: 0 }}>
                  <User
                    size={13}
                    style={{ marginRight: "6px", verticalAlign: "middle" }}
                  />
                  Customer Details (Optional)
                </span>
                               {" "}
                {customerOpen ? (
                  <ChevronUp size={18} color={C.textMuted} />
                ) : (
                  <ChevronDown size={18} color={C.textMuted} />
                )}
                             {" "}
              </button>
                           {" "}
              {customerOpen && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    marginTop: "16px",
                  }}
                >
                                   {" "}
                  <div style={{ position: "relative" }}>
                                       {" "}
                    <User
                      size={16}
                      color={C.textMuted}
                      style={{
                        position: "absolute",
                        left: "14px",
                        top: "50%",
                        transform: "translateY(-50%)",
                      }}
                    />
                                       {" "}
                    <input
                      value={customer.name}
                      onChange={(e) =>
                        setCustomer({ ...customer, name: e.target.value })
                      }
                      placeholder="Customer name"
                      style={{ ...input, paddingLeft: "40px" }}
                    />
                                     {" "}
                  </div>
                                   {" "}
                  <div style={{ display: "flex", gap: "10px" }}>
                                       {" "}
                    <div style={{ position: "relative", flex: 1 }}>
                                           {" "}
                      <Phone
                        size={16}
                        color={C.textMuted}
                        style={{
                          position: "absolute",
                          left: "14px",
                          top: "50%",
                          transform: "translateY(-50%)",
                        }}
                      />
                                           {" "}
                      <input
                        value={customer.phone}
                        onChange={(e) =>
                          setCustomer({ ...customer, phone: e.target.value })
                        }
                        placeholder="Phone"
                        style={{ ...input, paddingLeft: "40px" }}
                      />
                                         {" "}
                    </div>
                                       {" "}
                    <button
                      onClick={searchCustomer}
                      disabled={custSearching}
                      style={{
                        height: "44px",
                        padding: "0 16px",
                        borderRadius: "10px",
                        border: `1.5px solid ${C.border}`,
                        background: C.white,
                        color: C.brand,
                        fontFamily: MANROPE,
                        fontWeight: 700,
                        fontSize: "13px",
                        cursor: custSearching ? "wait" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        whiteSpace: "nowrap",
                      }}
                    >
                                           {" "}
                      {custSearching ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Search size={15} />
                      )}{" "}
                      Find                    {" "}
                    </button>
                                     {" "}
                  </div>
                                   {" "}
                  <div style={{ position: "relative" }}>
                                       {" "}
                    <Mail
                      size={16}
                      color={C.textMuted}
                      style={{
                        position: "absolute",
                        left: "14px",
                        top: "50%",
                        transform: "translateY(-50%)",
                      }}
                    />
                                       {" "}
                    <input
                      value={customer.email}
                      onChange={(e) =>
                        setCustomer({ ...customer, email: e.target.value })
                      }
                      placeholder="Email"
                      style={{ ...input, paddingLeft: "40px" }}
                    />
                                     {" "}
                  </div>
                                   {" "}
                  <p
                    style={{ margin: 0, fontSize: "12px", color: C.textMuted }}
                  >
                    Leave blank to bill as a Walk-in Customer.
                  </p>
                                 {" "}
                </div>
              )}
                         {" "}
            </div>
                     {" "}
          </div>
                    {/* ═══════════ RIGHT PANEL ═══════════ */}         {" "}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "20px",
              position: isMobile ? "static" : "sticky",
              top: "104px",
            }}
          >
                        {/* PRICE SUMMARY */}           {" "}
            <div style={card}>
                           {" "}
              <label style={label}>
                <Receipt
                  size={13}
                  style={{ marginRight: "6px", verticalAlign: "middle" }}
                />
                Price Summary
              </label>
                            <SummaryRow k="Subtotal" v={money(subtotalR)} />   
                        {/* manual discount */}             {" "}
              <div style={{ margin: "12px 0" }}>
                               {" "}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "8px",
                  }}
                >
                                   {" "}
                  <span
                    style={{
                      fontSize: "13px",
                      color: C.textS,
                      fontWeight: 600,
                    }}
                  >
                    Additional Discount
                  </span>
                                   {" "}
                  <div
                    style={{
                      display: "flex",
                      border: `1px solid ${C.border}`,
                      borderRadius: "8px",
                      overflow: "hidden",
                    }}
                  >
                                       {" "}
                    {["flat", "percent"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setManualDiscountType(t)}
                        style={{
                          padding: "5px 12px",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "13px",
                          fontWeight: 700,
                          fontFamily: MANROPE,
                          background:
                            manualDiscountType === t ? C.brand : C.white,
                          color: manualDiscountType === t ? C.white : C.textS,
                        }}
                      >
                                                {t === "flat" ? "₹" : "%"}     
                                       {" "}
                      </button>
                    ))}
                                     {" "}
                  </div>
                                 {" "}
                </div>
                               {" "}
                <input
                  type="number"
                  min="0"
                  value={manualDiscount}
                  onChange={(e) => setManualDiscount(e.target.value)}
                  placeholder={
                    manualDiscountType === "flat"
                      ? "Discount amount (₹)"
                      : "Discount percent (%)"
                  }
                  style={{ ...input, height: "40px" }}
                />
                               {" "}
                {manualDiscountAmount > 0 && (
                  <div
                    style={{
                      textAlign: "right",
                      fontSize: "12px",
                      color: C.green,
                      marginTop: "4px",
                      fontWeight: 600,
                    }}
                  >
                    −{money(manualDiscountAmount)}
                  </div>
                )}
                             {" "}
              </div>
                            {/* promo code */}             {" "}
              <div style={{ marginBottom: "12px" }}>
                               {" "}
                {appliedPromo ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: C.greenBg,
                      borderRadius: "8px",
                      padding: "8px 12px",
                    }}
                  >
                                       {" "}
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: C.green,
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                                            <Tag size={14} />{" "}
                      {appliedPromo.code} (−{money(promoDiscount)})            
                             {" "}
                    </span>
                                       {" "}
                    <button
                      onClick={clearPromo}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: C.green,
                      }}
                    >
                      <X size={15} />
                    </button>
                                     {" "}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "8px" }}>
                                       {" "}
                    <input
                      value={promoInput}
                      onChange={(e) => setPromoInput(e.target.value)}
                      placeholder="Promo code"
                      style={{ ...input, height: "40px", flex: 1 }}
                      onKeyDown={(e) => e.key === "Enter" && applyPromo()}
                    />
                                       {" "}
                    <button
                      onClick={applyPromo}
                      disabled={promoLoading || !promoInput.trim()}
                      style={{
                        height: "40px",
                        padding: "0 16px",
                        borderRadius: "10px",
                        border: `1.5px solid ${C.border}`,
                        background: C.white,
                        color: C.brand,
                        fontFamily: MANROPE,
                        fontWeight: 700,
                        fontSize: "13px",
                        cursor:
                          promoLoading || !promoInput.trim()
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                                           {" "}
                      {promoLoading ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        "Apply"
                      )}
                                         {" "}
                    </button>
                                     {" "}
                  </div>
                )}
                             {" "}
              </div>
                           {" "}
              <div
                style={{
                  borderTop: `1px dashed ${C.border}`,
                  paddingTop: "12px",
                }}
              >
                               {" "}
                {promoDiscount > 0 && (
                  <SummaryRow
                    k={`Promo (${appliedPromo.code})`}
                    v={`−${money(promoDiscount)}`}
                    color={C.green}
                  />
                )}
                               {" "}
                {manualDiscountAmount > 0 && (
                  <SummaryRow
                    k="Manual Discount"
                    v={`−${money(manualDiscountAmount)}`}
                    color={C.green}
                  />
                )}
                               {" "}
                <SummaryRow k="GST (incl.)" v={money(gstOnGoods)} sub />
                               {" "}
                <SummaryRow k="Shipping" v="FREE" color={C.green} />           
                 {" "}
              </div>
                           {" "}
              <div
                style={{
                  borderTop: `1.5px solid ${C.border}`,
                  marginTop: "10px",
                  paddingTop: "14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                               {" "}
                <span
                  style={{
                    fontFamily: MANROPE,
                    fontWeight: 700,
                    fontSize: "16px",
                    color: C.textP,
                  }}
                >
                  Grand Total
                </span>
                               {" "}
                <span
                  style={{
                    fontFamily: MANROPE,
                    fontWeight: 800,
                    fontSize: "24px",
                    color: C.brand,
                  }}
                >
                  {money(grandTotal)}
                </span>
                             {" "}
              </div>
                         {" "}
            </div>
                        {/* PAYMENT */}           {" "}
            <div style={card}>
                           {" "}
              <label style={label}>
                <Banknote
                  size={13}
                  style={{ marginRight: "6px", verticalAlign: "middle" }}
                />
                Payment Method
              </label>
                           {" "}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                  marginBottom: "16px",
                }}
              >
                               {" "}
                {[
                  { v: "Cash", Icon: Banknote },
                  { v: "UPI", Icon: Smartphone },
                  { v: "Card", Icon: CreditCard },
                  { v: "Other", Icon: MoreHorizontal },
                ].map(({ v, Icon }) => (
                  <button
                    key={v}
                    onClick={() => setPaymentMethod(v)}
                    style={iconBtn(paymentMethod === v)}
                  >
                                        <Icon size={16} /> {v}               
                     {" "}
                  </button>
                ))}
                             {" "}
              </div>
                           {" "}
              <label style={{ ...label, fontSize: "12px" }}>
                Payment Status
              </label>
                           {" "}
              <div style={{ display: "flex", gap: "10px" }}>
                               {" "}
                {[
                  {
                    v: "paid",
                    lbl: "Paid",
                    Icon: BadgeCheck,
                    color: C.green,
                    bg: C.greenBg,
                  },
                  {
                    v: "pending",
                    lbl: "Pending",
                    Icon: Clock,
                    color: "var(--color-accent-strong)",
                    bg: "var(--color-accent-subtle)",
                  },
                ].map(({ v, lbl, Icon, color, bg }) => {
                  const active = paymentStatus === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setPaymentStatus(v)}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        height: "44px",
                        borderRadius: "10px",
                        border: active
                          ? `2px solid ${color}`
                          : `1.5px solid ${C.border}`,
                        background: active ? bg : C.white,
                        color: active ? color : C.textS,
                        fontFamily: MANROPE,
                        fontWeight: 700,
                        fontSize: "14px",
                        cursor: "pointer",
                      }}
                    >
                                            <Icon size={16} /> {lbl}           
                             {" "}
                    </button>
                  );
                })}
                             {" "}
              </div>
                         {" "}
            </div>
                        {/* ACTIONS */}           {" "}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "10px" }}
            >
                           {" "}
              <button
                onClick={generateBill}
                disabled={loading || !billItems.length}
                style={{
                  height: "54px",
                  background:
                    loading || !billItems.length
                      ? "var(--color-disabled)"
                      : C.brand,
                  color: C.white,
                  border: "none",
                  borderRadius: "12px",
                  fontFamily: MANROPE,
                  fontWeight: 700,
                  fontSize: "16px",
                  cursor:
                    loading || !billItems.length ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                  boxShadow:
                    loading || !billItems.length
                      ? "none"
                      : `0 4px 16px color-mix(in srgb, var(--color-primary) 25%, transparent)`,
                }}
              >
                               {" "}
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Processing…
                  </>
                ) : (
                  <>
                    <Receipt size={18} /> Generate Bill · {money(grandTotal)}
                  </>
                )}
                             {" "}
              </button>
                           {" "}
              <div style={{ display: "flex", gap: "10px" }}>
                               {" "}
                <button
                  onClick={holdBill}
                  disabled={!billItems.length}
                  style={{
                    flex: 1,
                    height: "46px",
                    background: C.white,
                    border: `1.5px solid ${C.border}`,
                    borderRadius: "10px",
                    color: C.textS,
                    fontFamily: MANROPE,
                    fontWeight: 700,
                    fontSize: "14px",
                    cursor: !billItems.length ? "not-allowed" : "pointer",
                    opacity: !billItems.length ? 0.5 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                  }}
                >
                                    <PauseCircle size={16} /> Hold              
                   {" "}
                </button>
                               {" "}
                <button
                  onClick={resetBill}
                  disabled={!billItems.length && !result}
                  style={{
                    flex: 1,
                    height: "46px",
                    background: C.white,
                    border: `1.5px solid ${C.redBg}`,
                    borderRadius: "10px",
                    color: C.red,
                    fontFamily: MANROPE,
                    fontWeight: 700,
                    fontSize: "14px",
                    cursor:
                      !billItems.length && !result ? "not-allowed" : "pointer",
                    opacity: !billItems.length && !result ? 0.5 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                  }}
                >
                                    <RotateCcw size={16} /> Clear All          
                       {" "}
                </button>
                             {" "}
              </div>
                         {" "}
            </div>
                        {/* ERROR BANNER */}           {" "}
            {result && !result.success && (
              <div
                style={{
                  ...card,
                  background: C.redBg,
                  border: `1.5px solid var(--color-error-subtle)`,
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                }}
              >
                               {" "}
                <AlertCircle
                  size={18}
                  color={C.red}
                  style={{ flexShrink: 0, marginTop: "2px" }}
                />
                               {" "}
                <div>
                                   {" "}
                  <div
                    style={{
                      fontFamily: MANROPE,
                      fontWeight: 700,
                      fontSize: "14px",
                      color: C.red,
                    }}
                  >
                    Bill Creation Failed
                  </div>
                                   {" "}
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "13px",
                      color: C.red,
                      whiteSpace: "pre-line",
                    }}
                  >
                    {result.error}
                  </p>
                                 {" "}
                </div>
                             {" "}
              </div>
            )}
                        {/* HELD BILLS */}           {" "}
            <div style={card}>
                           {" "}
              <button
                onClick={() => setHeldOpen((o) => !o)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                               {" "}
                <span style={{ ...label, marginBottom: 0 }}>
                  <PauseCircle
                    size={13}
                    style={{ marginRight: "6px", verticalAlign: "middle" }}
                  />
                  Held Bills ({heldBills.length})
                </span>
                               {" "}
                {heldOpen ? (
                  <ChevronUp size={18} color={C.textMuted} />
                ) : (
                  <ChevronDown size={18} color={C.textMuted} />
                )}
                             {" "}
              </button>
                           {" "}
              {heldOpen && (
                <div
                  style={{
                    marginTop: "14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                                   {" "}
                  {heldBills.length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "16px 0",
                        color: C.textMuted,
                        fontSize: "13px",
                      }}
                    >
                      No held bills
                    </div>
                  ) : (
                    heldBills.map((h) => (
                      <div
                        key={h.id}
                        style={{
                          background: C.surface,
                          borderRadius: "10px",
                          padding: "12px 14px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "10px",
                        }}
                      >
                                             {" "}
                        <div style={{ minWidth: 0 }}>
                                                 {" "}
                          <div
                            style={{
                              fontSize: "13px",
                              fontWeight: 600,
                              color: C.textP,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {h.customerName}
                          </div>
                                                 {" "}
                          <div style={{ fontSize: "11px", color: C.textMuted }}>
                            {h.itemCount} items · {money(h.total)} ·{" "}
                            {toDateSafe(h.heldAt)?.toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                                               {" "}
                        </div>
                                             {" "}
                        <div
                          style={{ display: "flex", gap: "6px", flexShrink: 0 }}
                        >
                                                 {" "}
                          <button
                            onClick={() => recallBill(h)}
                            style={{
                              padding: "6px 12px",
                              borderRadius: "8px",
                              border: `1.5px solid ${C.border}`,
                              background: C.white,
                              color: C.brand,
                              fontFamily: MANROPE,
                              fontWeight: 700,
                              fontSize: "12px",
                              cursor: "pointer",
                            }}
                          >
                            Recall
                          </button>
                                                 {" "}
                          <button
                            onClick={() => deleteHeld(h.id)}
                            style={{
                              padding: "6px 8px",
                              borderRadius: "8px",
                              border: "none",
                              background: "none",
                              color: C.textMuted,
                              cursor: "pointer",
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                                               {" "}
                        </div>
                                           {" "}
                      </div>
                    ))
                  )}
                                 {" "}
                </div>
              )}
                         {" "}
            </div>
                        {/* RECENT BILLS */}           {" "}
            {recentBills.length > 0 && (
              <div style={card}>
                               {" "}
                <label style={label}>
                  <Clock
                    size={13}
                    style={{ marginRight: "6px", verticalAlign: "middle" }}
                  />
                  Recent Bills
                </label>
                               {" "}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    maxHeight: "300px",
                    overflowY: "auto",
                  }}
                >
                                   {" "}
                  {recentBills.map((o) => (
                    <div
                      key={o.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "10px",
                        padding: "8px 0",
                        borderBottom: `1px solid ${C.border}`,
                      }}
                    >
                                           {" "}
                      <div style={{ minWidth: 0 }}>
                                               {" "}
                        <div
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: C.textP,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {o.userName || "Walk-in"}
                        </div>
                                               {" "}
                        <div
                          style={{
                            fontSize: "11px",
                            color: C.textMuted,
                            fontFamily: MONO,
                          }}
                        >
                          {money(o.total)} · {o.paymentMethod}
                        </div>
                                             {" "}
                      </div>
                                           {" "}
                      <button
                        onClick={() => printInvoice(o)}
                        title="Re-print invoice"
                        style={{
                          padding: "6px 10px",
                          borderRadius: "8px",
                          border: `1.5px solid ${C.border}`,
                          background: C.white,
                          color: C.textS,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "12px",
                          fontWeight: 700,
                          fontFamily: MANROPE,
                        }}
                      >
                                                <Printer size={13} />           
                                 {" "}
                      </button>
                                         {" "}
                    </div>
                  ))}
                                 {" "}
                </div>
                             {" "}
              </div>
            )}
                     {" "}
          </div>
                 {" "}
        </div>
             {" "}
      </div>
         {" "}
    </div>
  );
};

/* ── small presentational helpers ─────────────────────────────────────── */
const qtyBtn = {
  width: "28px",
  height: "28px",
  borderRadius: "6px",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-body)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
const SummaryRow = ({ k, v, color, sub }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "4px 0",
    }}
  >
       {" "}
    <span
      style={{
        fontSize: sub ? "12px" : "13px",
        color: color || (sub ? "var(--color-muted)" : "var(--color-body)"),
        fontWeight: 600,
      }}
    >
      {k}
    </span>
       {" "}
    <span
      style={{
        fontSize: sub ? "12px" : "14px",
        color: color || "var(--color-ink)",
        fontWeight: sub ? 600 : 700,
      }}
    >
      {v}
    </span>
     {" "}
  </div>
);

export default BillingPage;
