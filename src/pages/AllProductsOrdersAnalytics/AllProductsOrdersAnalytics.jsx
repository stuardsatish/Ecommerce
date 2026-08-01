import { useEffect, useState, useMemo, useRef } from "react";
import { collection, getDocs } from "firebase/firestore";
import { fireDB } from "../../context/FirebaseConfig";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  LayoutDashboard,
  Package,
  BarChart3,
  Users,
  ShoppingCart,
  FileText,
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  ChevronDown,
  Download,
  IndianRupee,
  ShoppingBag,
  Calculator,
  Boxes,
  Grid3x3,
  Star,
  TrendingUp,
  MoreVertical,
  Calendar,
  Cpu,
  Shirt,
  Sofa,
  Apple,
  ArrowRight,
  AlertTriangle,
  Layers,
  FileDown,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "react-toastify";
import RightDrawer from "../../components/Common/RightDrawer";

/* ============================== COLORS ============================== */
const C = {
  indigo: "var(--color-primary)",
  activeNav: "var(--color-primary)",
  lightIndigo: "var(--color-surface-muted)",
  sidebarBg: "var(--color-surface-muted)",
  pageBg: "var(--color-background)",
  border: "var(--color-border)",
  textP: "var(--color-ink)",
  textS: "var(--color-body)",
  red: "var(--color-error)",
};
const MONO = "'JetBrains Mono', monospace";

/* ============================== HELPERS ============================== */
const toDate = (v) => {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const formatINR = (n) =>
  `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;
const formatNum = (n) => Number(n || 0).toLocaleString("en-IN");
const trendPct = (cur, prev) => {
  if (!prev) return { pct: cur > 0 ? 100 : 0, up: true, hasPrev: prev > 0 };
  const p = ((cur - prev) / prev) * 100;
  return { pct: Math.abs(Math.round(p * 10) / 10), up: p >= 0, hasPrev: true };
};
const PERIOD_DAYS = {
  today: 1,
  week: 7,
  month: 30,
  quarter: 90,
  halfyear: 180,
  "": 36500,
};
const FILTERS = [
  { key: "today", label: "Today" },
  { key: "week", label: "Last 7 Days" },
  { key: "month", label: "Last 30 Days" },
  { key: "quarter", label: "Last 90 Days" },
  { key: "halfyear", label: "Last 6 Months" },
  { key: "", label: "All Time" },
  { key: "custom", label: "Custom" },
];
const CATEGORY_STYLE = {
  electronics: {
    bg: "var(--color-accent-strong)",
    icon: "var(--color-inverse)",
    Icon: Cpu,
  },
  fashion: {
    bg: "var(--color-info-subtle)",
    icon: "var(--color-body)",
    Icon: Shirt,
  },
  apparel: {
    bg: "var(--color-info-subtle)",
    icon: "var(--color-body)",
    Icon: Shirt,
  },
  furniture: {
    bg: "var(--color-info-subtle)",
    icon: "var(--color-ink)",
    Icon: Sofa,
  },
  groceries: {
    bg: "var(--color-body)",
    icon: "var(--color-inverse)",
    Icon: Apple,
  },
};
const catStyle = (name) =>
  CATEGORY_STYLE[String(name || "").toLowerCase()] || {
    bg: "var(--color-surface-muted)",
    icon: C.indigo,
    Icon: Package,
  };
const fileSafe = (s) =>
  String(s || "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "NA";
const LOW_STOCK = 10;
const stockStatus = (s) => (s <= 0 ? "out" : s <= LOW_STOCK ? "low" : "in");
const statusLabelOf = (s) =>
  stockStatus(s) === "out"
    ? "Out of Stock"
    : stockStatus(s) === "low"
      ? "Low Stock"
      : "In Stock";

// Sortable columns for the Inventory "Stock Levels" table — clicking a header
// sorts the whole table by that column; clicking the same header again flips
// ascending/descending (alphabetical for text columns, numeric for the rest).
const INVENTORY_COLUMNS = [
  { label: "PRODUCT", key: "product", align: "left" },
  { label: "CATEGORY", key: "category", align: "left" },
  { label: "STOCK", key: "stock", align: "right" },
  { label: "UNITS SOLD", key: "units", align: "right" },
  { label: "ORDERS", key: "orders", align: "right" },
  { label: "REVENUE", key: "revenue", align: "right" },
  { label: "STATUS", key: "status", align: "center" },
];

// Real image fields only — no external placeholder fallback here. Order line
// items never store an image (see functions/lib/orderWriter.js — `products`
// only carries productId/title/quantity/finalPrice/category), so returning a
// truthy picsum.photos URL for them was masking the real catalog thumbnail in
// the `p.image || cat?.image` enrichment below, and made every image on this
// page depend on an external CDN (broken/blank when it's unreachable).
const productImage = (p) =>
  p.image ||
  p.productImage ||
  p.imageUrl ||
  p.thumbnail ||
  (Array.isArray(p.gallery) ? p.gallery[0] : "") ||
  "";

// Shared product thumbnail: renders the real image when we have one, otherwise
// a local icon placeholder — never an external URL, so a missing/blocked image
// host can't blank out product tiles across the page.
const ProductThumb = ({ src, alt, size = 40, radius = 4, fill = false }) => {
  if (fill) {
    return src ? (
      <img src={src} alt={alt || ""} className="w-full h-full object-cover" />
    ) : (
      <span
        className="w-full h-full flex items-center justify-center"
        style={{ background: C.lightIndigo }}
      >
                        <Package size={28} style={{ color: C.textS }} />       
           {" "}
      </span>
    );
  }
  return src ? (
    <img
      src={src}
      alt={alt || ""}
      className="object-cover flex-shrink-0"
      style={{
        width: size,
        height: size,
        border: `1px solid ${C.border}`,
        borderRadius: radius,
      }}
    />
  ) : (
    <span
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: C.lightIndigo,
        border: `1px solid ${C.border}`,
        borderRadius: radius,
      }}
    >
                 {" "}
      <Package
        size={Math.max(14, Math.round(size * 0.45))}
        style={{ color: C.textS }}
      />
             {" "}
    </span>
  );
};

const AllProductsOrdersAnalytics = () => {
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("month");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("revenue");
  const [viewMode, setViewMode] = useState("grid");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(""); // Per-product analytics drawer (Analytics tab "View Analytics" button).
  // `displayedProductAnalytics` keeps the last product's data visible while
  // RightDrawer plays its close animation (no blank/stale-flash on swap).

  const [selectedProductAnalytics, setSelectedProductAnalytics] =
    useState(null);
  const [displayedProductAnalytics, setDisplayedProductAnalytics] =
    useState(null);
  const openProductAnalytics = (p) => {
    setSelectedProductAnalytics(p);
    setDisplayedProductAnalytics(p);
  };
  const closeProductAnalytics = () => setSelectedProductAnalytics(null);

  const [revenue, setRevenue] = useState(0);
  const [orders, setOrders] = useState(0);
  const [customers, setCustomers] = useState(0);
  const [productsSold, setProductsSold] = useState(0);
  const [activeProducts, setActiveProducts] = useState(0);
  const [trends, setTrends] = useState({});
  const [chartData, setChartData] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [insights, setInsights] = useState({});
  const [catalog, setCatalog] = useState([]);

  const rootRef = useRef(null);
  const contentRef = useRef(null); // Keep the whole viewport in the dashboard background so nothing cream shows.

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = C.pageBg;
    return () => {
      document.body.style.background = prev;
    };
  }, []); /* ============================== FETCH ============================== */

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const now = new Date();
      const days = PERIOD_DAYS[filter] ?? 30; // Custom range: only active once both From/To are picked and From <= To;
      // otherwise falls back to "all time" (same behavior as the other presets
      // before a valid range is chosen).
      const customValid =
        filter === "custom" &&
        customFrom &&
        customTo &&
        new Date(customFrom) <= new Date(customTo);
      let startDate, endDate, prevStart;
      if (filter === "custom") {
        if (customValid) {
          startDate = new Date(customFrom);
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(customTo);
          endDate.setHours(23, 59, 59, 999);
          const rangeDays = Math.max(
            1,
            Math.round((endDate - startDate) / 86400000),
          );
          prevStart = new Date(startDate.getTime() - rangeDays * 86400000);
        } else {
          startDate = new Date(0);
          endDate = now;
          prevStart = new Date(0);
        }
      } else {
        startDate =
          filter === "today"
            ? new Date(new Date().setHours(0, 0, 0, 0))
            : new Date(now.getTime() - days * 86400000);
        endDate = now;
        prevStart = new Date(now.getTime() - 2 * days * 86400000);
      }

      let totalRevenue = 0,
        totalOrders = 0,
        totalUnits = 0;
      let prevRevenue = 0,
        prevOrders = 0,
        prevUnits = 0;
      const dateMap = {},
        productMap = {},
        prevProductMap = {},
        categoryMap = {},
        prevCategoryMap = {};
      const activeIds = new Set();
      const userPeriod = {}; // uid -> { cur, prev } for customer counts
      // Single source of truth: top-level `orders` collection (same place
      // cart checkout, the Excel restore and the seeder all write to).

      const ordersSnap = await getDocs(collection(fireDB, "orders"));
      ordersSnap.forEach((orderDoc) => {
        const order = orderDoc.data();
        const d = toDate(order.createdAt);
        if (!d) return;
        const inCur = d >= startDate && d <= endDate;
        const inPrev = !inCur && d >= prevStart && d < startDate;
        if (!inCur && !inPrev) return;

        const uid = order.userId || "unknown";
        if (!userPeriod[uid]) userPeriod[uid] = { cur: 0, prev: 0 };

        const total = Number(order.total || 0);
        const items = order.products || order.cartItems || order.items || [];

        if (inCur) {
          userPeriod[uid].cur++;
          totalOrders++;
          totalRevenue += total;
          const dateKey = d.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          });
          if (!dateMap[dateKey])
            dateMap[dateKey] = {
              date: dateKey,
              revenue: 0,
              orders: 0,
              _t: d.getTime(),
            };
          dateMap[dateKey].revenue += total;
          dateMap[dateKey].orders++;
        } else {
          userPeriod[uid].prev++;
          prevOrders++;
          prevRevenue += total;
        }

        items.forEach((p) => {
          const pid = p.productId || p.id || p.title || p.name || "unknown";
          const title =
            p.title || p.name || p.productTitle || "Unknown Product";
          const price = Number(p.price || 0);
          const qty = Number(p.quantity || 1);
          const category = p.category || "Uncategorized";
          const lineRev = price * qty;

          if (inCur) {
            totalUnits += qty;
            activeIds.add(pid);
            if (!productMap[pid])
              productMap[pid] = {
                id: pid,
                title,
                revenue: 0,
                orders: 0,
                units: 0,
                category,
                image: productImage(p),
                price,
                rating: Number(p.rating) || 0,
              };
            productMap[pid].revenue += lineRev;
            productMap[pid].orders++;
            productMap[pid].units += qty;
            if (!productMap[pid].image) productMap[pid].image = productImage(p);

            if (!categoryMap[category])
              categoryMap[category] = {
                name: category,
                revenue: 0,
                ordersSet: new Set(),
                products: new Set(),
              };
            categoryMap[category].revenue += lineRev;
            categoryMap[category].ordersSet.add(orderDoc.id); // distinct orders, not line items
            categoryMap[category].products.add(pid);
          } else {
            prevUnits += qty;
            if (!prevProductMap[pid])
              prevProductMap[pid] = { revenue: 0, orders: 0 };
            prevProductMap[pid].revenue += lineRev;
            prevProductMap[pid].orders++;
            if (!prevCategoryMap[category])
              prevCategoryMap[category] = { revenue: 0 };
            prevCategoryMap[category].revenue += lineRev;
          }
        });
      });

      let customersWithOrders = 0,
        prevCustomersWithOrders = 0;
      Object.values(userPeriod).forEach((v) => {
        if (v.cur > 0) customersWithOrders++;
        if (v.prev > 0) prevCustomersWithOrders++;
      }); // product catalog (real stock + metadata enrichment)

      let catalogById = {};
      try {
        const prodSnap = await getDocs(collection(fireDB, "products"));
        prodSnap.docs.forEach((d) => {
          const x = d.data();
          catalogById[d.id] = {
            id: d.id,
            title: x.title || x.name || "Product",
            category: x.category || "Uncategorized",
            image: productImage(x),
            price: Number(x.price || 0),
            rating: Number(x.rating) || 0,
            stock: Number(x.stock || 0),
          };
        });
      } catch (e) {
        console.log("catalog fetch", e);
      } // chart data with previous-period overlay (aligned by index)

      const curChart = Object.values(dateMap).sort((a, b) => a._t - b._t);
      const chartArray = curChart.map((pt, i) => ({ ...pt, prevRevenue: 0 })); // products array enriched with growth + catalog metadata

      const productsArray = Object.values(productMap)
        .map((p) => {
          const prev = prevProductMap[p.id]?.revenue || 0;
          const g = trendPct(p.revenue, prev);
          const cat = catalogById[p.id];
          return {
            ...p,
            image: p.image || cat?.image,
            category:
              p.category !== "Uncategorized"
                ? p.category
                : cat?.category || p.category,
            rating: p.rating || cat?.rating || 0,
            price: p.price || cat?.price || 0,
            stock: cat ? cat.stock : null,
            growth: (g.up ? 1 : -1) * g.pct,
            growthHasPrev: g.hasPrev,
          };
        })
        .sort((a, b) => b.revenue - a.revenue); // inventory list: every catalog SKU + units sold from orders

      const inventoryList = Object.values(catalogById)
        .map((c) => {
          const pm = productMap[c.id];
          return {
            ...c,
            unitsSold: pm?.units || 0,
            ordersCount: pm?.orders || 0,
            revenue: pm?.revenue || 0,
          };
        })
        .sort((a, b) => a.stock - b.stock);
      setCatalog(inventoryList); // categories

      const catArray = Object.values(categoryMap)
        .map((c) => {
          const prev = prevCategoryMap[c.name]?.revenue || 0;
          const g = trendPct(c.revenue, prev);
          const catOrders = c.ordersSet.size;
          return {
            name: c.name,
            revenue: c.revenue,
            orders: catOrders,
            products: c.products.size,
            aov: catOrders ? c.revenue / catOrders : 0,
            growth: (g.up ? 1 : -1) * g.pct,
          };
        })
        .sort((a, b) => b.revenue - a.revenue);

      const byOrders = [...productsArray].sort((a, b) => b.orders - a.orders);
      const byGrowth = [...productsArray]
        .filter((p) => p.growthHasPrev)
        .sort((a, b) => b.growth - a.growth);
      const worst = [...productsArray].sort((a, b) => a.revenue - b.revenue)[0];

      setRevenue(totalRevenue);
      setOrders(totalOrders);
      setCustomers(customersWithOrders);
      setProductsSold(totalUnits);
      setActiveProducts(activeIds.size);
      setTrends({
        revenue: trendPct(totalRevenue, prevRevenue),
        orders: trendPct(totalOrders, prevOrders),
        customers: trendPct(customersWithOrders, prevCustomersWithOrders),
        productsSold: trendPct(totalUnits, prevUnits),
      });
      setChartData(chartArray);
      setAllProducts(productsArray);
      setCategoryData(catArray.slice(0, 4));
      setInsights({
        highest: productsArray[0],
        mostOrdered: byOrders[0],
        fastestGrowing: byGrowth[0] || byOrders[0],
        lowest: worst,
      });
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [
    filter,
    customFrom,
    customTo,
  ]); /* ============================== DERIVED ============================== */

  const aov = orders === 0 ? 0 : revenue / orders;

  const displayedProducts = useMemo(() => {
    let list = allProducts.filter((p) =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );
    list = [...list].sort((a, b) => {
      if (sortBy === "orders") return b.orders - a.orders;
      if (sortBy === "units") return b.units - a.units;
      if (sortBy === "growth") return b.growth - a.growth;
      return b.revenue - a.revenue;
    });
    return list;
  }, [allProducts, searchQuery, sortBy]);

  const ordersBarData = useMemo(
    () => [...allProducts].sort((a, b) => b.orders - a.orders).slice(0, 5),
    [allProducts],
  );
  const maxOrders = ordersBarData[0]?.orders || 1; // Column-header sort for the Stock Levels table: click a header to sort the
  // whole table by that column; click it again to flip asc/desc.

  const [invSort, setInvSort] = useState({ key: "stock", dir: "asc" });
  const toggleInvSort = (key) => {
    setInvSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };
  const displayedInventory = useMemo(() => {
    const list = catalog.filter((c) =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );
    const { key, dir } = invSort;
    const mul = dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (key === "product")
        return mul * String(a.title || "").localeCompare(String(b.title || ""));
      if (key === "category")
        return (
          mul * String(a.category || "").localeCompare(String(b.category || ""))
        );
      if (key === "units") return mul * (a.unitsSold - b.unitsSold);
      if (key === "orders") return mul * (a.ordersCount - b.ordersCount);
      if (key === "revenue") return mul * (a.revenue - b.revenue);
      if (key === "status")
        return (
          mul * statusLabelOf(a.stock).localeCompare(statusLabelOf(b.stock))
        );
      return mul * (a.stock - b.stock); // "stock" (default)
    });
    return list;
  }, [catalog, searchQuery, invSort]);
  const inventoryStats = useMemo(() => {
    let inS = 0,
      lowS = 0,
      outS = 0;
    catalog.forEach((c) => {
      const st = stockStatus(c.stock);
      if (st === "in") inS++;
      else if (st === "low") lowS++;
      else outS++;
    });
    return {
      skus: catalog.length,
      inStock: inS,
      lowStock: lowS,
      outStock: outS,
    };
  }, [catalog]);

  const chartSummary = useMemo(() => {
    const totalRev = chartData.reduce((s, d) => s + d.revenue, 0);
    let peak = 0;
    for (let i = 1; i < chartData.length; i++) {
      if (chartData[i - 1].revenue > 0) {
        const g =
          ((chartData[i].revenue - chartData[i - 1].revenue) /
            chartData[i - 1].revenue) *
          100;
        if (g > peak) peak = g;
      }
    }
    const recent = chartData[chartData.length - 1]?.revenue || 0;
    return { totalRev, peak: Math.round(peak), recent };
  }, [chartData]); // Human-readable label for the active period — shared by the header, exports
  // and the PDF report so "Custom" always shows the actual selected dates.

  const periodLabel =
    filter === "custom"
      ? customFrom && customTo
        ? `${new Date(customFrom).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} – ${new Date(customTo).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
        : "Custom (select dates)"
      : FILTERS.find((f) => f.key === filter)?.label ||
        "All Time"; /* ============================== EXPORT TO EXCEL ==============================
       Workbook built from the same derived data the dashboard shows (unified orders
       source), honouring the active period, search and sort. Unlike the PDF report
       (a static, formatted snapshot for sharing/printing), this workbook is meant
       for further analysis — raw numeric cells (not pre-formatted strings), a
       header row on every sheet with autofilter dropdowns already enabled, and
       data the PDF doesn't carry at all (daily Revenue Trend, Insights/top
       performers, per-row Revenue Share %) so it earns its place as a distinct,
       more analytically useful export rather than duplicating the PDF's numbers. */

  const autoSheet = (wb, name, rows, colWidths) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    if (rows.length) {
      const range = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rows.length, c: Object.keys(rows[0]).length - 1 },
      });
      ws["!autofilter"] = { ref: range };
    }
    if (colWidths) ws["!cols"] = colWidths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  const exportToExcel = () => {
    if (!displayedProducts.length && !displayedInventory.length) {
      toast.info("No product data to export for this period.");
      return;
    }
    const totalCatRevenue =
      categoryData.reduce((s, c) => s + c.revenue, 0) || 1;

    const summary = [
      ["Products & Orders Analytics"],
      ["Period", periodLabel],
      ...(filter === "custom"
        ? [["Custom Range", `${customFrom || "—"} to ${customTo || "—"}`]]
        : []),
      ["Generated", new Date().toLocaleString("en-IN")],
      [],
      ["Metric", "Value"],
      ["Total Revenue (INR)", Math.round(revenue)],
      ["Total Orders", orders],
      ["Avg Order Value (INR)", Math.round(aov)],
      ["Unique Customers", customers],
      ["Units Sold", productsSold],
      ["Active Products", activeProducts],
      ["Total SKUs", inventoryStats.skus],
      ["In Stock", inventoryStats.inStock],
      ["Low Stock", inventoryStats.lowStock],
      ["Out of Stock", inventoryStats.outStock],
      [],
      ["Top Insight", "Product", "Value"],
      [
        "Highest Revenue",
        insights.highest?.title || "—",
        Math.round(insights.highest?.revenue || 0),
      ],
      [
        "Most Ordered",
        insights.mostOrdered?.title || "—",
        insights.mostOrdered?.orders || 0,
      ],
      [
        "Fastest Growing",
        insights.fastestGrowing?.title || "—",
        insights.fastestGrowing?.growthHasPrev
          ? `${insights.fastestGrowing.growth >= 0 ? "+" : ""}${Math.round(insights.fastestGrowing.growth)}%`
          : "N/A",
      ],
      [
        "Lowest Performing",
        insights.lowest?.title || "—",
        Math.round(insights.lowest?.revenue || 0),
      ],
    ]; // Products — raw numeric cells throughout (not rounded display strings) so
    // Excel formulas/SUMs/pivots work directly on them, plus a Revenue Share %
    // column so relative contribution doesn't need a manual calc.

    const products = displayedProducts.map((p, i) => ({
      Rank: i + 1,
      Product: p.title,
      Category: p.category || "—",
      "Units Sold": p.units || 0,
      Orders: p.orders || 0,
      Revenue: Math.round(p.revenue || 0),
      "Revenue Share %": revenue
        ? Math.round((p.revenue / revenue) * 1000) / 10
        : 0,
      "Growth %": p.growthHasPrev ? Math.round(p.growth * 10) / 10 : "N/A",
      Price: Math.round(p.price || 0),
      Stock: p.stock ?? "—",
      Rating: p.rating || "—",
    })); // Category Performance — the PDF has this sheet, the old Excel export
    // didn't; added here for parity plus a Revenue Share % column.

    const categories = categoryData.map((c) => ({
      Category: c.name,
      Revenue: Math.round(c.revenue),
      "Revenue Share %": Math.round((c.revenue / totalCatRevenue) * 1000) / 10,
      Orders: c.orders,
      Products: c.products,
      "AOV (INR)": Math.round(c.aov),
      "Growth %": Math.round(c.growth * 10) / 10,
    })); // Revenue Trend — the daily revenue/orders series behind the dashboard
    // chart. Neither export previously carried this; it's the most useful
    // thing for building your own trend charts/pivots in Excel.

    const trend = chartData.map((d) => ({
      Date: d.date,
      Revenue: Math.round(d.revenue || 0),
      Orders: d.orders || 0,
    }));

    const inventory = displayedInventory.map((c) => ({
      Product: c.title,
      Category: c.category || "—",
      Stock: c.stock ?? "—",
      Status:
        stockStatus(c.stock) === "out"
          ? "Out of Stock"
          : stockStatus(c.stock) === "low"
            ? "Low Stock"
            : "In Stock",
      "Units Sold": c.unitsSold || 0,
      Orders: c.ordersCount || 0,
      Revenue: Math.round(c.revenue || 0),
      "Revenue Share %": revenue
        ? Math.round((c.revenue / revenue) * 1000) / 10
        : 0,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(summary),
      "Summary",
    );
    autoSheet(
      wb,
      "Products",
      products,
      [6, 32, 16, 10, 8, 12, 14, 10, 10, 8, 8],
    );
    autoSheet(
      wb,
      "Category Performance",
      categories,
      [16, 12, 14, 8, 10, 12, 10],
    );
    autoSheet(wb, "Revenue Trend", trend, [12, 12, 10]);
    autoSheet(wb, "Inventory", inventory, [32, 16, 8, 14, 10, 8, 12, 14]);
    XLSX.writeFile(
      wb,
      `Products_Analytics_${fileSafe(periodLabel)}_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    toast.success("Exported products analytics to Excel.");
  }; /* ============================== DOWNLOAD REPORT (PDF) ==============================
       Detailed, multi-section PDF built from the same derived data as every tab
       (Dashboard KPIs, Analytics categories + full catalog, Inventory stock
       levels) for the currently active period/filter — replaces the previous
       `window.print()` stub, which just printed whatever tab happened to be on
       screen instead of a real, complete report. */

  const downloadReportPDF = () => {
    if (!displayedProducts.length && !displayedInventory.length) {
      toast.info("No product data to generate a report for this period.");
      return;
    }
    if (
      filter === "custom" &&
      customFrom &&
      customTo &&
      new Date(customFrom) > new Date(customTo)
    ) {
      toast.error("Fix the custom date range before downloading the report.");
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const M = 40;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const rightX = pageW - M; // Add a fresh page + section title, breaking early if the current page
    // has no room left for a heading + a few rows.

    const sectionTitle = (title, y) => {
      let ty = y;
      if (ty > pageH - 100) {
        doc.addPage();
        ty = M;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(25, 28, 30);
      doc.text(title, M, ty);
      return ty + 16;
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(169, 21, 21);
    doc.text("Product & Order Analytics Report", M, M);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(80, 95, 118);
    doc.text(`Period: ${periodLabel}`, M, M + 20);
    doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, M, M + 36);
    doc.setDrawColor(228, 226, 225);
    doc.line(
      M,
      M + 48,
      rightX,
      M + 48,
    ); /* ---- Key Metrics (Dashboard tab) ---- */

    let y = sectionTitle("Key Metrics", M + 72);
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [["Metric", "Value"]],
      body: [
        ["Total Revenue", formatINR(revenue)],
        ["Total Orders", formatNum(orders)],
        ["Unique Customers", formatNum(customers)],
        ["Average Order Value", formatINR(aov)],
        ["Products Sold (units)", formatNum(productsSold)],
        ["Active Products", formatNum(activeProducts)],
        ["Total SKUs", formatNum(inventoryStats.skus)],
        ["In Stock", formatNum(inventoryStats.inStock)],
        ["Low Stock", formatNum(inventoryStats.lowStock)],
        ["Out of Stock", formatNum(inventoryStats.outStock)],
      ],
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 5,
        textColor: [40, 40, 50],
        lineColor: [225, 224, 235],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [169, 21, 21],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [250, 248, 255] },
    }); /* ---- Category Performance (Analytics tab) ---- */

    y = sectionTitle("Category Performance", doc.lastAutoTable.finalY + 28);
    if (categoryData.length) {
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        head: [["Category", "Revenue", "Orders", "Products", "Growth %"]],
        body: categoryData.map((c) => [
          c.name,
          formatINR(c.revenue),
          formatNum(c.orders),
          formatNum(c.products),
          `${c.growth >= 0 ? "+" : ""}${c.growth}%`,
        ]),
        styles: {
          font: "helvetica",
          fontSize: 9,
          cellPadding: 5,
          textColor: [40, 40, 50],
          lineColor: [225, 224, 235],
          lineWidth: 0.5,
        },
        headStyles: {
          fillColor: [169, 21, 21],
          textColor: [255, 255, 255],
          fontStyle: "bold",
        },
        alternateRowStyles: { fillColor: [250, 248, 255] },
        columnStyles: {
          1: { halign: "right" },
          2: { halign: "right" },
          3: { halign: "right" },
          4: { halign: "right" },
        },
      });
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(80, 95, 118);
      doc.text("No category data for this period.", M, y);
      doc.lastAutoTable = { finalY: y };
    } /* ---- Full Product Catalog (Analytics tab — honors active search/sort) ---- */

    y = sectionTitle(
      `Products (${displayedProducts.length})`,
      doc.lastAutoTable.finalY + 28,
    );
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [
        ["#", "Product", "Category", "Revenue", "Orders", "Units", "Growth %"],
      ],
      body: displayedProducts.length
        ? displayedProducts.map((p, i) => [
            String(i + 1),
            p.title,
            p.category || "—",
            formatINR(p.revenue),
            formatNum(p.orders),
            formatNum(p.units),
            p.growthHasPrev
              ? `${p.growth >= 0 ? "+" : ""}${Math.round(p.growth)}%`
              : "N/A",
          ])
        : [["—", "No products match the current filters.", "", "", "", "", ""]],
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 4,
        textColor: [40, 40, 50],
        lineColor: [225, 224, 235],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [169, 21, 21],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [250, 248, 255] },
      columnStyles: {
        0: { halign: "center", cellWidth: 24 },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
    }); /* ---- Inventory / Stock Levels (Inventory tab) ---- */

    y = sectionTitle(
      `Inventory (${displayedInventory.length} SKUs)`,
      doc.lastAutoTable.finalY + 28,
    );
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [
        [
          "Product",
          "Category",
          "Stock",
          "Status",
          "Units Sold",
          "Orders",
          "Revenue",
        ],
      ],
      body: displayedInventory.length
        ? displayedInventory.map((c) => [
            c.title,
            c.category || "—",
            formatNum(c.stock),
            stockStatus(c.stock) === "out"
              ? "Out of Stock"
              : stockStatus(c.stock) === "low"
                ? "Low Stock"
                : "In Stock",
            formatNum(c.unitsSold),
            formatNum(c.ordersCount),
            formatINR(c.revenue),
          ])
        : [["No inventory data.", "", "", "", "", "", ""]],
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 4,
        textColor: [40, 40, 50],
        lineColor: [225, 224, 235],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [169, 21, 21],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [250, 248, 255] },
      columnStyles: {
        2: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
    }); /* ---- Footer: page numbers ---- */

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 160);
      doc.text(`Page ${i} of ${pageCount}`, rightX, pageH - 20, {
        align: "right",
      });
    }

    doc.save(
      `Product_Analytics_Report_${fileSafe(periodLabel)}_${new Date().toISOString().slice(0, 10)}.pdf`,
    );
    toast.success("Report downloaded.");
  }; /* ============================== ANIMATIONS ============================== */

  useGSAP(
    () => {
      if (loading) return;
      gsap.from(".kpi-card", {
        opacity: 0,
        y: 20,
        stagger: 0.08,
        duration: 0.4,
        ease: "power2.out",
      });
      gsap.from(".chart-container", {
        opacity: 0,
        duration: 0.5,
        ease: "power2.out",
      });
      gsap.from(".insight-card", {
        opacity: 0,
        scale: 0.97,
        stagger: 0.1,
        duration: 0.4,
        ease: "power2.out",
      });
      gsap.from(".product-row", {
        opacity: 0,
        x: -10,
        stagger: 0.05,
        duration: 0.3,
        ease: "power2.out",
        delay: 0.2,
      });
    },
    { scope: rootRef, dependencies: [loading, activeTab] },
  ); /* ============================== SUB RENDERERS ============================== */

  const KpiTrend = ({ t, neutral, label }) => {
    if (neutral)
      return (
        <span
          className="text-xs px-2 py-0.5 rounded"
          style={{ color: C.textS }}
        >
          {label}
        </span>
      );
    if (!t) return null;
    return (
      <span
        className="flex items-center gap-0.5 text-xs font-semibold"
        style={{ color: t.up ? C.indigo : C.red }}
      >
                       {" "}
        <TrendingUp size={12} className={t.up ? "" : "rotate-180"} />
        {t.up ? "+" : "-"}
        {t.pct}%            {" "}
      </span>
    );
  };
  const KpiCard = ({ icon, label, value, trend, neutral, neutralLabel }) => (
    <div
      className="kpi-card bg-surface rounded-xl p-4 flex flex-col gap-2"
      style={{
        border: `1px solid ${C.border}`,
        boxShadow: "0px 1px 2px rgba(0,0,0,0.05)",
      }}
    >
                 {" "}
      <div className="flex items-center justify-between">
                       {" "}
        <span
          className="flex items-center justify-center rounded-lg p-1.5"
          style={{ background: C.lightIndigo }}
        >
          {icon}
        </span>
                       {" "}
        <KpiTrend t={trend} neutral={neutral} label={neutralLabel} />         
         {" "}
      </div>
                 {" "}
      <span
        className="text-xs"
        style={{ color: C.textS, letterSpacing: "0.12px" }}
      >
        {label}
      </span>
                 {" "}
      <span className="text-2xl font-semibold" style={{ color: C.textP }}>
        {value}
      </span>
             {" "}
    </div>
  );

  const SidebarLink = ({ icon, label, active }) => (
    <button
      className="flex items-center gap-3 w-full rounded-lg text-sm font-medium"
      style={{
        padding: "8px 16px",
        background: active ? C.activeNav : "transparent",
        color: active ? "var(--color-inverse)" : C.textS,
      }}
    >
                  {icon}
      <span>{label}</span>       {" "}
    </button>
  ); /* ============================== RENDER ============================== */

  return (
    <div
      ref={rootRef}
      className="min-h-screen"
      style={{ background: C.pageBg, fontFamily: "Inter, sans-serif" }}
    >
                  {/* MAIN (desktop ≥ md) */}           {" "}
      <div className="hidden md:flex flex-1 min-w-0 flex-col">
                        {/* TOP NAV */}               {" "}
        <div
          className="flex items-center justify-between px-6 lg:px-8 pt-4"
          style={{ background: C.pageBg, minHeight: "64px" }}
        >
                             {" "}
          <div>
                                   {" "}
            <div className="flex gap-6">
                                         {" "}
              {[
                { k: "dashboard", l: "Dashboard" },
                { k: "analytics", l: "Analytics" },
                { k: "inventory", l: "Inventory" },
                { k: "reports", l: "Reports" },
              ].map((t) => (
                <button
                  key={t.k}
                  onClick={() => setActiveTab(t.k)}
                  className="pb-3 text-sm font-medium"
                  style={{
                    color: activeTab === t.k ? C.indigo : C.textS,
                    borderBottom:
                      activeTab === t.k
                        ? `2px solid ${C.indigo}`
                        : "2px solid transparent",
                  }}
                >
                                                      {t.l}                     
                           {" "}
                </button>
              ))}
                                     {" "}
            </div>
                               {" "}
          </div>
                         {" "}
        </div>
                       {" "}
        {loading ? (
          (() => {
            const bar = (style) => (
              <div
                aria-hidden="true"
                className="animate-pulse"
                style={{
                  background: "var(--color-surface-muted)",
                  borderRadius: "6px",
                  ...style,
                }}
              />
            );
            return (
              <div className="px-6 lg:px-8 py-6" aria-busy="true">
                                                {/* Header */}                 
                             {" "}
                <div className="flex items-start justify-between gap-4 mb-6">
                                                     {" "}
                  <div className="flex flex-col gap-2">
                    {bar({ width: "220px", height: "24px" })}
                    {bar({ width: "300px", height: "14px" })}
                  </div>
                                                     {" "}
                  <div className="flex items-center gap-3">
                    {bar({
                      width: "120px",
                      height: "40px",
                      borderRadius: "8px",
                    })}
                    {bar({
                      width: "110px",
                      height: "40px",
                      borderRadius: "8px",
                    })}
                  </div>
                                                 {" "}
                </div>
                                                {/* KPI cards */}               
                               {" "}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
                                                     {" "}
                  {[...Array(6)].map((_, i) => (
                    <div
                      key={i}
                      className="bg-surface rounded-xl p-4 flex flex-col gap-3"
                      style={{ border: `1px solid ${C.border}` }}
                    >
                                                                 {" "}
                      <div className="flex items-center justify-between">
                        {bar({
                          width: "32px",
                          height: "32px",
                          borderRadius: "8px",
                        })}
                        {bar({ width: "44px", height: "14px" })}
                      </div>
                                                                 {" "}
                      {bar({ width: "60%", height: "12px" })}                   
                                             {" "}
                      {bar({ width: "70%", height: "22px" })}                   
                                         {" "}
                    </div>
                  ))}
                                                 {" "}
                </div>
                                                {/* Charts */}                 
                             {" "}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
                                                     {" "}
                  <div
                    className="lg:col-span-2 bg-surface rounded-xl p-6"
                    style={{ border: `1px solid ${C.border}` }}
                  >
                                                           {" "}
                    <div className="flex items-center justify-between mb-4">
                      {bar({ width: "150px", height: "18px" })}
                      {bar({ width: "160px", height: "12px" })}
                    </div>
                                                           {" "}
                    {bar({
                      width: "100%",
                      height: "320px",
                      borderRadius: "12px",
                    })}
                                                       {" "}
                  </div>
                                                     {" "}
                  <div
                    className="bg-surface rounded-xl p-6"
                    style={{ border: `1px solid ${C.border}` }}
                  >
                                                           {" "}
                    {bar({
                      width: "140px",
                      height: "18px",
                      marginBottom: "20px",
                    })}
                                                           {" "}
                    <div className="flex flex-col gap-4">
                                                                 {" "}
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="flex items-center gap-3">
                          {bar({
                            width: "36px",
                            height: "36px",
                            borderRadius: "8px",
                          })}
                          <div className="flex flex-col gap-2 flex-1">
                            {bar({ width: "70%", height: "12px" })}
                            {bar({ width: "40%", height: "10px" })}
                          </div>
                        </div>
                      ))}
                                                             {" "}
                    </div>
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                                {/* Inventory table */}         
                                     {" "}
                <div
                  className="bg-surface rounded-xl overflow-hidden"
                  style={{ border: `1px solid ${C.border}` }}
                >
                                                     {" "}
                  <div
                    className="flex items-center gap-4 px-4 py-3"
                    style={{ background: "var(--color-surface-muted)" }}
                  >
                                                           {" "}
                    {[...Array(7)].map((_, i) => (
                      <div key={i} style={{ flex: 1 }}>
                        {bar({ width: "60%", height: "11px" })}
                      </div>
                    ))}
                                                       {" "}
                  </div>
                                                     {" "}
                  {[...Array(6)].map((_, r) => (
                    <div
                      key={r}
                      className="flex items-center gap-4 px-4 py-3"
                      style={{ borderTop: `1px solid ${C.border}` }}
                    >
                                                                 {" "}
                      {[...Array(7)].map((_, i) => (
                        <div key={i} style={{ flex: 1 }}>
                          {bar({
                            width: i === 0 ? "80%" : "60%",
                            height: "14px",
                          })}
                        </div>
                      ))}
                                                             {" "}
                    </div>
                  ))}
                                                 {" "}
                </div>
                                           {" "}
              </div>
            );
          })()
        ) : (
          <div ref={contentRef} className="px-6 lg:px-8 py-6">
                                    {/* PAGE HEADER */}                       {" "}
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
                                         {" "}
              <div>
                                               {" "}
                <h3
                  className="font-semibold"
                  style={{ fontSize: "24px", color: C.textP }}
                >
                  Product Analytics
                </h3>
                                               {" "}
                <p style={{ fontSize: "14px", color: C.textS }}>
                  Real-time product performance and inventory insights
                </p>
                                           {" "}
              </div>
                                         {" "}
              <div className="flex items-center gap-3">
                                               {" "}
                <button
                  className="flex items-center gap-2 rounded-lg px-4 text-sm font-medium"
                  style={{
                    background: C.pageBg,
                    border: `1px solid ${C.border}`,
                    height: "40px",
                    color: C.textP,
                  }}
                >
                                                      <Calendar size={16} />{" "}
                  {periodLabel}                               {" "}
                </button>
                                               {" "}
                <button
                  onClick={exportToExcel}
                  title="Export to Excel"
                  className="flex items-center gap-2 rounded-lg px-4 text-sm font-semibold text-inverse"
                  style={{ background: C.indigo, height: "40px" }}
                >
                                                      <Download size={16} />{" "}
                  Export                                {" "}
                </button>
                                           {" "}
              </div>
                                     {" "}
            </div>
                                    {/* STICKY FILTER BAR */}                   
               {" "}
            <div
              className="sticky top-0 z-10 py-4 mb-6 flex flex-col gap-3"
              style={{
                background:
                  "color-mix(in srgb, var(--color-background) 85%, transparent)",
                backdropFilter: "blur(6px)",
                borderBottom: `1px solid color-mix(in srgb, var(--color-border) 40%, transparent)`,
              }}
            >
                                         {" "}
              <div className="flex flex-wrap items-center gap-1">
                                               {" "}
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className="text-xs font-medium rounded-full"
                    style={
                      filter === f.key
                        ? {
                            background: C.indigo,
                            color: "var(--color-inverse)",
                            padding: "5px 16px",
                          }
                        : {
                            background: "var(--color-surface)",
                            color: C.textS,
                            border: `1px solid ${C.border}`,
                            padding: "4px 16px",
                          }
                    }
                  >
                                                            {f.label}           
                                           {" "}
                  </button>
                ))}
                                               {" "}
                {filter === "custom" && (
                  <div className="flex items-center gap-2 ml-1">
                                                           {" "}
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      max={customTo || undefined}
                      className="outline-none rounded-lg text-xs px-2 py-1.5 bg-surface"
                      style={{ border: `1px solid ${C.border}` }}
                    />
                                                           {" "}
                    <span className="text-xs" style={{ color: C.textS }}>
                      to
                    </span>
                                                           {" "}
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      min={customFrom || undefined}
                      className="outline-none rounded-lg text-xs px-2 py-1.5 bg-surface"
                      style={{ border: `1px solid ${C.border}` }}
                    />
                                                           {" "}
                    {customFrom &&
                      customTo &&
                      new Date(customFrom) > new Date(customTo) && (
                        <span
                          className="text-xs font-semibold"
                          style={{ color: C.red }}
                        >
                          From date must be before To date
                        </span>
                      )}
                                                       {" "}
                  </div>
                )}
                                           {" "}
              </div>
                                         {" "}
              <div className="flex flex-wrap gap-2">
                                               {" "}
                <div className="relative" style={{ width: "256px" }}>
                                                     {" "}
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: "var(--color-muted)" }}
                  />
                                                     {" "}
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search products..."
                    className="w-full outline-none rounded-lg text-sm bg-surface"
                    style={{
                      border: `1px solid ${C.border}`,
                      padding: "9px 16px 10px 32px",
                    }}
                  />
                                                 {" "}
                </div>
                                               {" "}
                <div
                  className="flex items-center gap-2 rounded-lg px-3 bg-surface"
                  style={{ border: `1px solid ${C.border}` }}
                >
                                                     {" "}
                  <ArrowUpDown size={15} style={{ color: C.textS }} />         
                                           {" "}
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="outline-none bg-transparent text-sm py-2"
                    style={{ color: C.textP }}
                  >
                                                           {" "}
                    <option value="revenue">Sort by: Revenue</option>           
                                               {" "}
                    <option value="orders">Sort by: Orders</option>             
                                             {" "}
                    <option value="units">Sort by: Units</option>               
                                           {" "}
                    <option value="growth">Sort by: Growth</option>             
                                         {" "}
                  </select>
                                                 {" "}
                </div>
                                               {" "}
                <button
                  className="flex items-center gap-2 rounded-lg px-3 text-sm bg-surface"
                  style={{ border: `1px solid ${C.border}`, color: C.textS }}
                >
                                                     {" "}
                  <SlidersHorizontal size={15} /> Filter                        
                         {" "}
                </button>
                                           {" "}
              </div>
                                     {" "}
            </div>
                                   {" "}
            {/* ============ DASHBOARD VIEW ============ */}                   
               {" "}
            {activeTab === "dashboard" && (
              <>
                                                {/* KPI CARDS */}               
                               {" "}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
                                                     {" "}
                  <KpiCard
                    icon={<IndianRupee size={18} style={{ color: C.indigo }} />}
                    label="Total Revenue"
                    value={formatINR(revenue)}
                    trend={trends.revenue}
                  />
                                                     {" "}
                  <KpiCard
                    icon={<ShoppingBag size={18} style={{ color: C.indigo }} />}
                    label="Total Orders"
                    value={formatNum(orders)}
                    trend={trends.orders}
                  />
                                                     {" "}
                  <KpiCard
                    icon={<Users size={18} style={{ color: C.indigo }} />}
                    label="Total Customers"
                    value={formatNum(customers)}
                    trend={trends.customers}
                  />
                                                     {" "}
                  <KpiCard
                    icon={<Calculator size={18} style={{ color: C.indigo }} />}
                    label="AOV"
                    value={formatINR(aov)}
                    neutral
                    neutralLabel="Avg"
                  />
                                                     {" "}
                  <KpiCard
                    icon={<Boxes size={18} style={{ color: C.indigo }} />}
                    label="Products Sold"
                    value={formatNum(productsSold)}
                    trend={trends.productsSold}
                  />
                                                     {" "}
                  <KpiCard
                    icon={<Grid3x3 size={18} style={{ color: C.indigo }} />}
                    label="Active Products"
                    value={formatNum(activeProducts)}
                    neutral
                    neutralLabel="Active"
                  />
                                                 {" "}
                </div>
                                                {/* CHARTS */}                 
                             {" "}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
                                                      {/* Revenue Trend */}     
                                               {" "}
                  <div
                    className="chart-container lg:col-span-2 bg-surface rounded-xl"
                    style={{ border: `1px solid ${C.border}` }}
                  >
                                                           {" "}
                    <div className="flex items-center justify-between p-6 pb-2">
                                                                 {" "}
                      <h4
                        className="font-semibold"
                        style={{ fontSize: "18px", color: C.textP }}
                      >
                        Revenue Trend
                      </h4>
                                                                 {" "}
                      <div
                        className="flex items-center gap-4 text-xs"
                        style={{ color: C.textS }}
                      >
                                                                       {" "}
                        <span className="flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ background: C.indigo }}
                          />
                          Revenue
                        </span>
                                                                       {" "}
                        <span className="flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ background: C.border }}
                          />
                          Previous Period
                        </span>
                                                                   {" "}
                      </div>
                                                             {" "}
                    </div>
                                                           {" "}
                    <div className="px-4" style={{ height: "320px" }}>
                                                                 {" "}
                      <ResponsiveContainer width="100%" height="100%">
                                                                       {" "}
                        <BarChart
                          data={chartData}
                          margin={{ top: 16, right: 16, left: 0, bottom: 0 }}
                        >
                                                                             {" "}
                          <CartesianGrid
                            vertical={false}
                            stroke="var(--color-chart-grid)"
                            strokeOpacity={0.2}
                          />
                                                                             {" "}
                          <XAxis
                            dataKey="date"
                            tick={{
                              fontSize: 11,
                              fill: "var(--color-chart-axis)",
                            }}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                          />
                                                                             {" "}
                          <YAxis
                            tick={{
                              fontSize: 11,
                              fill: "var(--color-chart-axis)",
                            }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) =>
                              v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
                            }
                            width={44}
                          />
                                                                             {" "}
                          <Tooltip formatter={(v) => formatINR(v)} />
                                                                             {" "}
                          <Bar
                            dataKey="revenue"
                            fill="color-mix(in srgb, var(--color-chart-1) 20%, transparent)"
                            radius={[2, 2, 0, 0]}
                          />
                                                                         {" "}
                        </BarChart>
                                                                   {" "}
                      </ResponsiveContainer>
                                                             {" "}
                    </div>
                                                           {" "}
                    <div
                      className="grid grid-cols-3"
                      style={{ borderTop: `1px solid ${C.border}` }}
                    >
                                                                 {" "}
                      <SummaryCol
                        label="Total Revenue This Period"
                        value={formatINR(chartSummary.totalRev)}
                      />
                                                                 {" "}
                      <SummaryCol
                        label="Peak Day Growth"
                        value={`+${chartSummary.peak}%`}
                        green
                        border
                      />
                                                                 {" "}
                      <SummaryCol
                        label="Most Recent Period"
                        value={formatINR(chartSummary.recent)}
                      />
                                                             {" "}
                    </div>
                                                       {" "}
                  </div>
                                                     {" "}
                  {/* Orders Trend (top products by orders) */}                 
                                   {" "}
                  <div
                    className="chart-container bg-surface rounded-xl p-6"
                    style={{ border: `1px solid ${C.border}` }}
                  >
                                                           {" "}
                    <div className="flex items-center justify-between mb-5">
                                                                 {" "}
                      <h4
                        className="font-semibold"
                        style={{ fontSize: "18px", color: C.textP }}
                      >
                        Orders Trend
                      </h4>
                                                                 {" "}
                      <MoreVertical size={18} style={{ color: C.textS }} />     
                                                       {" "}
                    </div>
                                                           {" "}
                    <div className="flex flex-col gap-4">
                                                                 {" "}
                      {ordersBarData.map((p) => (
                        <div key={p.id}>
                                                                             {" "}
                          <div className="flex items-center justify-between mb-1.5 text-sm">
                                                                               
                               {" "}
                            <span
                              className="truncate pr-2"
                              style={{ color: C.textP }}
                            >
                              {p.title}
                            </span>
                                                                               
                               {" "}
                            <span
                              className="font-semibold"
                              style={{ color: C.textP }}
                            >
                              {formatNum(p.orders)}
                            </span>
                                                                             
                             {" "}
                          </div>
                                                                             {" "}
                          <div
                            className="rounded-full overflow-hidden"
                            style={{
                              height: "8px",
                              background: "var(--color-surface-muted)",
                            }}
                          >
                                                                               
                               {" "}
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(p.orders / maxOrders) * 100}%`,
                                background: C.activeNav,
                              }}
                            />
                                                                             
                             {" "}
                          </div>
                                                                         {" "}
                        </div>
                      ))}
                                                                 {" "}
                      {ordersBarData.length === 0 && (
                        <p className="text-sm" style={{ color: C.textS }}>
                          No order data.
                        </p>
                      )}
                                                             {" "}
                    </div>
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                                {/* INSIGHTS */}               
                               {" "}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                                                     {" "}
                  <InsightCard
                    label="HIGHEST REVENUE"
                    labelColor={C.indigo}
                    highlight
                    product={insights.highest}
                    sub={
                      insights.highest
                        ? `${formatINR(insights.highest.revenue)} Total Revenue`
                        : "—"
                    }
                  />
                                                     {" "}
                  <InsightCard
                    label="MOST ORDERED"
                    labelColor={C.textS}
                    product={insights.mostOrdered}
                    sub={
                      insights.mostOrdered
                        ? `${formatNum(insights.mostOrdered.orders)} Orders`
                        : "—"
                    }
                  />
                                                     {" "}
                  <InsightCard
                    label="FASTEST GROWING"
                    labelColor={C.indigo}
                    product={insights.fastestGrowing}
                    badge={
                      insights.fastestGrowing
                        ? {
                            text: `+${Math.abs(Math.round(insights.fastestGrowing.growth))}%`,
                            bg: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                            color: C.indigo,
                          }
                        : null
                    }
                  />
                                                     {" "}
                  <InsightCard
                    label="LOWEST PERFORMING"
                    labelColor={C.red}
                    product={insights.lowest}
                    badge={
                      insights.lowest
                        ? {
                            text: formatINR(insights.lowest.revenue),
                            bg: "color-mix(in srgb, var(--color-error) 10%, transparent)",
                            color: C.red,
                          }
                        : null
                    }
                  />
                                                 {" "}
                </div>
                                                {/* TOP PRODUCTS TABLE */}     
                                         {" "}
                <div
                  className="bg-surface rounded-xl overflow-hidden"
                  style={{ border: `1px solid ${C.border}` }}
                >
                                                     {" "}
                  <div
                    className="flex items-center justify-between px-6 py-4"
                    style={{
                      background: C.sidebarBg,
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                                                           {" "}
                    <h4
                      className="font-semibold"
                      style={{ fontSize: "18px", color: C.textP }}
                    >
                      Top Products by Revenue
                    </h4>
                                                           {" "}
                    <button
                      onClick={() => setActiveTab("analytics")}
                      className="text-sm font-medium"
                      style={{ color: C.indigo }}
                    >
                      View All Products
                    </button>
                                                       {" "}
                  </div>
                                                     {" "}
                  <div className="overflow-x-auto">
                                                           {" "}
                    <table className="w-full text-sm">
                                                                 {" "}
                      <thead>
                                                                       {" "}
                        <tr
                          style={{
                            background: C.sidebarBg,
                            borderBottom: `1px solid ${C.border}`,
                          }}
                        >
                                                                             {" "}
                          {[
                            "RANK",
                            "PRODUCT",
                            "CATEGORY",
                            "REVENUE",
                            "ORDERS",
                            "UNITS",
                            "RATING",
                            "GROWTH",
                          ].map((h, i) => (
                            <th
                              key={h}
                              className={`px-4 py-3 text-xs font-semibold ${i >= 3 ? "text-right" : "text-left"} ${h === "RATING" ? "!text-center" : ""}`}
                              style={{ color: C.textS }}
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
                        {displayedProducts.slice(0, 5).map((p, i) => {
                          const rank = i + 1;
                          const badge =
                            rank === 1
                              ? {
                                  bg: "var(--color-warning-subtle)",
                                  color: "var(--color-chart-gold)",
                                }
                              : rank === 2
                                ? {
                                    bg: "var(--color-surface-muted)",
                                    color: "var(--color-chart-silver)",
                                  }
                                : rank === 3
                                  ? {
                                      bg: "var(--color-accent-subtle)",
                                      color: "var(--color-chart-bronze)",
                                    }
                                  : null;
                          return (
                            <tr
                              key={p.id}
                              className="product-row"
                              style={{ borderTop: `1px solid ${C.border}` }}
                            >
                                                                               
                                       {" "}
                              <td className="px-4 py-3">
                                                                               
                                               {" "}
                                {badge ? (
                                  <span
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
                                    style={{
                                      background: badge.bg,
                                      color: badge.color,
                                    }}
                                  >
                                    {rank}
                                  </span>
                                ) : (
                                  <span
                                    className="px-2 font-semibold"
                                    style={{ color: C.textS }}
                                  >
                                    {rank}
                                  </span>
                                )}
                                                                               
                                           {" "}
                              </td>
                                                                               
                                       {" "}
                              <td className="px-4 py-3">
                                                                               
                                               {" "}
                                <div className="flex items-center gap-3">
                                                                               
                                                       {" "}
                                  <ProductThumb
                                    src={p.image}
                                    alt={p.title}
                                    size={40}
                                  />
                                                                               
                                                       {" "}
                                  <span
                                    className="font-semibold"
                                    style={{ color: C.textP, fontSize: "15px" }}
                                  >
                                    {p.title}
                                  </span>
                                                                               
                                                   {" "}
                                </div>
                                                                               
                                           {" "}
                              </td>
                                                                               
                                       {" "}
                              <td
                                className="px-4 py-3"
                                style={{ color: C.textS }}
                              >
                                {p.category}
                              </td>
                                                                               
                                       {" "}
                              <td
                                className="px-4 py-3 text-right"
                                style={{ fontFamily: MONO, color: C.textP }}
                              >
                                {formatINR(p.revenue)}
                              </td>
                                                                               
                                       {" "}
                              <td
                                className="px-4 py-3 text-right"
                                style={{ color: C.textS }}
                              >
                                {formatNum(p.orders)}
                              </td>
                                                                               
                                       {" "}
                              <td
                                className="px-4 py-3 text-right"
                                style={{ color: C.textS }}
                              >
                                {formatNum(p.units)}
                              </td>
                                                                               
                                       {" "}
                              <td className="px-4 py-3 text-center">
                                                                               
                                               {" "}
                                {p.rating ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Star
                                      size={13}
                                      style={{ color: "var(--color-accent)" }}
                                      fill="var(--color-accent)"
                                    />
                                    {p.rating.toFixed(1)}
                                  </span>
                                ) : (
                                  <span style={{ color: C.textS }}>—</span>
                                )}
                                                                               
                                           {" "}
                              </td>
                                                                               
                                       {" "}
                              <td
                                className="px-4 py-3 text-right font-bold"
                                style={{
                                  color: p.growth >= 0 ? C.indigo : C.red,
                                }}
                              >
                                {p.growth >= 0 ? "+" : ""}
                                {Math.round(p.growth)}%
                              </td>
                                                                               
                                   {" "}
                            </tr>
                          );
                        })}
                                                                       {" "}
                        {displayedProducts.length === 0 && (
                          <tr>
                            <td
                              colSpan={8}
                              className="px-4 py-8 text-center"
                              style={{ color: C.textS }}
                            >
                              No products match your filters.
                            </td>
                          </tr>
                        )}
                                                                   {" "}
                      </tbody>
                                                             {" "}
                    </table>
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                           {" "}
              </>
            )}
                                   {" "}
            {/* ============ ANALYTICS VIEW ============ */}                   
               {" "}
            {activeTab === "analytics" && (
              <>
                                                {/* CATEGORY PERFORMANCE */}   
                                           {" "}
                <div className="mb-8">
                                                     {" "}
                  <h3
                    className="font-semibold mb-1"
                    style={{ fontSize: "20px", color: C.textP }}
                  >
                    Category Performance
                  </h3>
                                                     {" "}
                  <p className="mb-4 text-sm" style={{ color: C.textS }}>
                    High-level distribution across core segments
                  </p>
                                                     {" "}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                                                           {" "}
                    {categoryData.map((cat) => {
                      const cs = catStyle(cat.name);
                      const Icon = cs.Icon;
                      const pos = cat.growth >= 0;
                      return (
                        <div
                          key={cat.name}
                          className="insight-card rounded-xl p-4 flex flex-col gap-2"
                          style={{
                            background: C.pageBg,
                            border: `1px solid ${C.border}`,
                          }}
                        >
                                                                             {" "}
                          <div className="flex items-center justify-between">
                                                                               
                               {" "}
                            <span
                              className="flex items-center justify-center rounded-lg p-2"
                              style={{ background: cs.bg }}
                            >
                              <Icon size={18} style={{ color: cs.icon }} />
                            </span>
                                                                               
                               {" "}
                            <span
                              className="text-xs font-semibold px-2 py-0.5 rounded"
                              style={{
                                background: pos
                                  ? "color-mix(in srgb, var(--color-accent-subtle) 50%, transparent)"
                                  : "color-mix(in srgb, var(--color-error-subtle) 40%, transparent)",
                                color: pos ? C.indigo : C.red,
                              }}
                            >
                              {pos ? "+" : ""}
                              {cat.growth}%
                            </span>
                                                                             
                             {" "}
                          </div>
                                                                             {" "}
                          <span
                            className="capitalize"
                            style={{ fontSize: "16px", color: C.textP }}
                          >
                            {cat.name}
                          </span>
                                                                             {" "}
                          <div className="flex flex-col gap-1 pt-2">
                                                                               
                               {" "}
                            <Row
                              label="Revenue"
                              value={formatINR(cat.revenue)}
                            />
                                                                               
                               {" "}
                            <Row label="Orders" value={formatNum(cat.orders)} />
                                                                               
                               {" "}
                            <Row
                              label="Products"
                              value={formatNum(cat.products)}
                            />
                                                                             
                             {" "}
                          </div>
                                                                         {" "}
                        </div>
                      );
                    })}
                                                           {" "}
                    {categoryData.length === 0 && (
                      <p className="text-sm" style={{ color: C.textS }}>
                        No category data.
                      </p>
                    )}
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                                {/* PRODUCT CATALOG */}         
                                     {" "}
                <div className="flex items-end justify-between mb-4">
                                                     {" "}
                  <div>
                                                           {" "}
                    <h3
                      className="font-semibold"
                      style={{ fontSize: "24px", color: C.textP }}
                    >
                      Product Analytics
                    </h3>
                                                           {" "}
                    <p className="text-sm" style={{ color: C.textS }}>
                      Granular performance tracking by individual SKU
                    </p>
                                                       {" "}
                  </div>
                                                     {" "}
                  <div
                    className="flex rounded-lg overflow-hidden"
                    style={{
                      background: "var(--color-surface-muted)",
                      border: `1px solid ${C.border}`,
                    }}
                  >
                                                           {" "}
                    {["grid", "list"].map((m) => (
                      <button
                        key={m}
                        onClick={() => setViewMode(m)}
                        className="px-4 py-1.5 text-sm font-medium capitalize"
                        style={
                          viewMode === m
                            ? {
                                background: C.indigo,
                                color: "var(--color-inverse)",
                              }
                            : { color: C.textS }
                        }
                      >
                        {m}
                      </button>
                    ))}
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                               {" "}
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                                                           {" "}
                    {displayedProducts.slice(0, 12).map((p) => {
                      const cs = catStyle(p.category);
                      return (
                        <div
                          key={p.id}
                          className="product-row rounded-xl overflow-hidden"
                          style={{
                            background: C.pageBg,
                            border: `1px solid ${C.border}`,
                          }}
                        >
                                                                             {" "}
                          <div className="relative" style={{ height: "192px" }}>
                                                                               
                               {" "}
                            <ProductThumb src={p.image} alt={p.title} fill />   
                                                                               {" "}
                            <span
                              className="absolute top-2 left-2 text-xs font-semibold text-inverse rounded px-2 py-0.5 capitalize"
                              style={{
                                background:
                                  cs.bg === "var(--color-info-subtle)"
                                    ? C.textS
                                    : cs.bg,
                              }}
                            >
                              {p.category}
                            </span>
                                                                               
                               {" "}
                            {p.rating > 0 && (
                              <span
                                className="absolute top-2 right-2 flex items-center gap-1 text-xs font-semibold rounded px-2 py-0.5"
                                style={{
                                  background:
                                    "color-mix(in srgb, var(--color-background) 90%, transparent)",
                                  backdropFilter: "blur(2px)",
                                  color: C.textP,
                                }}
                              >
                                                                               
                                               {" "}
                                <Star
                                  size={11}
                                  style={{ color: "var(--color-accent)" }}
                                  fill="var(--color-accent)"
                                />
                                {p.rating.toFixed(1)}                           
                                                               {" "}
                              </span>
                            )}
                                                                             
                             {" "}
                          </div>
                                                                             {" "}
                          <div className="p-4 flex flex-col gap-3">
                                                                               
                               {" "}
                            <div>
                                                                               
                                       {" "}
                              <p
                                className="font-semibold leading-tight"
                                style={{
                                  fontSize: "16px",
                                  color: C.textP,
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                  overflow: "hidden",
                                }}
                              >
                                {p.title}
                              </p>
                                                                               
                                       {" "}
                              <p
                                className="text-xs mt-1 capitalize"
                                style={{ color: C.textS }}
                              >
                                {p.category}
                              </p>
                                                                               
                                   {" "}
                            </div>
                                                                               
                               {" "}
                            <div className="flex items-center justify-between">
                                                                               
                                       {" "}
                              <span
                                className="font-bold"
                                style={{ fontSize: "18px", color: C.indigo }}
                              >
                                {formatINR(p.price || p.revenue)}
                              </span>
                                                                               
                                       {" "}
                              <span
                                className="text-xs font-bold"
                                style={{
                                  color: p.growth >= 0 ? C.indigo : C.red,
                                }}
                              >
                                {p.growth >= 0 ? "+" : ""}
                                {Math.round(p.growth)}%
                              </span>
                                                                               
                                   {" "}
                            </div>
                                                                               
                               {" "}
                            <div
                              className="grid grid-cols-2 gap-2 rounded-lg p-2"
                              style={{ background: C.sidebarBg }}
                            >
                                                                               
                                       {" "}
                              <div>
                                <p
                                  className="text-xs"
                                  style={{ color: C.textS }}
                                >
                                  Orders
                                </p>
                                <p
                                  className="font-bold"
                                  style={{ color: C.textP }}
                                >
                                  {formatNum(p.orders)}
                                </p>
                              </div>
                                                                               
                                       {" "}
                              <div>
                                <p
                                  className="text-xs"
                                  style={{ color: C.textS }}
                                >
                                  Units Sold
                                </p>
                                <p
                                  className="font-bold"
                                  style={{ color: C.textP }}
                                >
                                  {formatNum(p.units)}
                                </p>
                              </div>
                                                                               
                                   {" "}
                            </div>
                                                                               
                               {" "}
                            <button
                              onClick={() => openProductAnalytics(p)}
                              className="w-full flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-bold"
                              style={{
                                background: "var(--color-info-subtle)",
                                color: C.textP,
                              }}
                            >
                              View Analytics <ArrowRight size={14} />
                            </button>
                                                                             
                             {" "}
                          </div>
                                                                         {" "}
                        </div>
                      );
                    })}
                                                       {" "}
                  </div>
                ) : (
                  <div
                    className="bg-surface rounded-xl overflow-hidden"
                    style={{ border: `1px solid ${C.border}` }}
                  >
                                                           {" "}
                    {displayedProducts.slice(0, 12).map((p, i) => (
                      <div
                        key={p.id}
                        className="product-row flex items-center gap-4 px-4 py-3"
                        style={{
                          borderTop: i ? `1px solid ${C.border}` : "none",
                        }}
                      >
                                                                       {" "}
                        <ProductThumb
                          src={p.image}
                          alt={p.title}
                          size={40}
                          radius={8}
                        />
                                                                       {" "}
                        <div className="flex-1 min-w-0">
                          <p
                            className="font-semibold truncate"
                            style={{ color: C.textP }}
                          >
                            {p.title}
                          </p>
                          <p
                            className="text-xs capitalize"
                            style={{ color: C.textS }}
                          >
                            {p.category}
                          </p>
                        </div>
                                                                       {" "}
                        <span
                          className="font-bold w-28 text-right"
                          style={{ fontFamily: MONO, color: C.textP }}
                        >
                          {formatINR(p.revenue)}
                        </span>
                                                                       {" "}
                        <span
                          className="w-20 text-right text-sm"
                          style={{ color: C.textS }}
                        >
                          {formatNum(p.orders)} ord
                        </span>
                                                                       {" "}
                        <span
                          className="w-16 text-right font-bold"
                          style={{ color: p.growth >= 0 ? C.indigo : C.red }}
                        >
                          {p.growth >= 0 ? "+" : ""}
                          {Math.round(p.growth)}%
                        </span>
                                                                   {" "}
                      </div>
                    ))}
                                                           {" "}
                    {displayedProducts.length === 0 && (
                      <p
                        className="px-4 py-8 text-center text-sm"
                        style={{ color: C.textS }}
                      >
                        No products found.
                      </p>
                    )}
                                                       {" "}
                  </div>
                )}
                                           {" "}
              </>
            )}
                                   {" "}
            {/* ============ INVENTORY VIEW ============ */}                   
               {" "}
            {activeTab === "inventory" && (
              <>
                                               {" "}
                <div className="mb-6">
                                                     {" "}
                  <h3
                    className="font-semibold"
                    style={{ fontSize: "20px", color: C.textP }}
                  >
                    Inventory Overview
                  </h3>
                                                     {" "}
                  <p className="text-sm" style={{ color: C.textS }}>
                    Stock levels vs units sold across all SKUs
                  </p>
                                                 {" "}
                </div>
                                               {" "}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                                     {" "}
                  <KpiCard
                    icon={<Layers size={18} style={{ color: C.indigo }} />}
                    label="Total SKUs"
                    value={formatNum(inventoryStats.skus)}
                    neutral
                    neutralLabel="Catalog"
                  />
                                                     {" "}
                  <KpiCard
                    icon={
                      <CheckCircle2 size={18} style={{ color: C.indigo }} />
                    }
                    label="In Stock"
                    value={formatNum(inventoryStats.inStock)}
                    neutral
                    neutralLabel="Healthy"
                  />
                                                     {" "}
                  <KpiCard
                    icon={
                      <AlertTriangle size={18} style={{ color: C.indigo }} />
                    }
                    label="Low Stock"
                    value={formatNum(inventoryStats.lowStock)}
                    neutral
                    neutralLabel={`≤ ${LOW_STOCK}`}
                  />
                                                     {" "}
                  <KpiCard
                    icon={<XCircle size={18} style={{ color: C.indigo }} />}
                    label="Out of Stock"
                    value={formatNum(inventoryStats.outStock)}
                    neutral
                    neutralLabel="Reorder"
                  />
                                                 {" "}
                </div>
                                               {" "}
                <div
                  className="bg-surface rounded-xl overflow-hidden"
                  style={{ border: `1px solid ${C.border}` }}
                >
                                                     {" "}
                  <div
                    className="flex items-center justify-between px-6 py-4"
                    style={{
                      background: C.sidebarBg,
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                                                           {" "}
                    <h4
                      className="font-semibold"
                      style={{ fontSize: "18px", color: C.textP }}
                    >
                      Stock Levels
                    </h4>
                                                           {" "}
                    <span className="text-sm" style={{ color: C.textS }}>
                      {displayedInventory.length} products
                    </span>
                                                       {" "}
                  </div>
                                                     {" "}
                  <div className="overflow-x-auto">
                                                           {" "}
                    <table className="w-full text-sm">
                                                                 {" "}
                      <thead>
                                                                       {" "}
                        <tr
                          style={{
                            background: C.sidebarBg,
                            borderBottom: `1px solid ${C.border}`,
                          }}
                        >
                                                                             {" "}
                          {INVENTORY_COLUMNS.map((col) => {
                            const active = invSort.key === col.key;
                            const justify =
                              col.align === "right"
                                ? "justify-end"
                                : col.align === "center"
                                  ? "justify-center"
                                  : "";
                            return (
                              <th
                                key={col.key}
                                onClick={() => toggleInvSort(col.key)}
                                className={`px-4 py-3 text-xs font-semibold cursor-pointer select-none ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}`}
                                style={{ color: active ? C.indigo : C.textS }}
                              >
                                                                               
                                               {" "}
                                <span
                                  className={`inline-flex items-center gap-1 ${justify}`}
                                >
                                                                               
                                                        {col.label}             
                                                                               
                                         {" "}
                                  {active ? (
                                    invSort.dir === "asc" ? (
                                      <ArrowUp size={12} />
                                    ) : (
                                      <ArrowDown size={12} />
                                    )
                                  ) : (
                                    <ArrowUpDown
                                      size={11}
                                      style={{ opacity: 0.35 }}
                                    />
                                  )}
                                                                               
                                                   {" "}
                                </span>
                                                                               
                                           {" "}
                              </th>
                            );
                          })}
                                                                         {" "}
                        </tr>
                                                                   {" "}
                      </thead>
                                                                 {" "}
                      <tbody>
                                                                       {" "}
                        {displayedInventory.slice(0, 30).map((c, i) => {
                          const st = stockStatus(c.stock);
                          const badge =
                            st === "in"
                              ? {
                                  t: "In Stock",
                                  bg: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                                  col: C.indigo,
                                }
                              : st === "low"
                                ? {
                                    t: "Low Stock",
                                    bg: "var(--color-warning-subtle)",
                                    col: "var(--color-warning)",
                                  }
                                : {
                                    t: "Out of Stock",
                                    bg: "color-mix(in srgb, var(--color-error) 10%, transparent)",
                                    col: C.red,
                                  };
                          return (
                            <tr
                              key={c.id}
                              className="product-row"
                              style={{ borderTop: `1px solid ${C.border}` }}
                            >
                                                                               
                                       {" "}
                              <td className="px-4 py-3">
                                                                               
                                               {" "}
                                <div className="flex items-center gap-3">
                                                                               
                                                       {" "}
                                  <ProductThumb
                                    src={c.image}
                                    alt={c.title}
                                    size={40}
                                  />
                                                                               
                                                       {" "}
                                  <span
                                    className="font-semibold"
                                    style={{ color: C.textP }}
                                  >
                                    {c.title}
                                  </span>
                                                                               
                                                   {" "}
                                </div>
                                                                               
                                           {" "}
                              </td>
                                                                               
                                       {" "}
                              <td
                                className="px-4 py-3 capitalize"
                                style={{ color: C.textS }}
                              >
                                {c.category}
                              </td>
                                                                               
                                       {" "}
                              <td
                                className="px-4 py-3 text-right font-bold"
                                style={{
                                  fontFamily: MONO,
                                  color: st === "out" ? C.red : C.textP,
                                }}
                              >
                                {formatNum(c.stock)}
                              </td>
                                                                               
                                       {" "}
                              <td
                                className="px-4 py-3 text-right"
                                style={{ color: C.textS }}
                              >
                                {formatNum(c.unitsSold)}
                              </td>
                                                                               
                                       {" "}
                              <td
                                className="px-4 py-3 text-right"
                                style={{ color: C.textS }}
                              >
                                {formatNum(c.ordersCount)}
                              </td>
                                                                               
                                       {" "}
                              <td
                                className="px-4 py-3 text-right"
                                style={{ fontFamily: MONO, color: C.textP }}
                              >
                                {formatINR(c.revenue)}
                              </td>
                                                                               
                                       {" "}
                              <td className="px-4 py-3 text-center">
                                <span
                                  className="text-xs font-semibold rounded px-2 py-1"
                                  style={{
                                    background: badge.bg,
                                    color: badge.col,
                                  }}
                                >
                                  {badge.t}
                                </span>
                              </td>
                                                                               
                                   {" "}
                            </tr>
                          );
                        })}
                                                                       {" "}
                        {displayedInventory.length === 0 && (
                          <tr>
                            <td
                              colSpan={7}
                              className="px-4 py-8 text-center"
                              style={{ color: C.textS }}
                            >
                              No inventory data. Ensure the /products collection
                              has stock fields.
                            </td>
                          </tr>
                        )}
                                                                   {" "}
                      </tbody>
                                                             {" "}
                    </table>
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                           {" "}
              </>
            )}
                                   {" "}
            {/* ============ REPORTS VIEW ============ */}                     
             {" "}
            {activeTab === "reports" && (
              <>
                                               {" "}
                <div className="flex items-center justify-between mb-6">
                                                     {" "}
                  <div>
                                                           {" "}
                    <h3
                      className="font-semibold"
                      style={{ fontSize: "20px", color: C.textP }}
                    >
                      Performance Report
                    </h3>
                                                           {" "}
                    <p className="text-sm" style={{ color: C.textS }}>
                      Summary for {periodLabel}
                    </p>
                                                       {" "}
                  </div>
                                                     {" "}
                  <button
                    onClick={downloadReportPDF}
                    className="flex items-center gap-2 rounded-lg px-4 text-sm font-semibold text-inverse"
                    style={{ background: C.indigo, height: "40px" }}
                  >
                                                           {" "}
                    <FileDown size={16} /> Download Report                      
                                 {" "}
                  </button>
                                                 {" "}
                </div>
                                                {/* Summary metrics */}         
                                     {" "}
                <div
                  className="bg-surface rounded-xl p-6 mb-6"
                  style={{ border: `1px solid ${C.border}` }}
                >
                                                     {" "}
                  <h4
                    className="font-semibold mb-4"
                    style={{ fontSize: "16px", color: C.textP }}
                  >
                    Key Metrics
                  </h4>
                                                     {" "}
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                                                           {" "}
                    {[
                      { l: "Revenue", v: formatINR(revenue) },
                      { l: "Orders", v: formatNum(orders) },
                      { l: "Customers", v: formatNum(customers) },
                      { l: "AOV", v: formatINR(aov) },
                      { l: "Products Sold", v: formatNum(productsSold) },
                      { l: "Active Products", v: formatNum(activeProducts) },
                    ].map((s) => (
                      <div
                        key={s.l}
                        className="rounded-lg p-3"
                        style={{ background: C.sidebarBg }}
                      >
                                                                       {" "}
                        <p className="text-xs" style={{ color: C.textS }}>
                          {s.l}
                        </p>
                                                                       {" "}
                        <p
                          className="font-bold"
                          style={{ fontSize: "18px", color: C.textP }}
                        >
                          {s.v}
                        </p>
                                                                   {" "}
                      </div>
                    ))}
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                               {" "}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                      {/* Top performers */}   
                                                 {" "}
                  <div
                    className="bg-surface rounded-xl p-6"
                    style={{ border: `1px solid ${C.border}` }}
                  >
                                                           {" "}
                    <h4
                      className="font-semibold mb-4"
                      style={{ fontSize: "16px", color: C.textP }}
                    >
                      Top 5 Products by Revenue
                    </h4>
                                                           {" "}
                    <div className="flex flex-col gap-3">
                                                                 {" "}
                      {displayedProducts.slice(0, 5).map((p, i) => (
                        <div key={p.id} className="flex items-center gap-3">
                                                                             {" "}
                          <span
                            className="w-6 text-sm font-bold"
                            style={{ color: C.indigo }}
                          >
                            {i + 1}
                          </span>
                                                                             {" "}
                          <span
                            className="flex-1 truncate text-sm"
                            style={{ color: C.textP }}
                          >
                            {p.title}
                          </span>
                                                                             {" "}
                          <span
                            className="text-sm font-bold"
                            style={{ fontFamily: MONO, color: C.textP }}
                          >
                            {formatINR(p.revenue)}
                          </span>
                                                                         {" "}
                        </div>
                      ))}
                                                                 {" "}
                      {displayedProducts.length === 0 && (
                        <p className="text-sm" style={{ color: C.textS }}>
                          No data for this period.
                        </p>
                      )}
                                                             {" "}
                    </div>
                                                       {" "}
                  </div>
                                                      {/* Category breakdown */}
                                                     {" "}
                  <div
                    className="bg-surface rounded-xl p-6"
                    style={{ border: `1px solid ${C.border}` }}
                  >
                                                           {" "}
                    <h4
                      className="font-semibold mb-4"
                      style={{ fontSize: "16px", color: C.textP }}
                    >
                      Revenue by Category
                    </h4>
                                                           {" "}
                    <div className="flex flex-col gap-3">
                                                                 {" "}
                      {categoryData.map((c) => (
                        <div key={c.name}>
                                                                             {" "}
                          <div className="flex items-center justify-between text-sm mb-1">
                                                                               
                               {" "}
                            <span
                              className="capitalize"
                              style={{ color: C.textP }}
                            >
                              {c.name}
                            </span>
                                                                               
                               {" "}
                            <span
                              className="font-bold"
                              style={{ color: C.textP }}
                            >
                              {formatINR(c.revenue)}
                            </span>
                                                                             
                             {" "}
                          </div>
                                                                             {" "}
                          <div
                            className="rounded-full overflow-hidden"
                            style={{
                              height: "6px",
                              background: "var(--color-surface-muted)",
                            }}
                          >
                                                                               
                               {" "}
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${categoryData[0]?.revenue ? (c.revenue / categoryData[0].revenue) * 100 : 0}%`,
                                background: C.activeNav,
                              }}
                            />
                                                                             
                             {" "}
                          </div>
                                                                         {" "}
                        </div>
                      ))}
                                                                 {" "}
                      {categoryData.length === 0 && (
                        <p className="text-sm" style={{ color: C.textS }}>
                          No category data.
                        </p>
                      )}
                                                             {" "}
                    </div>
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                           {" "}
              </>
            )}
                               {" "}
          </div>
        )}
                   {" "}
      </div>
                 {" "}
      {/* ============================== MOBILE (< md) ============================== */}
                 {" "}
      {/* pt clears the global floating navbar (it has no spacer on mobile) */} 
               {" "}
      <div
        className="md:hidden min-h-screen"
        style={{ background: C.pageBg, paddingTop: "92px" }}
      >
                        {/* Tab pills */}               {" "}
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 pt-3">
                             {" "}
          {[
            { k: "dashboard", l: "Dashboard" },
            { k: "analytics", l: "Analytics" },
            { k: "inventory", l: "Inventory" },
            { k: "reports", l: "Reports" },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setActiveTab(t.k)}
              className="flex-shrink-0 rounded-full text-sm font-semibold"
              style={
                activeTab === t.k
                  ? {
                      background: C.indigo,
                      color: "var(--color-inverse)",
                      padding: "6px 16px",
                    }
                  : {
                      background: "var(--color-surface)",
                      color: C.textS,
                      border: `1px solid ${C.border}`,
                      padding: "5px 16px",
                    }
              }
            >
                                          {t.l}                       {" "}
            </button>
          ))}
                         {" "}
        </div>
                        {/* Time range pills */}               {" "}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar px-4 pt-3">
                             {" "}
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="flex-shrink-0 rounded-full text-xs font-medium"
              style={
                filter === f.key
                  ? {
                      background: C.activeNav,
                      color: "var(--color-inverse)",
                      padding: "4px 12px",
                    }
                  : {
                      background: "var(--color-surface)",
                      color: C.textS,
                      border: `1px solid ${C.border}`,
                      padding: "3px 12px",
                    }
              }
            >
                                          {f.label}                       {" "}
            </button>
          ))}
                         {" "}
        </div>
                       {" "}
        {filter === "custom" && (
          <div className="flex items-center gap-2 px-4 pt-2">
                                   {" "}
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              max={customTo || undefined}
              className="flex-1 outline-none rounded-xl text-sm bg-surface px-3 py-2"
              style={{ border: `1px solid ${C.border}` }}
            />
                                   {" "}
            <span className="text-xs" style={{ color: C.textS }}>
              to
            </span>
                                   {" "}
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              min={customFrom || undefined}
              className="flex-1 outline-none rounded-xl text-sm bg-surface px-3 py-2"
              style={{ border: `1px solid ${C.border}` }}
            />
                               {" "}
          </div>
        )}
                       {" "}
        {loading ? (
          (() => {
            const bar = (style) => (
              <div
                aria-hidden="true"
                className="animate-pulse"
                style={{
                  background: "var(--color-surface-muted)",
                  borderRadius: "6px",
                  ...style,
                }}
              />
            );
            return (
              <div className="px-4 py-4" aria-busy="true">
                                               {" "}
                <div className="flex flex-col gap-2 mb-4">
                  {bar({ width: "180px", height: "26px" })}
                  {bar({ width: "240px", height: "13px" })}
                </div>
                                                {/* KPI grid */}               
                               {" "}
                <div className="grid grid-cols-2 gap-3 mb-5">
                                                     {" "}
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="rounded-2xl bg-surface p-4 flex flex-col gap-2"
                      style={{ border: `1px solid ${C.border}` }}
                    >
                                                                 {" "}
                      {bar({
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                      })}
                                                                 {" "}
                      {bar({ width: "60%", height: "11px" })}                   
                                             {" "}
                      {bar({ width: "70%", height: "20px" })}                   
                                         {" "}
                    </div>
                  ))}
                                                 {" "}
                </div>
                                                {/* Chart cards */}             
                                 {" "}
                {[...Array(2)].map((_, i) => (
                  <div
                    key={i}
                    className="rounded-2xl bg-surface p-4 mb-4"
                    style={{ border: `1px solid ${C.border}` }}
                  >
                                                           {" "}
                    <div className="flex items-center justify-between mb-3">
                      {bar({ width: "150px", height: "18px" })}
                      {bar({ width: "40px", height: "18px" })}
                    </div>
                                                           {" "}
                    {bar({
                      width: "100%",
                      height: "180px",
                      borderRadius: "12px",
                    })}
                                                       {" "}
                  </div>
                ))}
                                           {" "}
              </div>
            );
          })()
        ) : (
          <div className="px-4 py-4">
                                    {/* ---------- DASHBOARD ---------- */}     
                             {" "}
            {activeTab === "dashboard" && (
              <>
                                               {" "}
                <h2
                  className="font-bold"
                  style={{ fontSize: "26px", color: C.textP }}
                >
                  Hello, Admin
                </h2>
                                               {" "}
                <p className="text-sm mb-4" style={{ color: C.textS }}>
                  Here's what's happening with your sales today.
                </p>
                                               {" "}
                <div className="grid grid-cols-2 gap-3 mb-5">
                                                     {" "}
                  <MobKpi
                    icon={<IndianRupee size={18} style={{ color: C.indigo }} />}
                    label="Revenue"
                    value={formatINR(revenue)}
                    t={trends.revenue}
                  />
                                                     {" "}
                  <MobKpi
                    icon={<ShoppingBag size={18} style={{ color: C.indigo }} />}
                    label="Orders"
                    value={formatNum(orders)}
                    t={trends.orders}
                  />
                                                     {" "}
                  <MobKpi
                    icon={<Users size={18} style={{ color: C.indigo }} />}
                    label="Customers"
                    value={formatNum(customers)}
                    t={trends.customers}
                  />
                                                     {" "}
                  <MobKpi
                    icon={<Boxes size={18} style={{ color: C.indigo }} />}
                    label="Products Sold"
                    value={formatNum(productsSold)}
                    t={trends.productsSold}
                  />
                                                 {" "}
                </div>
                                                {/* Daily Revenue Trend */}     
                                         {" "}
                <div
                  className="rounded-2xl bg-surface p-4 mb-4"
                  style={{ border: `1px solid ${C.border}` }}
                >
                                                     {" "}
                  <div className="flex items-center justify-between mb-3">
                                                           {" "}
                    <h3
                      className="font-bold"
                      style={{ fontSize: "18px", color: C.textP }}
                    >
                      Daily Revenue Trend
                    </h3>
                                                           {" "}
                    <MoreVertical size={18} style={{ color: C.textS }} />       
                                               {" "}
                  </div>
                                                     {" "}
                  <div style={{ height: "180px" }}>
                                                           {" "}
                    <ResponsiveContainer width="100%" height="100%">
                                                                 {" "}
                      <BarChart data={chartData}>
                                                                       {" "}
                        <XAxis dataKey="date" hide />
                                                                       {" "}
                        <Tooltip
                          formatter={(v) => formatINR(v)}
                          cursor={{
                            fill: "color-mix(in srgb, var(--color-chart-1) 8%, transparent)",
                          }}
                        />
                                                                       {" "}
                        <Bar
                          dataKey="revenue"
                          fill="var(--color-chart-1)"
                          radius={[4, 4, 0, 0]}
                        />
                                                                   {" "}
                      </BarChart>
                                                             {" "}
                    </ResponsiveContainer>
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                                {/* Orders Trend */}           
                                   {" "}
                <div
                  className="rounded-2xl bg-surface p-4 mb-5"
                  style={{ border: `1px solid ${C.border}` }}
                >
                                                     {" "}
                  <div className="flex items-center justify-between mb-3">
                                                           {" "}
                    <h3
                      className="font-bold"
                      style={{ fontSize: "18px", color: C.textP }}
                    >
                      Orders Trend
                    </h3>
                                                           {" "}
                    <span
                      className="text-xs font-semibold px-2.5 py-1 rounded-full"
                      style={{
                        background: "var(--color-surface-muted)",
                        color: C.indigo,
                      }}
                    >
                      Top 5
                    </span>
                                                       {" "}
                  </div>
                                                     {" "}
                  <div className="flex flex-col gap-3">
                                                           {" "}
                    {ordersBarData.map((p) => (
                      <div key={p.id}>
                                                                       {" "}
                        <div className="flex justify-between text-sm mb-1">
                          <span
                            className="truncate pr-2"
                            style={{ color: C.textP }}
                          >
                            {p.title}
                          </span>
                          <span
                            className="font-semibold"
                            style={{ color: C.textP }}
                          >
                            {formatNum(p.orders)}
                          </span>
                        </div>
                                                                       {" "}
                        <div
                          className="rounded-full overflow-hidden"
                          style={{
                            height: "8px",
                            background: "var(--color-surface-muted)",
                          }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(p.orders / maxOrders) * 100}%`,
                              background: C.activeNav,
                            }}
                          />
                        </div>
                                                                   {" "}
                      </div>
                    ))}
                                                           {" "}
                    {ordersBarData.length === 0 && (
                      <p className="text-sm" style={{ color: C.textS }}>
                        No order data.
                      </p>
                    )}
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                                {/* Key Insights */}           
                                   {" "}
                <h3
                  className="font-bold mb-3"
                  style={{ fontSize: "18px", color: C.textP }}
                >
                  Key Insights
                </h3>
                                               {" "}
                <div className="grid grid-cols-1 gap-3 mb-5">
                                                     {" "}
                  <InsightCard
                    label="HIGHEST REVENUE"
                    labelColor={C.indigo}
                    highlight
                    product={insights.highest}
                    sub={
                      insights.highest
                        ? `${formatINR(insights.highest.revenue)} Total Revenue`
                        : "—"
                    }
                  />
                                                     {" "}
                  <InsightCard
                    label="MOST ORDERED"
                    labelColor={C.textS}
                    product={insights.mostOrdered}
                    sub={
                      insights.mostOrdered
                        ? `${formatNum(insights.mostOrdered.orders)} Orders`
                        : "—"
                    }
                  />
                                                     {" "}
                  <InsightCard
                    label="FASTEST GROWING"
                    labelColor={C.indigo}
                    product={insights.fastestGrowing}
                    badge={
                      insights.fastestGrowing
                        ? {
                            text: `+${Math.abs(Math.round(insights.fastestGrowing.growth))}%`,
                            bg: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                            color: C.indigo,
                          }
                        : null
                    }
                  />
                                                     {" "}
                  <InsightCard
                    label="LOWEST PERFORMING"
                    labelColor={C.red}
                    product={insights.lowest}
                    badge={
                      insights.lowest
                        ? {
                            text: formatINR(insights.lowest.revenue),
                            bg: "color-mix(in srgb, var(--color-error) 10%, transparent)",
                            color: C.red,
                          }
                        : null
                    }
                  />
                                                 {" "}
                </div>
                                                {/* Top Products */}           
                                   {" "}
                <div className="flex items-center justify-between mb-3">
                                                     {" "}
                  <h3
                    className="font-bold"
                    style={{ fontSize: "18px", color: C.textP }}
                  >
                    Top Products
                  </h3>
                                                     {" "}
                  <button
                    onClick={() => setActiveTab("analytics")}
                    className="text-sm font-semibold"
                    style={{ color: C.indigo }}
                  >
                    View All
                  </button>
                                                 {" "}
                </div>
                                               {" "}
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                                                     {" "}
                  {displayedProducts.slice(0, 8).map((p) => (
                    <div
                      key={p.id}
                      className="flex-shrink-0 rounded-2xl bg-surface overflow-hidden"
                      style={{
                        width: "160px",
                        border: `1px solid ${C.border}`,
                      }}
                    >
                                                                 {" "}
                      <div style={{ height: "110px" }}>
                        <ProductThumb src={p.image} alt={p.title} fill />
                      </div>
                                                                 {" "}
                      <div className="p-3">
                                                                       {" "}
                        <p
                          className="font-semibold truncate"
                          style={{ fontSize: "15px", color: C.textP }}
                        >
                          {p.title}
                        </p>
                                                                       {" "}
                        <p className="text-sm">
                          <span
                            className="font-bold"
                            style={{ color: C.textP }}
                          >
                            {formatINR(p.price || p.revenue)}
                          </span>{" "}
                          <span
                            className="font-bold"
                            style={{ color: p.growth >= 0 ? C.indigo : C.red }}
                          >
                            {p.growth >= 0 ? "+" : ""}
                            {Math.round(p.growth)}%
                          </span>
                        </p>
                                                                   {" "}
                      </div>
                                                             {" "}
                    </div>
                  ))}
                                                     {" "}
                  {displayedProducts.length === 0 && (
                    <p className="text-sm" style={{ color: C.textS }}>
                      No products.
                    </p>
                  )}
                                                 {" "}
                </div>
                                           {" "}
              </>
            )}
                                    {/* ---------- ANALYTICS ---------- */}     
                             {" "}
            {activeTab === "analytics" && (
              <>
                                               {" "}
                <h2
                  className="font-bold"
                  style={{ fontSize: "22px", color: C.textP }}
                >
                  Product Catalog
                </h2>
                                               {" "}
                <p className="text-sm mb-4" style={{ color: C.textS }}>
                  Real-time inventory and performance metrics.
                </p>
                                               {" "}
                <div className="flex items-center justify-between mb-2">
                                                     {" "}
                  <span
                    className="text-xs font-bold uppercase tracking-wide"
                    style={{ color: C.textS }}
                  >
                    Performance by Category
                  </span>
                                                     {" "}
                  <span
                    className="text-sm font-semibold"
                    style={{ color: C.indigo }}
                  >
                    View All
                  </span>
                                                 {" "}
                </div>
                                               {" "}
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 mb-5">
                                                     {" "}
                  {categoryData.map((cat) => {
                    const cs = catStyle(cat.name);
                    const Icon = cs.Icon;
                    const pos = cat.growth >= 0;
                    return (
                      <div
                        key={cat.name}
                        className="flex-shrink-0 rounded-2xl p-4"
                        style={{
                          width: "200px",
                          background: "var(--color-surface)",
                          border: `1px solid ${C.border}`,
                        }}
                      >
                                                                       {" "}
                        <div className="flex items-center justify-between mb-3">
                                                                             {" "}
                          <span
                            className="flex items-center justify-center rounded-lg p-2"
                            style={{ background: cs.bg }}
                          >
                            <Icon size={18} style={{ color: cs.icon }} />
                          </span>
                                                                             {" "}
                          <span
                            className="text-xs font-semibold"
                            style={{ color: pos ? C.indigo : C.red }}
                          >
                            {pos ? "+" : ""}
                            {cat.growth}%
                          </span>
                                                                         {" "}
                        </div>
                                                                       {" "}
                        <p
                          className="capitalize text-sm"
                          style={{ color: C.textS }}
                        >
                          {cat.name}
                        </p>
                                                                       {" "}
                        <p
                          className="font-bold"
                          style={{ fontSize: "24px", color: C.textP }}
                        >
                          {formatINR(cat.revenue)}
                        </p>
                                                                   {" "}
                      </div>
                    );
                  })}
                                                     {" "}
                  {categoryData.length === 0 && (
                    <p className="text-sm" style={{ color: C.textS }}>
                      No category data.
                    </p>
                  )}
                                                 {" "}
                </div>
                                               {" "}
                <div className="flex items-center justify-between mb-3">
                                                     {" "}
                  <h3
                    className="font-bold"
                    style={{ fontSize: "18px", color: C.textP }}
                  >
                    Catalog
                  </h3>
                                                     {" "}
                  <span
                    className="flex items-center gap-1 text-sm font-semibold"
                    style={{ color: C.indigo }}
                  >
                    <SlidersHorizontal size={14} /> Filter
                  </span>
                                                 {" "}
                </div>
                                               {" "}
                <div className="relative mb-3">
                                                     {" "}
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: "var(--color-muted)" }}
                  />
                                                     {" "}
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search products..."
                    className="w-full outline-none rounded-xl text-sm bg-surface"
                    style={{
                      border: `1px solid ${C.border}`,
                      padding: "10px 12px 10px 34px",
                    }}
                  />
                                                 {" "}
                </div>
                                               {" "}
                <div className="flex flex-col gap-3">
                                                     {" "}
                  {displayedProducts.slice(0, 20).map((p) => (
                    <div
                      key={p.id}
                      onClick={() => openProductAnalytics(p)}
                      className="flex items-center gap-3 rounded-2xl bg-surface p-3 cursor-pointer"
                      style={{ border: `1px solid ${C.border}` }}
                    >
                                                                 {" "}
                      <ProductThumb
                        src={p.image}
                        alt={p.title}
                        size={64}
                        radius={8}
                      />
                                                                 {" "}
                      <div className="flex-1 min-w-0">
                                                                       {" "}
                        <p
                          className="text-xs font-semibold"
                          style={{ fontFamily: MONO, color: C.indigo }}
                        >
                          SKU: {String(p.id).slice(0, 8).toUpperCase()}
                        </p>
                                                                       {" "}
                        <p
                          className="font-bold truncate"
                          style={{ color: C.textP }}
                        >
                          {p.title}
                        </p>
                                                                       {" "}
                        <p
                          className="font-bold"
                          style={{ fontSize: "15px", color: C.textP }}
                        >
                          {formatINR(p.price || p.revenue)}{" "}
                          <span
                            className="text-xs font-bold"
                            style={{ color: p.growth >= 0 ? C.indigo : C.red }}
                          >
                            {p.growth >= 0 ? "+" : ""}
                            {Math.round(p.growth)}%
                          </span>
                        </p>
                                                                   {" "}
                      </div>
                                                                 {" "}
                      <ChevronRight size={18} style={{ color: C.indigo }} />   
                                                         {" "}
                    </div>
                  ))}
                                                     {" "}
                  {displayedProducts.length === 0 && (
                    <p className="text-sm" style={{ color: C.textS }}>
                      No products match.
                    </p>
                  )}
                                                 {" "}
                </div>
                                           {" "}
              </>
            )}
                                    {/* ---------- INVENTORY ---------- */}     
                             {" "}
            {activeTab === "inventory" && (
              <>
                                               {" "}
                <h2
                  className="font-bold"
                  style={{ fontSize: "22px", color: C.textP }}
                >
                  Inventory
                </h2>
                                               {" "}
                <p className="text-sm mb-4" style={{ color: C.textS }}>
                  Stock levels across all SKUs.
                </p>
                                               {" "}
                <div className="grid grid-cols-3 gap-2 mb-4">
                                                     {" "}
                  {[
                    { l: "In Stock", v: inventoryStats.inStock, c: C.indigo },
                    {
                      l: "Low",
                      v: inventoryStats.lowStock,
                      c: "var(--color-warning)",
                    },
                    { l: "Out", v: inventoryStats.outStock, c: C.red },
                  ].map((s) => (
                    <div
                      key={s.l}
                      className="rounded-xl bg-surface p-3 text-center"
                      style={{ border: `1px solid ${C.border}` }}
                    >
                                                                 {" "}
                      <p
                        className="font-bold"
                        style={{ fontSize: "20px", color: s.c }}
                      >
                        {formatNum(s.v)}
                      </p>
                                                                 {" "}
                      <p className="text-xs" style={{ color: C.textS }}>
                        {s.l}
                      </p>
                                                             {" "}
                    </div>
                  ))}
                                                 {" "}
                </div>
                                               {" "}
                <div className="relative mb-3">
                                                     {" "}
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: "var(--color-muted)" }}
                  />
                                                     {" "}
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search products..."
                    className="w-full outline-none rounded-xl text-sm bg-surface"
                    style={{
                      border: `1px solid ${C.border}`,
                      padding: "10px 12px 10px 34px",
                    }}
                  />
                                                 {" "}
                </div>
                                               {" "}
                <div className="flex flex-col gap-3">
                                                     {" "}
                  {displayedInventory.slice(0, 30).map((c) => {
                    const st = stockStatus(c.stock);
                    const low = st !== "in";
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-3 rounded-2xl bg-surface p-3"
                        style={{ border: `1px solid ${C.border}` }}
                      >
                                                                       {" "}
                        <ProductThumb
                          src={c.image}
                          alt={c.title}
                          size={72}
                          radius={8}
                        />
                                                                       {" "}
                        <div className="flex-1 min-w-0">
                                                                             {" "}
                          <p
                            className="text-xs font-semibold"
                            style={{ fontFamily: MONO, color: C.indigo }}
                          >
                            SKU: {String(c.id).slice(0, 8).toUpperCase()}
                          </p>
                                                                             {" "}
                          <p
                            className="font-bold truncate"
                            style={{ color: C.textP }}
                          >
                            {c.title}
                          </p>
                                                                             {" "}
                          <p
                            className="text-sm"
                            style={{ color: low ? C.red : C.textS }}
                          >
                            Stock: {formatNum(c.stock)} units
                          </p>
                                                                             {" "}
                          <p
                            className="font-bold"
                            style={{ fontSize: "15px", color: C.textP }}
                          >
                            {formatINR(c.price)}
                          </p>
                                                                         {" "}
                        </div>
                                                                       {" "}
                        <ChevronRight size={18} style={{ color: C.indigo }} /> 
                                                                 {" "}
                      </div>
                    );
                  })}
                                                     {" "}
                  {displayedInventory.length === 0 && (
                    <p className="text-sm" style={{ color: C.textS }}>
                      No inventory data.
                    </p>
                  )}
                                                 {" "}
                </div>
                                           {" "}
              </>
            )}
                                    {/* ---------- REPORTS ---------- */}       
                           {" "}
            {activeTab === "reports" && (
              <>
                                               {" "}
                <div className="flex items-center justify-between mb-4">
                                                     {" "}
                  <div>
                                                           {" "}
                    <h2
                      className="font-bold"
                      style={{ fontSize: "22px", color: C.textP }}
                    >
                      Report
                    </h2>
                                                           {" "}
                    <p className="text-sm" style={{ color: C.textS }}>
                      {periodLabel}
                    </p>
                                                       {" "}
                  </div>
                                                     {" "}
                  <button
                    onClick={downloadReportPDF}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-inverse"
                    style={{ background: C.indigo }}
                  >
                    <FileDown size={15} /> Export
                  </button>
                                                 {" "}
                </div>
                                               {" "}
                <div className="grid grid-cols-2 gap-3 mb-5">
                                                     {" "}
                  {[
                    { l: "Revenue", v: formatINR(revenue) },
                    { l: "Orders", v: formatNum(orders) },
                    { l: "Customers", v: formatNum(customers) },
                    { l: "AOV", v: formatINR(aov) },
                    { l: "Products Sold", v: formatNum(productsSold) },
                    { l: "Active Products", v: formatNum(activeProducts) },
                  ].map((s) => (
                    <div
                      key={s.l}
                      className="rounded-xl bg-surface p-3"
                      style={{ border: `1px solid ${C.border}` }}
                    >
                                                                 {" "}
                      <p className="text-xs" style={{ color: C.textS }}>
                        {s.l}
                      </p>
                                                                 {" "}
                      <p
                        className="font-bold"
                        style={{ fontSize: "18px", color: C.textP }}
                      >
                        {s.v}
                      </p>
                                                             {" "}
                    </div>
                  ))}
                                                 {" "}
                </div>
                                               {" "}
                <div
                  className="rounded-2xl bg-surface p-4 mb-4"
                  style={{ border: `1px solid ${C.border}` }}
                >
                                                     {" "}
                  <h3
                    className="font-bold mb-3"
                    style={{ fontSize: "16px", color: C.textP }}
                  >
                    Top 5 Products
                  </h3>
                                                     {" "}
                  <div className="flex flex-col gap-3">
                                                           {" "}
                    {displayedProducts.slice(0, 5).map((p, i) => (
                      <div key={p.id} className="flex items-center gap-3">
                                                                       {" "}
                        <span
                          className="w-5 font-bold text-sm"
                          style={{ color: C.indigo }}
                        >
                          {i + 1}
                        </span>
                                                                       {" "}
                        <span
                          className="flex-1 truncate text-sm"
                          style={{ color: C.textP }}
                        >
                          {p.title}
                        </span>
                                                                       {" "}
                        <span
                          className="text-sm font-bold"
                          style={{ fontFamily: MONO, color: C.textP }}
                        >
                          {formatINR(p.revenue)}
                        </span>
                                                                   {" "}
                      </div>
                    ))}
                                                           {" "}
                    {displayedProducts.length === 0 && (
                      <p className="text-sm" style={{ color: C.textS }}>
                        No data.
                      </p>
                    )}
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                               {" "}
                <div
                  className="rounded-2xl bg-surface p-4"
                  style={{ border: `1px solid ${C.border}` }}
                >
                                                     {" "}
                  <h3
                    className="font-bold mb-3"
                    style={{ fontSize: "16px", color: C.textP }}
                  >
                    Revenue by Category
                  </h3>
                                                     {" "}
                  <div className="flex flex-col gap-3">
                                                           {" "}
                    {categoryData.map((c) => (
                      <div key={c.name}>
                                                                       {" "}
                        <div className="flex justify-between text-sm mb-1">
                          <span
                            className="capitalize"
                            style={{ color: C.textP }}
                          >
                            {c.name}
                          </span>
                          <span
                            className="font-bold"
                            style={{ color: C.textP }}
                          >
                            {formatINR(c.revenue)}
                          </span>
                        </div>
                                                                       {" "}
                        <div
                          className="rounded-full overflow-hidden"
                          style={{
                            height: "6px",
                            background: "var(--color-surface-muted)",
                          }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${categoryData[0]?.revenue ? (c.revenue / categoryData[0].revenue) * 100 : 0}%`,
                              background: C.activeNav,
                            }}
                          />
                        </div>
                                                                   {" "}
                      </div>
                    ))}
                                                           {" "}
                    {categoryData.length === 0 && (
                      <p className="text-sm" style={{ color: C.textS }}>
                        No category data.
                      </p>
                    )}
                                                       {" "}
                  </div>
                                                 {" "}
                </div>
                                           {" "}
              </>
            )}
                               {" "}
          </div>
        )}
                   {" "}
      </div>
                 {" "}
      {/* PER-PRODUCT ANALYTICS DRAWER — "View Analytics" (grid card button + mobile catalog row) */}
                 {" "}
      <RightDrawer
        open={!!selectedProductAnalytics}
        onClose={closeProductAnalytics}
        title="Product Analytics"
      >
                       {" "}
        {displayedProductAnalytics && (
          <>
                                   {" "}
            <div
              className="rounded-xl overflow-hidden"
              style={{ height: "180px" }}
            >
                                         {" "}
              <ProductThumb
                src={displayedProductAnalytics.image}
                alt={displayedProductAnalytics.title}
                fill
              />
                                     {" "}
            </div>
                                   {" "}
            <div>
                                         {" "}
              <p
                className="text-xs font-semibold uppercase capitalize"
                style={{ color: C.indigo, letterSpacing: "0.6px" }}
              >
                {displayedProductAnalytics.category || "Uncategorized"}
              </p>
                                         {" "}
              <h3
                className="font-bold mt-1"
                style={{ fontSize: "20px", color: C.textP }}
              >
                {displayedProductAnalytics.title}
              </h3>
                                     {" "}
            </div>
                                   {" "}
            <div
              className="flex items-center justify-between rounded-xl p-4"
              style={{ background: C.sidebarBg }}
            >
                                         {" "}
              <div>
                                               {" "}
                <p className="text-xs" style={{ color: C.textS }}>
                  Price
                </p>
                                               {" "}
                <p className="font-bold text-lg" style={{ color: C.textP }}>
                  {formatINR(
                    displayedProductAnalytics.price ||
                      displayedProductAnalytics.revenue,
                  )}
                </p>
                                           {" "}
              </div>
                                         {" "}
              <div className="text-right">
                                               {" "}
                <p className="text-xs" style={{ color: C.textS }}>
                  Growth
                </p>
                                               {" "}
                <p
                  className="font-bold text-lg"
                  style={{
                    color:
                      displayedProductAnalytics.growth >= 0 ? C.indigo : C.red,
                  }}
                >
                                                     {" "}
                  {displayedProductAnalytics.growthHasPrev
                    ? `${displayedProductAnalytics.growth >= 0 ? "+" : ""}${Math.round(displayedProductAnalytics.growth)}%`
                    : "N/A"}
                                                 {" "}
                </p>
                                           {" "}
              </div>
                                     {" "}
            </div>
                                   {" "}
            <div className="grid grid-cols-2 gap-3">
                                         {" "}
              <div
                className="rounded-xl p-3"
                style={{ border: `1px solid ${C.border}` }}
              >
                                               {" "}
                <p className="text-xs" style={{ color: C.textS }}>
                  Revenue
                </p>
                                               {" "}
                <p
                  className="font-bold"
                  style={{ fontSize: "18px", color: C.textP }}
                >
                  {formatINR(displayedProductAnalytics.revenue)}
                </p>
                                           {" "}
              </div>
                                         {" "}
              <div
                className="rounded-xl p-3"
                style={{ border: `1px solid ${C.border}` }}
              >
                                               {" "}
                <p className="text-xs" style={{ color: C.textS }}>
                  Orders
                </p>
                                               {" "}
                <p
                  className="font-bold"
                  style={{ fontSize: "18px", color: C.textP }}
                >
                  {formatNum(displayedProductAnalytics.orders)}
                </p>
                                           {" "}
              </div>
                                         {" "}
              <div
                className="rounded-xl p-3"
                style={{ border: `1px solid ${C.border}` }}
              >
                                               {" "}
                <p className="text-xs" style={{ color: C.textS }}>
                  Units Sold
                </p>
                                               {" "}
                <p
                  className="font-bold"
                  style={{ fontSize: "18px", color: C.textP }}
                >
                  {formatNum(displayedProductAnalytics.units)}
                </p>
                                           {" "}
              </div>
                                         {" "}
              <div
                className="rounded-xl p-3"
                style={{ border: `1px solid ${C.border}` }}
              >
                                               {" "}
                <p className="text-xs" style={{ color: C.textS }}>
                  Stock
                </p>
                                               {" "}
                <p
                  className="font-bold"
                  style={{
                    fontSize: "18px",
                    color:
                      (displayedProductAnalytics.stock ?? 1) <= 0
                        ? C.red
                        : C.textP,
                  }}
                >
                  {displayedProductAnalytics.stock ?? "—"}
                </p>
                                           {" "}
              </div>
                                     {" "}
            </div>
                                   {" "}
            {displayedProductAnalytics.rating > 0 && (
              <div className="flex items-center gap-2">
                                               {" "}
                <Star
                  size={16}
                  style={{ color: "var(--color-accent)" }}
                  fill="var(--color-accent)"
                />
                                               {" "}
                <span className="font-semibold" style={{ color: C.textP }}>
                  {displayedProductAnalytics.rating.toFixed(1)}
                </span>
                                               {" "}
                <span className="text-sm" style={{ color: C.textS }}>
                  rating
                </span>
                                           {" "}
              </div>
            )}
                               {" "}
          </>
        )}
                   {" "}
      </RightDrawer>
             {" "}
    </div>
  );
};

/* ============================== SMALL COMPONENTS ============================== */
const MobKpi = ({ icon, label, value, t }) => (
  <div
    className="kpi-card rounded-2xl bg-surface p-4"
    style={{ border: `1px solid ${C.border}` }}
  >
           {" "}
    <div className="flex items-center justify-between mb-2">
                 {" "}
      <span
        className="flex items-center justify-center rounded-lg p-1.5"
        style={{ background: C.lightIndigo }}
      >
        {icon}
      </span>
                 {" "}
      {t && (
        <span
          className="text-xs font-semibold rounded px-1.5 py-0.5"
          style={{
            background: t.up
              ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
              : "color-mix(in srgb, var(--color-error) 10%, transparent)",
            color: t.up ? C.indigo : C.red,
          }}
        >
          {t.up ? "+" : "-"}
          {t.pct}%
        </span>
      )}
             {" "}
    </div>
           {" "}
    <p className="text-sm" style={{ color: C.textS }}>
      {label}
    </p>
           {" "}
    <p className="font-bold" style={{ fontSize: "24px", color: C.textP }}>
      {value}
    </p>
       {" "}
  </div>
);
const SummaryCol = ({ label, value, green, border }) => (
  <div
    className="px-6 py-4"
    style={
      border
        ? {
            borderLeft: `1px solid ${C.border}`,
            borderRight: `1px solid ${C.border}`,
          }
        : {}
    }
  >
           {" "}
    <p className="text-xs mb-1" style={{ color: C.textS }}>
      {label}
    </p>
           {" "}
    <p
      className="font-bold"
      style={{ fontSize: "16px", color: green ? C.indigo : C.textP }}
    >
      {value}
    </p>
       {" "}
  </div>
);

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between text-sm">
            <span style={{ color: C.textS }}>{label}</span>       {" "}
    <span className="font-bold" style={{ color: C.textP }}>
      {value}
    </span>
       {" "}
  </div>
);

const InsightCard = ({ label, labelColor, product, sub, badge, highlight }) => (
  <div
    className="insight-card rounded-xl p-4 flex flex-col gap-2"
    style={
      highlight
        ? {
            background:
              "color-mix(in srgb, var(--color-surface) 70%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)",
            backdropFilter: "blur(5px)",
          }
        : {
            background: "var(--color-surface)",
            border: `1px solid ${C.border}`,
          }
    }
  >
           {" "}
    <span
      className="text-xs font-bold uppercase"
      style={{ color: labelColor, letterSpacing: "0.6px" }}
    >
      {label}
    </span>
           {" "}
    <div className="flex items-center gap-3">
                 {" "}
      {product?.image && (
        <img
          src={product.image}
          alt=""
          className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
        />
      )}
                 {" "}
      <div className="min-w-0">
                       {" "}
        <p
          className="font-semibold truncate"
          style={{ fontSize: "18px", color: C.textP }}
        >
          {product?.title || "—"}
        </p>
                       {" "}
        {sub && (
          <p className="text-xs" style={{ color: C.textS }}>
            {sub}
          </p>
        )}
                   {" "}
      </div>
                 {" "}
      {badge && (
        <span
          className="ml-auto text-xs font-bold rounded-lg px-2 py-1 flex-shrink-0"
          style={{ background: badge.bg, color: badge.color }}
        >
          {badge.text}
        </span>
      )}
             {" "}
    </div>
       {" "}
  </div>
);

export default AllProductsOrdersAnalytics;
