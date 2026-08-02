import { useEffect, useState, useMemo, useRef } from "react"
import { collection, getDocs } from "firebase/firestore"
import { fireDB } from "../../context/FirebaseConfig"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import {
    Search,
    Download,
    Users,
    ShoppingBag,
    IndianRupee,
    TrendingUp,
    TrendingDown,
    Crown,
    Zap,
    ChevronDown,
    Database,
    User as UserIcon,
} from "lucide-react"
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    PieChart,
    Pie,
    Cell,
} from "recharts"
import * as XLSX from "xlsx"
import { toast } from "react-toastify"
import RightDrawer from "../../components/Common/RightDrawer"
import Pagination from "../../components/Pagination"

/* ============================================================
   COLORS
============================================================ */
const C = {
    darkDesk: "var(--color-ink)",
    darkMob: "var(--color-ink)",
    blue: "var(--color-info)",
    blueMob: "var(--color-info)",
    green: "var(--color-primary)",
    red: "var(--color-error)",
    border: "var(--color-border-strong)",
    bg: "var(--color-background)",
    textSec: "var(--color-body)",
}
const MONO = "'JetBrains Mono', monospace"
const SEGMENT_COLORS = ["var(--color-chart-1)", "var(--color-chart-3)", "var(--color-border-strong)"]

/* ============================================================
   HELPERS
============================================================ */
const toDate = (v) => {
    if (!v) return null
    if (v?.toDate) return v.toDate()
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}

const formatINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`

const formatCompactINR = (n) => {
    const num = Number(n || 0)
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(1)}Cr`
    if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L`
    if (num >= 1000) return `₹${(num / 1000).toFixed(1)}k`
    return `₹${num.toLocaleString("en-IN")}`
}

const formatCount = (n) => {
    const num = Number(n || 0)
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
    return String(num)
}

const initials = (name) => {
    if (!name) return "U"
    return String(name).trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()
}

const avatarColor = (name) => {
    const colors = ["var(--color-chart-3)", "var(--color-chart-1)", "var(--color-chart-8)", "var(--color-chart-5)", "var(--color-chart-7)", "var(--color-chart-6)"]
    const s = String(name || "U")
    let h = 0
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
    return colors[Math.abs(h) % colors.length]
}

const relativeTime = (date) => {
    if (!date) return "—"
    const now = new Date()
    const diff = now - date
    const mins = Math.floor(diff / 60000)
    const hrs = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1) return "Just now"
    if (mins < 60) return `${mins} min ago`
    if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`
    if (days === 1) return "Yesterday"
    if (days < 7) return `${days} days ago`
    return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

const PERIOD_DAYS = { today: 1, week: 7, month: 30, custom: 3650 }

const trendOf = (current, prev) => {
    if (!prev) return current > 0 ? { up: true, pct: 100 } : { up: true, pct: 0 }
    const pct = ((current - prev) / prev) * 100
    return { up: pct >= 0, pct: Math.abs(Math.round(pct)) }
}

const rankBadgeStyle = (rank) => {
    if (rank === 1) return { background: "linear-gradient(135deg,var(--color-chart-gold),color-mix(in srgb, var(--color-chart-gold) 55%, white))", color: "var(--color-ink)" }
    if (rank === 2) return { background: "linear-gradient(135deg,var(--color-chart-silver),color-mix(in srgb, var(--color-chart-silver) 55%, white))", color: "var(--color-ink)" }
    if (rank === 3) return { background: "linear-gradient(135deg,var(--color-chart-bronze),color-mix(in srgb, var(--color-chart-bronze) 55%, white))", color: "var(--color-ink)" }
    return null
}

const loyaltyTier = (rank) => {
    if (rank === 1) return "Loyalty Member • Platinum"
    if (rank <= 3) return "Regular • Gold"
    if (rank <= 6) return "New Entry • Silver"
    return "Member • Bronze"
}

const AllUsersOrdersAnalytics = () => {
    const [rawUsers, setRawUsers] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState("month")
    const [search, setSearch] = useState("")
    const [minRev, setMinRev] = useState("")
    const [maxRev, setMaxRev] = useState("")
    const [sortBy, setSortBy] = useState("highest")
    const [expanded, setExpanded] = useState({})
    const [showAllLeaderboard, setShowAllLeaderboard] = useState(false)
    const [customFrom, setCustomFrom] = useState("")
    const [customTo, setCustomTo] = useState("")
    const [topSpendingPage, setTopSpendingPage] = useState(1)
    const [detailedOverviewPage, setDetailedOverviewPage] = useState(1)
    const PAGE_SIZE = 10

    // Order detail drawer — `displayedOrder` keeps the last order's data visible
    // while RightDrawer plays its close animation (no blank/stale-flash on swap).
    const [selectedOrder, setSelectedOrder] = useState(null)
    const [displayedOrder, setDisplayedOrder] = useState(null)
    const openOrder = (user, order) => { setSelectedOrder({ ...order, customerName: user.name, customerEmail: user.email }); setDisplayedOrder({ ...order, customerName: user.name, customerEmail: user.email }) }
    const closeOrder = () => setSelectedOrder(null)

    const rootRef = useRef(null)

    /* ---------- FETCH — single source of truth: top-level `orders` ---------- */
    const fetchUsersOrders = async () => {
        try {
            setLoading(true)

            // 1. Users → metadata buckets keyed by uid
            const usersSnap = await getDocs(collection(fireDB, "users"))
            const usersById = {}
            usersSnap.docs.forEach((d) => {
                const u = d.data()
                usersById[d.id] = {
                    userId: d.id,
                    name: u.name || "Unknown User",
                    email: u.email || "—",
                    photoURL: u.photoURL || "",
                    createdAt: toDate(u.createdAt),
                    orders: [],
                }
            })

            // 2. Top-level orders → grouped by userId (same collection every other
            //    page reads/writes; covers cart, restore and seeded orders)
            const ordersSnap = await getDocs(collection(fireDB, "orders"))
            ordersSnap.docs.forEach((o) => {
                const data = o.data()
                const uid = data.userId
                if (!uid) return
                if (!usersById[uid]) {
                    usersById[uid] = {
                        userId: uid,
                        name: data.userName || "Unknown User",
                        email: data.userEmail || "—",
                        photoURL: "",
                        createdAt: null,
                        orders: [],
                    }
                }
                usersById[uid].orders.push({
                    id: o.id,
                    externalOrderId: data.externalOrderId || "",
                    total: Number(data.total || 0),
                    date: toDate(data.createdAt),
                    items: data.products || data.cartItems || data.items || [],
                    status: data.orderStatus || "placed",
                    paymentMethod: data.paymentMethod || "",
                    userName: data.userName || "",
                    userEmail: data.userEmail || "",
                    userPhone: data.userPhone || data.phone || "",
                    address: data.userAddress || data.address || data.shippingAddress || "",
                })
            })

            setRawUsers(Object.values(usersById))
        } catch (error) {
            console.log(error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchUsersOrders()
    }, [])

    // Paint the whole viewport (body + navbar gap) in the dashboard background
    // so the floating navbar blends with this page. Restored on unmount.
    useEffect(() => {
        const prev = document.body.style.background
        document.body.style.background = C.bg
        return () => { document.body.style.background = prev }
    }, [])

    /* ---------- DERIVED METRICS (reactive to filter + search + sort) ---------- */
    const metrics = useMemo(() => {
        const now = new Date()
        const periodDays = PERIOD_DAYS[filter] ?? 30
        // Custom range: only active once both From/To are picked and From <= To;
        // otherwise falls back to "all time" (same as the old custom behavior).
        const customValid = filter === "custom" && customFrom && customTo && new Date(customFrom) <= new Date(customTo)
        const periodStart = filter === "custom"
            ? (customValid ? new Date(customFrom) : new Date(0))
            : new Date(now.getTime() - periodDays * 86400000)
        const periodEnd = filter === "custom" && customValid
            ? new Date(new Date(customTo).getTime() + 86400000 - 1) // inclusive end-of-day
            : now
        const prevStart = new Date(now.getTime() - 2 * periodDays * 86400000)
        const last30 = new Date(now.getTime() - 30 * 86400000)

        // Per-user stats within the active period
        const users = rawUsers.map((u) => {
            const inPeriod = u.orders.filter((o) => o.date && o.date >= periodStart && o.date <= periodEnd)
            const allTimeTotal = u.orders.reduce((s, o) => s + o.total, 0)
            const periodTotal = inPeriod.reduce((s, o) => s + o.total, 0)
            const last30Count = u.orders.filter((o) => o.date && o.date >= last30).length
            const lastOrderDate = u.orders.reduce(
                (m, o) => (o.date && (!m || o.date > m) ? o.date : m),
                null
            )
            const total = periodTotal
            // Orders shown in the expandable detail list — scoped to the active range
            // so the count/spend header matches the rows below it.
            const periodOrders = inPeriod
            const orderCount = periodOrders.length
            return {
                ...u,
                total,
                orderCount,
                periodOrders,
                aov: orderCount > 0 ? total / orderCount : 0,
                last30Count,
                lastOrderDate,
                allTimeTotal,
            }
        })

        // Global KPIs
        const totalUsers = users.length
        const totalOrders = users.reduce((s, u) => s + u.orderCount, 0)
        const totalRevenue = users.reduce((s, u) => s + u.total, 0)
        const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0
        const topSpender = [...users].sort((a, b) => b.total - a.total)[0] || null
        const activeCustomers = users.filter((u) => u.last30Count >= 1).length

        // Period-over-period trends (from all orders)
        let curRev = 0, prevRev = 0, curOrd = 0, prevOrd = 0
        rawUsers.forEach((u) => {
            u.orders.forEach((o) => {
                if (!o.date) return
                if (o.date >= periodStart) { curRev += o.total; curOrd += 1 }
                else if (o.date >= prevStart) { prevRev += o.total; prevOrd += 1 }
            })
        })
        let curUsers = 0, prevUsers = 0
        rawUsers.forEach((u) => {
            if (!u.createdAt) return
            if (u.createdAt >= periodStart) curUsers += 1
            else if (u.createdAt >= prevStart) prevUsers += 1
        })
        // Real prior-window active customers (30–60 days ago) for an honest trend
        const prev30Start = new Date(now.getTime() - 60 * 86400000)
        let prevActive = 0
        rawUsers.forEach((u) => {
            if (u.orders.some((o) => o.date && o.date >= prev30Start && o.date < last30)) prevActive += 1
        })
        const trends = {
            users: trendOf(curUsers, prevUsers),
            orders: trendOf(curOrd, prevOrd),
            revenue: trendOf(curRev, prevRev),
            aov: trendOf(curOrd ? curRev / curOrd : 0, prevOrd ? prevRev / prevOrd : 0),
            active: trendOf(activeCustomers, prevActive),
        }

        // Revenue trend series (daily buckets)
        const seriesDays = filter === "today" ? 7 : filter === "week" ? 7 : 30
        const dayMap = {}
        for (let i = seriesDays - 1; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 86400000)
            const key = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
            dayMap[key] = 0
        }
        rawUsers.forEach((u) =>
            u.orders.forEach((o) => {
                if (!o.date) return
                const within = new Date(now.getTime() - seriesDays * 86400000)
                if (o.date >= within) {
                    const key = o.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                    if (dayMap[key] !== undefined) dayMap[key] += o.total
                }
            })
        )
        const seriesVals = Object.values(dayMap)
        const dailyAverage = seriesVals.length ? seriesVals.reduce((a, b) => a + b, 0) / seriesVals.length : 0
        const target = dailyAverage * 1.1
        const revenueSeries = Object.entries(dayMap).map(([date, revenue]) => ({
            date,
            revenue: Math.round(revenue),
            target: Math.round(target),
        }))

        // Peak growth (max day-over-day %)
        let peakGrowth = 0
        for (let i = 1; i < seriesVals.length; i++) {
            if (seriesVals[i - 1] > 0) {
                const g = ((seriesVals[i] - seriesVals[i - 1]) / seriesVals[i - 1]) * 100
                if (g > peakGrowth) peakGrowth = g
            }
        }
        const todayRevenue = seriesVals[seriesVals.length - 1] || 0
        const ordersToday = rawUsers.reduce(
            (s, u) => s + u.orders.filter((o) => o.date && o.date >= new Date(now.getTime() - 86400000)).length,
            0
        )
        const currentVelocity = ordersToday / 24

        // Customer segments
        const spends = users.map((u) => u.total).filter((v) => v > 0).sort((a, b) => a - b)
        const p75 = spends.length ? spends[Math.floor(spends.length * 0.75)] : 0
        let power = 0, regulars = 0, casual = 0
        users.forEach((u) => {
            if (u.total > 0 && u.total >= p75 && p75 > 0) power += 1
            else if (u.last30Count >= 2) regulars += 1
            else casual += 1
        })
        const segments = [
            { name: "Power Users (High Spend)", value: power },
            { name: "Active Regulars", value: regulars },
            { name: "Casual/Inactive", value: casual },
        ]

        // Filtered + sorted display list
        let displayed = users.filter((u) => {
            const q = search.toLowerCase()
            const matchSearch =
                !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
            const min = minRev === "" ? -Infinity : Number(minRev)
            const max = maxRev === "" ? Infinity : Number(maxRev)
            return matchSearch && u.total >= min && u.total <= max
        })
        displayed.sort((a, b) => {
            if (sortBy === "newest") return (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
            if (sortBy === "oldest") return (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0)
            return b.total - a.total
        })

        return {
            totalUsers, totalOrders, totalRevenue, aov, topSpender, activeCustomers,
            trends, revenueSeries, dailyAverage, peakGrowth, todayRevenue, currentVelocity,
            segments, displayed,
        }
    }, [rawUsers, filter, search, minRev, maxRev, sortBy, customFrom, customTo])

    // Jump both paginated sections back to page 1 whenever the active filters change,
    // so a stale page number can't land on an out-of-range/empty page.
    useEffect(() => {
        setTopSpendingPage(1)
        setDetailedOverviewPage(1)
    }, [filter, search, minRev, maxRev, sortBy, customFrom, customTo])

    const topSpendingTotalPages = Math.max(1, Math.ceil(metrics.displayed.length / PAGE_SIZE))
    const topSpendingSafePage = Math.min(topSpendingPage, topSpendingTotalPages)
    const topSpendingPageItems = metrics.displayed.slice((topSpendingSafePage - 1) * PAGE_SIZE, topSpendingSafePage * PAGE_SIZE)

    const detailedOverviewTotalPages = Math.max(1, Math.ceil(metrics.displayed.length / PAGE_SIZE))
    const detailedOverviewSafePage = Math.min(detailedOverviewPage, detailedOverviewTotalPages)
    const detailedOverviewPageItems = metrics.displayed.slice((detailedOverviewSafePage - 1) * PAGE_SIZE, detailedOverviewSafePage * PAGE_SIZE)

    /* ---------- ANIMATIONS ---------- */
    useGSAP(() => {
        if (loading) return
        const cards = gsap.utils.toArray(".kpi-card")
        if (cards.length) gsap.from(cards, { y: 24, opacity: 0, duration: 0.5, stagger: 0.1, ease: "power2.out" })
        const rows = gsap.utils.toArray(".table-row")
        if (rows.length) gsap.from(rows, { opacity: 0, y: 10, duration: 0.4, stagger: 0.05, ease: "power2.out", delay: 0.2 })
    }, { scope: rootRef, dependencies: [loading, filter] })

    const toggleExpand = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }))

    const segTotal = metrics.segments?.reduce((s, x) => s + x.value, 0) || 0

    /* ---------- EXPORT TO EXCEL ----------
       Multi-sheet workbook built from the same `metrics` the dashboard renders
       (unified orders source), so the file always matches the active period/filter. */
    const exportToExcel = () => {
        const m = metrics
        if (!m.displayed?.length) {
            toast.info("No customer data to export for this period.")
            return
        }
        const periodLabel = { today: "Today", week: "This Week", month: "This Month", custom: "All Time" }[filter] || filter

        const summary = [
            ["Users & Orders Analytics"],
            ["Period", periodLabel],
            ["Generated", new Date().toLocaleString("en-IN")],
            [],
            ["Metric", "Value"],
            ["Total Customers", m.totalUsers],
            ["Total Orders", m.totalOrders],
            ["Total Revenue (INR)", Math.round(m.totalRevenue)],
            ["Avg Order Value (INR)", Math.round(m.aov)],
            ["Active Customers (last 30d)", m.activeCustomers],
            ["Top Spender", m.topSpender ? `${m.topSpender.name} (INR ${Math.round(m.topSpender.total)})` : "—"],
        ]
        const customers = m.displayed.map((u, i) => ({
            Rank: i + 1,
            "Customer Name": u.name,
            Email: u.email,
            Orders: u.orderCount,
            "Total Spend (INR)": Math.round(u.total),
            "AOV (INR)": Math.round(u.aov),
            "Last Order": u.lastOrderDate ? u.lastOrderDate.toLocaleDateString("en-IN") : "—",
        }))
        const trend = (m.revenueSeries || []).map((d) => ({ Date: d.date, "Revenue (INR)": d.revenue }))

        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary")
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customers), "Customers")
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trend), "Revenue Trend")
        XLSX.writeFile(wb, `Users_Analytics_${periodLabel.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`)
        toast.success("Exported users analytics to Excel.")
    }

    /* ============================================================
       LOADING
    ============================================================ */
    if (loading) {
        const bar = (style) => <div aria-hidden="true" className="animate-pulse" style={{ background: "var(--color-surface-muted)", borderRadius: "6px", ...style }} />
        const kpiCardSkel = (key) => (
            <div key={key} className="rounded-xl bg-surface p-4" style={{ border: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between mb-3">
                    {bar({ width: "70px", height: "12px" })}
                    {bar({ width: "28px", height: "28px", borderRadius: "8px" })}
                </div>
                {bar({ width: "70%", height: "22px", marginBottom: "8px" })}
                {bar({ width: "50%", height: "11px" })}
            </div>
        )
        return (
            <div className="mt-[88px] md:mt-0" style={{ background: C.bg, fontFamily: "Inter, sans-serif", minHeight: "100vh" }} aria-busy="true">
                {/* DESKTOP skeleton */}
                <div className="hidden md:block">
                    <div className="px-8 py-6">
                        {/* Header */}
                        <div className="mb-6 flex items-start justify-between gap-4">
                            <div className="flex flex-col gap-2">{bar({ width: "320px", height: "24px" })}{bar({ width: "260px", height: "14px" })}</div>
                            {bar({ width: "110px", height: "38px", borderRadius: "8px" })}
                        </div>
                        {/* KPI cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
                            {[...Array(6)].map((_, i) => kpiCardSkel(i))}
                        </div>
                        {/* Filter panel */}
                        <div className="flex flex-wrap items-center gap-3 p-4 mb-6 rounded-xl bg-surface" style={{ border: `1px solid ${C.border}` }}>
                            {[...Array(4)].map((_, i) => <div key={i}>{bar({ width: "96px", height: "32px", borderRadius: "9999px" })}</div>)}
                            <div className="flex-1 min-w-[200px]">{bar({ width: "100%", height: "36px", borderRadius: "8px" })}</div>
                            {bar({ width: "160px", height: "36px", borderRadius: "8px" })}
                        </div>
                        {/* Charts */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                            <div className="lg:col-span-2 rounded-xl bg-surface p-6" style={{ border: `1px solid ${C.border}` }}>
                                <div className="flex items-center justify-between mb-4">{bar({ width: "140px", height: "18px" })}{bar({ width: "160px", height: "12px" })}</div>
                                {bar({ width: "100%", height: "260px", borderRadius: "12px" })}
                                <div className="grid grid-cols-3 mt-4 pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
                                    {[...Array(3)].map((_, i) => <div key={i} className="flex flex-col gap-2 items-center">{bar({ width: "70px", height: "12px" })}{bar({ width: "90px", height: "16px" })}</div>)}
                                </div>
                            </div>
                            <div className="rounded-xl bg-surface p-6" style={{ border: `1px solid ${C.border}` }}>
                                {bar({ width: "150px", height: "18px", marginBottom: "16px" })}
                                <div className="flex items-center justify-center">{bar({ width: "176px", height: "176px", borderRadius: "9999px" })}</div>
                                <div className="flex flex-col gap-2 mt-4">
                                    {[...Array(3)].map((_, i) => <div key={i} className="flex items-center justify-between">{bar({ width: "40%", height: "12px" })}{bar({ width: "36px", height: "12px" })}</div>)}
                                </div>
                            </div>
                        </div>
                        {/* Customer highlights */}
                        {bar({ width: "200px", height: "20px", marginBottom: "12px" })}
                        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className="rounded-xl bg-surface p-4 flex items-center gap-3" style={{ border: `1px solid ${C.border}` }}>
                                    {bar({ width: "44px", height: "44px", borderRadius: "9999px", flexShrink: 0 })}
                                    <div className="flex flex-col gap-2 flex-1">{bar({ width: "80%", height: "13px" })}{bar({ width: "50%", height: "11px" })}{bar({ width: "60%", height: "13px" })}</div>
                                </div>
                            ))}
                        </div>
                        {/* Top spending table */}
                        {bar({ width: "220px", height: "20px", marginBottom: "12px" })}
                        <div className="rounded-xl overflow-hidden mb-8" style={{ border: `1px solid ${C.border}` }}>
                            <div className="flex items-center gap-4 px-4 py-3" style={{ background: "var(--color-surface-muted)", borderBottom: `2px solid ${C.darkDesk}` }}>
                                {[...Array(7)].map((_, i) => <div key={i} style={{ flex: 1 }}>{bar({ width: "60%", height: "11px" })}</div>)}
                            </div>
                            {[...Array(6)].map((_, r) => (
                                <div key={r} className="flex items-center gap-4 px-4 py-3" style={{ borderTop: `1px solid ${C.border}` }}>
                                    {[...Array(7)].map((_, i) => <div key={i} style={{ flex: 1 }}>{bar({ width: i === 0 ? "28px" : "70%", height: i === 0 ? "28px" : "14px", borderRadius: i === 0 ? "9999px" : "6px" })}</div>)}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* MOBILE skeleton */}
                <div className="md:hidden pb-24">
                    <div className="px-4 pt-4">
                        {bar({ width: "100%", height: "40px", borderRadius: "12px", marginBottom: "16px" })}
                        <div className="flex gap-2 mb-4">{[...Array(4)].map((_, i) => <div key={i}>{bar({ width: "90px", height: "36px", borderRadius: "9999px" })}</div>)}</div>
                        <div className="grid grid-cols-2 gap-3 mb-5">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className="rounded-xl bg-surface p-4" style={{ border: `1px solid ${C.border}` }}>
                                    {bar({ width: "70%", height: "11px", marginBottom: "8px" })}{bar({ width: "50%", height: "20px" })}
                                </div>
                            ))}
                        </div>
                        <div className="rounded-2xl bg-surface p-4 mb-5" style={{ border: `1px solid ${C.border}` }}>
                            <div className="flex items-start justify-between mb-3">{bar({ width: "120px", height: "16px" })}{bar({ width: "50px", height: "16px" })}</div>
                            {bar({ width: "100%", height: "150px", borderRadius: "12px" })}
                        </div>
                        <div className="flex gap-3 overflow-x-auto no-scrollbar mb-5 pb-1">
                            {[...Array(3)].map((_, i) => (
                                <div key={i} className="flex-shrink-0 rounded-2xl bg-surface p-4 flex items-center gap-3" style={{ width: "230px", border: `1px solid ${C.border}` }}>
                                    {bar({ width: "44px", height: "44px", borderRadius: "9999px", flexShrink: 0 })}
                                    <div className="flex flex-col gap-2 flex-1">{bar({ width: "80%", height: "13px" })}{bar({ width: "50%", height: "11px" })}{bar({ width: "60%", height: "13px" })}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    const FILTERS = [
        { key: "today", label: "Today" },
        { key: "week", label: "Last 7 Days" },
        { key: "month", label: "Last 30 Days" },
        { key: "custom", label: "Custom" },
    ]
    const m = metrics

    const KpiTrend = ({ t, label }) => (
        <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: t.up ? C.green : C.red }}>
            {t.up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {t.pct}% {label}
        </span>
    )

    return (
        <div ref={rootRef} className="mt-[88px] md:mt-0" style={{ background: C.bg, fontFamily: "Inter, sans-serif", minHeight: "100vh" }}>

            {/* ============================================================
          DESKTOP (≥768px)
      ============================================================ */}
            <div className="hidden md:block">
                <div className="px-8 py-6">
                    {/* HEADER */}
                    <div className="mb-6 flex items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold" style={{ color: C.darkDesk }}>All Users Orders Analytics</h1>
                            <p className="text-sm" style={{ color: C.textSec }}>Real-time performance metrics and customer lifecycle data</p>
                        </div>
                        <button onClick={exportToExcel} title="Export to Excel" className="flex items-center gap-2 px-3 py-2 rounded-lg text-inverse text-sm font-semibold flex-shrink-0" style={{ background: C.darkDesk }}><Download size={16} /> Export</button>
                    </div>

                    {/* KPI CARDS */}
                    <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
                        <KpiCard className="kpi-card" label="Total Users" icon={<Users size={16} />} value={formatCount(m.totalUsers)} trend={<KpiTrend t={m.trends.users} label="vs prev" />} />
                        <KpiCard className="kpi-card" label="Total Orders" icon={<ShoppingBag size={16} />} value={m.totalOrders.toLocaleString("en-IN")} trend={<KpiTrend t={m.trends.orders} label="" />} />
                        <KpiCard className="kpi-card" label="Total Revenue" icon={<IndianRupee size={16} />} value={formatCompactINR(m.totalRevenue)} trend={<KpiTrend t={m.trends.revenue} label="" />} />
                        <KpiCard className="kpi-card" label="AOV" icon={<TrendingUp size={16} />} value={formatINR(Math.round(m.aov))} trend={<KpiTrend t={m.trends.aov} label="" />} />
                        <KpiCard className="kpi-card" label="Top Spender" icon={<Crown size={16} />} value={<span className="text-base leading-tight">{m.topSpender?.name || "—"}</span>} trend={<span className="text-xs" style={{ color: C.textSec }}>Spent {formatINR(m.topSpender?.total || 0)}</span>} />
                        <KpiCard className="kpi-card" label="Active Users" icon={<Zap size={16} />} value={formatCount(m.activeCustomers)} trend={<KpiTrend t={m.trends.active} label="Retention" />} />
                    </div>

                    {/* FILTER PANEL */}
                    <div className="sticky top-[57px] z-20 flex flex-wrap items-center gap-3 p-4 mb-6 rounded-xl bg-surface" style={{ border: `1px solid ${C.border}` }}>
                        <span className="text-sm font-medium" style={{ color: C.textSec }}>Time Range:</span>
                        {FILTERS.map((f) => (
                            <button key={f.key} onClick={() => setFilter(f.key)} className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors"
                                style={filter === f.key ? { background: C.darkDesk, color: "var(--color-inverse)" } : { background: "var(--color-surface-muted)", color: C.textSec }}>
                                {f.label}
                            </button>
                        ))}
                        {filter === "custom" && (
                            <div className="flex items-center gap-2">
                                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} max={customTo || undefined} className="outline-none rounded-lg text-sm px-2 py-1.5" style={{ border: `1px solid ${C.border}` }} />
                                <span style={{ color: C.textSec }}>to</span>
                                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} min={customFrom || undefined} className="outline-none rounded-lg text-sm px-2 py-1.5" style={{ border: `1px solid ${C.border}` }} />
                                {customFrom && customTo && new Date(customFrom) > new Date(customTo) && (
                                    <span className="text-xs font-semibold" style={{ color: C.red }}>From date must be before To date</span>
                                )}
                            </div>
                        )}
                        <div className="w-px h-6" style={{ background: C.border }} />
                        <div className="relative flex-1 min-w-[200px]">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.textSec }} />
                            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by user name or email..." className="w-full outline-none rounded-lg text-sm" style={{ border: `1px solid ${C.border}`, padding: "7px 12px 7px 32px" }} />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm" style={{ color: C.textSec }}>Revenue:</span>
                            <input value={minRev} onChange={(e) => setMinRev(e.target.value)} type="number" placeholder="Min" className="w-20 outline-none rounded-lg text-sm px-2 py-1.5" style={{ border: `1px solid ${C.border}` }} />
                            <span style={{ color: C.textSec }}>-</span>
                            <input value={maxRev} onChange={(e) => setMaxRev(e.target.value)} type="number" placeholder="Max" className="w-20 outline-none rounded-lg text-sm px-2 py-1.5" style={{ border: `1px solid ${C.border}` }} />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm" style={{ color: C.textSec }}>Sort by:</span>
                            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="outline-none rounded-lg text-sm px-2 py-1.5" style={{ border: `1px solid ${C.border}` }}>
                                <option value="newest">Newest</option>
                                <option value="oldest">Oldest</option>
                                <option value="highest">Highest Spend</option>
                            </select>
                        </div>
                    </div>

                    {/* CHARTS */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                        {/* Revenue Trend */}
                        <div className="lg:col-span-2 rounded-xl bg-surface p-6" style={{ border: `1px solid ${C.border}` }}>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold" style={{ color: C.darkDesk }}>Revenue Trend</h3>
                                <div className="flex items-center gap-4 text-xs" style={{ color: C.textSec }}>
                                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--color-chart-1)" }} />Revenue</span>
                                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--color-chart-2)" }} />Target</span>
                                </div>
                            </div>
                            <ResponsiveContainer width="100%" height={260}>
                                <AreaChart data={m.revenueSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.25} />
                                            <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--color-chart-axis)" }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: "var(--color-chart-axis)" }} tickFormatter={(v) => formatCompactINR(v)} tickLine={false} axisLine={false} width={50} />
                                    <Tooltip formatter={(v) => formatINR(v)} />
                                    <Area type="monotone" dataKey="revenue" stroke="var(--color-chart-1)" strokeWidth={2} fill="url(#rev)" />
                                    <Area type="monotone" dataKey="target" stroke="var(--color-chart-2)" strokeWidth={2} strokeDasharray="5 4" fill="none" />
                                </AreaChart>
                            </ResponsiveContainer>
                            <div className="grid grid-cols-3 mt-4 pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
                                <SummaryStat label="Daily Average" value={formatINR(Math.round(m.dailyAverage))} />
                                <SummaryStat label="Peak Growth" value={`+${Math.round(m.peakGrowth)}%`} green />
                                <SummaryStat label="Current Velocity" value={`${m.currentVelocity.toFixed(1)} ord/hr`} />
                            </div>
                        </div>

                        {/* Customer Segments */}
                        <div className="rounded-xl bg-surface p-6" style={{ border: `1px solid ${C.border}` }}>
                            <h3 className="font-bold mb-4" style={{ color: C.darkDesk }}>Customer Segments</h3>
                            <div className="relative">
                                <ResponsiveContainer width="100%" height={200}>
                                    <PieChart>
                                        <Pie data={m.segments} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={62} outerRadius={88} paddingAngle={2} stroke="none">
                                            {m.segments.map((s, i) => <Cell key={i} fill={SEGMENT_COLORS[i]} />)}
                                        </Pie>
                                        <Tooltip />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                    <span className="text-2xl font-bold" style={{ color: C.darkDesk }}>{formatCount(m.totalUsers)}</span>
                                    <span className="text-xs" style={{ color: C.textSec }}>Total Users</span>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2 mt-4">
                                {m.segments.map((s, i) => (
                                    <div key={i} className="flex items-center justify-between text-sm">
                                        <span className="flex items-center gap-2" style={{ color: C.textSec }}>
                                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEGMENT_COLORS[i] }} />{s.name}
                                        </span>
                                        <span className="font-semibold" style={{ color: C.darkDesk }}>{segTotal ? Math.round((s.value / segTotal) * 100) : 0}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* CUSTOMER HIGHLIGHTS */}
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-bold" style={{ color: C.darkDesk }}>Customer Highlights</h2>
                        {/* <span className="text-sm font-semibold cursor-pointer" style={{ color: C.blue }}>View All</span> */}
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
                        {m.displayed.slice(0, 6).map((u, i) => (
                            <div key={u.userId} className="insight-card rounded-xl bg-surface p-4 flex items-center gap-3" style={{ border: `1px solid ${C.border}` }}>
                                <div className="relative flex-shrink-0">
                                    <Avatar user={u} highlight={i === 0} size={44} />
                                    <span className="absolute -top-1 -right-1 text-[10px] font-bold text-inverse rounded-full px-1.5" style={{ background: C.red }}>#{i + 1}</span>
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-sm truncate" style={{ color: C.darkDesk }}>{u.name}</p>
                                    <p className="text-xs" style={{ color: C.textSec }}>{u.orderCount} Orders</p>
                                    <p className="font-bold text-sm" style={{ color: C.black }}>{formatINR(u.total)}</p>
                                </div>
                            </div>
                        ))}
                        {m.displayed.length === 0 && <p className="text-sm col-span-full" style={{ color: C.textSec }}>No customers yet.</p>}
                    </div>

                    {/* TOP SPENDING TABLE */}
                    <h2 className="text-lg font-bold mb-3" style={{ color: C.darkDesk }}>Top Spending Customers</h2>
                    <div className="rounded-xl overflow-hidden mb-8" style={{ border: `1px solid ${C.border}` }}>
                        <table className="w-full text-sm">
                            <thead>
                                <tr style={{ background: "var(--color-surface-muted)", borderBottom: `2px solid ${C.darkDesk}` }}>
                                    {["RANK", "CUSTOMER NAME", "EMAIL", "ORDERS", "TOTAL SPEND", "AOV", "LAST ORDER"].map((h) => (
                                        <th key={h} className="text-left font-semibold px-4 py-3 text-xs tracking-wide" style={{ color: C.textSec }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {topSpendingPageItems.map((u, i) => {
                                    const rank = (topSpendingSafePage - 1) * PAGE_SIZE + i + 1
                                    const badge = rankBadgeStyle(rank)
                                    return (
                                        <tr key={u.userId} className="table-row" style={{ background: i % 2 === 0 ? "var(--color-surface)" : "var(--color-background)" }}>
                                            <td className="px-4 py-3">
                                                {badge ? (
                                                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold" style={badge}>{rank}</span>
                                                ) : (
                                                    <span className="inline-flex items-center justify-center w-7 h-7 text-sm font-semibold" style={{ color: C.textSec }}>{rank}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-medium" style={{ color: C.darkDesk }}>{u.name}</td>
                                            <td className="px-4 py-3" style={{ fontFamily: MONO, color: C.textSec, fontSize: "12px" }}>{u.email}</td>
                                            <td className="px-4 py-3" style={{ color: C.textSec }}>{u.orderCount}</td>
                                            <td className="px-4 py-3 font-bold" style={{ color: C.darkDesk }}>{formatINR(u.total)}</td>
                                            <td className="px-4 py-3" style={{ color: C.textSec }}>{formatINR(Math.round(u.aov))}</td>
                                            <td className="px-4 py-3" style={{ color: C.textSec }}>{relativeTime(u.lastOrderDate)}</td>
                                        </tr>
                                    )
                                })}
                                {m.displayed.length === 0 && (
                                    <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: C.textSec }}>No customers match the current filters.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {m.displayed.length > 0 && (
                        <Pagination
                            total={m.displayed.length}
                            page={topSpendingSafePage}
                            pageSize={PAGE_SIZE}
                            onPageChange={setTopSpendingPage}
                            itemLabel="customers"
                            accent={C.darkDesk}
                        />
                    )}
                    <div className="mb-8" />

                    {/* DETAILED USER OVERVIEW */}
                    <h2 className="text-lg font-bold mb-3" style={{ color: C.darkDesk }}>Detailed User Overview</h2>
                    <div className="flex flex-col gap-3">
                        {detailedOverviewPageItems.map((u) => (
                            <div key={u.userId} className="rounded-xl bg-surface p-4" style={{ border: `1px solid ${C.border}` }}>
                                <div className="flex items-center gap-4">
                                    <Avatar user={u} highlight={u.userId === m.displayed[0]?.userId} />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold" style={{ color: C.darkDesk }}>{u.name}</p>
                                        <p className="truncate" style={{ fontFamily: MONO, fontSize: "12px", color: C.textSec }}>{u.email}</p>
                                    </div>
                                    <Stat label="JOIN DATE" value={u.createdAt ? u.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"} />
                                    <Stat label="ORDERS" value={u.orderCount} />
                                    <Stat label="TOTAL SPEND" value={formatINR(u.total)} green />
                                    <button onClick={() => toggleExpand(u.userId)} className="flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-lg" style={{ color: C.black, background: "var(--color-info-subtle)" }}>
                                        View Order Details <ChevronDown size={14} className={expanded[u.userId] ? "rotate-180 transition-transform" : "transition-transform"} />
                                    </button>
                                </div>
                                {expanded[u.userId] && (
                                    <div className="mt-4 pt-4 flex flex-col gap-2" style={{ borderTop: `1px solid ${C.border}` }}>
                                        {u.periodOrders.length === 0 ? (
                                            <p className="text-sm" style={{ color: C.textSec }}>No orders in this period.</p>
                                        ) : (
                                            u.periodOrders.map((o) => (
                                                <div key={o.id} onClick={() => openOrder(u, o)} className="flex items-center justify-between text-sm py-2 px-2 -mx-2 rounded-lg cursor-pointer hover:bg-[var(--color-surface-muted)] transition-colors">
                                                    <span style={{ fontFamily: MONO, color: C.textSec, fontSize: "12px" }}>#{o.externalOrderId ? String(o.externalOrderId).replace(/^#/, "") : o.id}</span>
                                                    <span className="font-semibold" style={{ color: C.darkDesk }}>{formatINR(o.total)}</span>
                                                    <span style={{ color: C.textSec }}>{o.date ? o.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                        {m.displayed.length === 0 && (
                            <p className="text-sm text-center py-8" style={{ color: C.textSec }}>No customers match the current filters.</p>
                        )}
                    </div>
                    {m.displayed.length > 0 && (
                        <Pagination
                            total={m.displayed.length}
                            page={detailedOverviewSafePage}
                            pageSize={PAGE_SIZE}
                            onPageChange={setDetailedOverviewPage}
                            itemLabel="customers"
                            accent={C.darkDesk}
                        />
                    )}
                </div>
            </div>

            {/* ============================================================
          MOBILE (<768px)
      ============================================================ */}
            <div className="md:hidden pb-24" style={{ background: C.bg }}>
                <div className="px-4 pt-4">
                    {/* Search */}
                    <div className="flex items-center gap-2 mb-4">
                        <div className="relative flex-1">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.textSec }} />
                            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer..." className="w-full outline-none rounded-xl text-sm bg-surface" style={{ border: `1px solid ${C.border}`, padding: "10px 12px 10px 36px" }} />
                        </div>
                        <button className="p-2.5 rounded-xl bg-surface" style={{ border: `1px solid ${C.border}` }}><Search size={16} style={{ color: C.blue }} /></button>
                    </div>

                    {/* Time filter pills (scrollable) */}
                    <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
                        {FILTERS.map((f) => (
                            <button key={f.key} onClick={() => setFilter(f.key)} className="flex-shrink-0 px-5 py-2 rounded-full text-sm font-semibold"
                                style={filter === f.key ? { background: C.blue, color: "var(--color-inverse)" } : { background: "var(--color-surface)", color: C.textSec, border: `1px solid ${C.border}` }}>
                                {f.label}
                            </button>
                        ))}
                    </div>
                    {filter === "custom" && (
                        <div className="flex items-center gap-2 mb-4">
                            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} max={customTo || undefined} className="flex-1 outline-none rounded-xl text-sm bg-surface px-3 py-2" style={{ border: `1px solid ${C.border}` }} />
                            <span style={{ color: C.textSec }}>to</span>
                            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} min={customFrom || undefined} className="flex-1 outline-none rounded-xl text-sm bg-surface px-3 py-2" style={{ border: `1px solid ${C.border}` }} />
                        </div>
                    )}

                    {/* KPI grid 2-col */}
                    <div className="grid grid-cols-2 gap-3 mb-5">
                        <MobKpi label="Total Users" value={formatCount(m.totalUsers)} trend={m.trends.users} />
                        <MobKpi label="Total Orders" value={m.totalOrders.toLocaleString("en-IN")} trend={m.trends.orders} />
                        <MobKpi label="Total Revenue" value={formatCompactINR(m.totalRevenue)} trend={m.trends.revenue} />
                        <MobKpi label="Avg Order Value" value={formatINR(Math.round(m.aov))} trend={m.trends.aov} />
                        <MobKpi label="Active Customers" value={formatCount(m.activeCustomers)} stable />
                        <div className="rounded-xl p-4" style={{ background: C.blueMob }}>
                            <p className="text-xs text-inverse/80">Top Customer</p>
                            <p className="font-bold text-inverse mt-1 truncate">{m.topSpender?.name || "—"}</p>
                            <p className="font-bold text-inverse text-lg">{formatINR(m.topSpender?.total || 0)}</p>
                        </div>
                    </div>

                    {/* Revenue Trend (bar) */}
                    <div className="rounded-2xl bg-surface p-4 mb-5" style={{ border: `1px solid ${C.border}` }}>
                        <div className="flex items-start justify-between mb-3">
                            <div>
                                <h3 className="font-bold" style={{ color: C.darkMob }}>Revenue Trend</h3>
                                <p className="text-xs" style={{ color: C.textSec }}>Daily performance overview</p>
                            </div>
                            <div className="text-right">
                                <p className="font-bold" style={{ color: m.trends.revenue.up ? C.green : C.red }}>
                                    {m.trends.revenue.up ? "+" : "-"}{m.trends.revenue.pct}%
                                </p>
                                <p className="text-[10px] tracking-wide" style={{ color: C.textSec }}>GROWTH</p>
                            </div>
                        </div>
                        <ResponsiveContainer width="100%" height={150}>
                            <BarChart data={m.revenueSeries.slice(-7)}>
                                <XAxis dataKey="date" hide />
                                <Tooltip formatter={(v) => formatINR(v)} cursor={{ fill: "color-mix(in srgb, var(--color-chart-3) 5%, transparent)" }} />
                                <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                                    {m.revenueSeries.slice(-7).map((d, i, arr) => (
                                        <Cell key={i} fill={i === arr.length - 1 ? "var(--color-chart-3)" : "var(--color-info-subtle)"} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                        <div className="flex justify-between mt-3 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
                            <div><p className="text-[10px] tracking-wide" style={{ color: C.textSec }}>TODAY</p><p className="font-bold" style={{ color: C.darkMob }}>{formatINR(Math.round(m.todayRevenue))}</p></div>
                            <div className="text-right"><p className="text-[10px] tracking-wide" style={{ color: C.textSec }}>THIS PERIOD</p><p className="font-bold" style={{ color: C.darkMob }}>{formatCompactINR(m.totalRevenue)}</p></div>
                        </div>
                    </div>

                    {/* Customer Highlights (swipe) */}
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-bold" style={{ color: C.darkMob }}>Customer Highlights</h3>
                        <span className="text-sm font-semibold" style={{ color: C.blue }}>View All</span>
                    </div>
                    <div className="flex gap-3 overflow-x-auto no-scrollbar mb-5 pb-1">
                        {m.displayed.slice(0, 6).map((u, i) => (
                            <div key={u.userId} className="flex-shrink-0 rounded-2xl bg-surface p-4 flex items-center gap-3" style={{ width: "230px", border: `1px solid ${C.border}` }}>
                                <div className="relative">
                                    <Avatar user={u} highlight={i === 0} size={44} />
                                    <span className="absolute -top-1 -right-1 text-[10px] font-bold text-inverse rounded-full px-1.5" style={{ background: C.blue }}>#{i + 1}</span>
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-sm truncate" style={{ color: C.darkMob }}>{u.name}</p>
                                    <p className="text-xs" style={{ color: C.textSec }}>{u.orderCount} Orders</p>
                                    <p className="font-bold text-sm" style={{ color: C.blue }}>{formatINR(u.total)}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Firestore path visual */}
                    <div className="rounded-2xl bg-surface p-4 mb-5" style={{ border: `1px solid ${C.border}` }}>
                        <div className="flex items-center gap-2 mb-3">
                            <Database size={16} style={{ color: C.blue }} />
                            <span style={{ fontFamily: MONO, fontSize: "12px", color: C.textSec }}>
                                /users/<span style={{ color: C.blue }}>userId</span>/orders
                            </span>
                        </div>
                        <div className="flex items-start gap-3 mb-2">
                            <span className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0" style={{ background: C.blue }}><UserIcon size={14} color="var(--color-inverse)" /></span>
                            <div className="flex-1 rounded-xl p-3" style={{ border: `1px solid ${C.border}` }}>
                                <p className="text-[10px] tracking-wide" style={{ color: C.textSec }}>USER COLLECTION</p>
                                <p className="font-semibold text-sm" style={{ color: C.darkMob }}>Metadata, Auth & Basic Profile</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <span className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0" style={{ background: "var(--color-border)" }}><ShoppingBag size={14} color={C.textSec} /></span>
                            <div className="flex-1 rounded-xl p-3" style={{ border: `1px solid ${C.border}` }}>
                                <p className="text-[10px] tracking-wide" style={{ color: C.textSec }}>ORDERS SUB-COLLECTION</p>
                                <p className="font-semibold text-sm" style={{ color: C.darkMob }}>Nested Transactional History</p>
                            </div>
                        </div>
                    </div>

                    {/* Top Spending leaderboard */}
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="font-bold" style={{ color: C.darkMob }}>Top Spending Customers</h3>
                        <span className="text-xs px-3 py-1 rounded-full" style={{ background: "var(--color-border)", color: C.textSec }}>{FILTERS.find((f) => f.key === filter)?.label}</span>
                    </div>
                    <div className="rounded-2xl bg-surface overflow-hidden mb-4" style={{ border: `1px solid ${C.border}` }}>
                        {(showAllLeaderboard ? m.displayed : m.displayed.slice(0, 5)).map((u, i) => (
                            <div key={u.userId} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
                                <span className="font-bold text-lg w-7" style={{ color: C.blue, opacity: 0.4 }}>{String(i + 1).padStart(2, "0")}</span>
                                <Avatar user={u} highlight={i === 0} size={40} />
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-sm truncate" style={{ color: C.darkMob }}>{u.name}</p>
                                    <p className="text-xs" style={{ color: C.textSec }}>{loyaltyTier(i + 1)}</p>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-sm" style={{ color: C.darkMob }}>{formatCompactINR(u.total)}</p>
                                    <p className="text-xs" style={{ color: C.textSec }}>{u.orderCount} Orders</p>
                                </div>
                            </div>
                        ))}
                        {m.displayed.length === 0 && <p className="px-4 py-6 text-center text-sm" style={{ color: C.textSec }}>No customers found.</p>}
                    </div>
                    {m.displayed.length > 5 && (
                        <button onClick={() => setShowAllLeaderboard((v) => !v)} className="w-full py-3 rounded-xl font-semibold text-sm" style={{ color: C.blue, border: `1px solid ${C.blue}` }}>
                            {showAllLeaderboard ? "Show Less" : "Show Full Leaderboard"}
                        </button>
                    )}
                </div>

                {/* FAB */}
                <button onClick={exportToExcel} aria-label="Export to Excel" className="md:hidden fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-lg" style={{ background: C.blue }}>
                    <Download size={22} color="var(--color-inverse)" />
                </button>
            </div>

            {/* ORDER DETAIL DRAWER — same shared RightDrawer used by the Products Catalog eye icon */}
            <RightDrawer open={!!selectedOrder} onClose={closeOrder} title="Order Detail">
                {displayedOrder && (
                    <>
                        <div className="flex items-center justify-between rounded-xl p-4" style={{ background: C.bg }}>
                            <div>
                                <p className="text-[12px]" style={{ color: C.textSec }}>Order ID</p>
                                <p className="font-bold" style={{ fontFamily: MONO, fontSize: "14px", color: C.darkDesk }}>
                                    #{displayedOrder.externalOrderId ? String(displayedOrder.externalOrderId).replace(/^#/, "") : displayedOrder.id}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-[12px]" style={{ color: C.textSec }}>Order Total</p>
                                <p className="font-bold text-[20px]" style={{ color: C.darkDesk }}>{formatINR(displayedOrder.total)}</p>
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <span className="text-sm" style={{ color: C.textSec }}>Status</span>
                            <span className="text-xs font-bold uppercase px-3 py-1 rounded-full" style={{ background: "var(--color-info-subtle)", color: C.blue }}>{displayedOrder.status}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm" style={{ color: C.textSec }}>Order Date</span>
                            <span className="text-sm font-semibold" style={{ color: C.darkDesk }}>
                                {displayedOrder.date ? displayedOrder.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                            </span>
                        </div>

                        <div>
                            <h4 className="font-bold text-[15px] mb-2" style={{ color: C.darkDesk }}>Customer</h4>
                            <div className="rounded-xl p-3 flex flex-col gap-1" style={{ border: `1px solid ${C.border}` }}>
                                <span className="font-semibold text-sm" style={{ color: C.darkDesk }}>{displayedOrder.customerName || displayedOrder.userName || "Guest"}</span>
                                <span className="text-xs" style={{ fontFamily: MONO, color: C.textSec }}>{displayedOrder.customerEmail || displayedOrder.userEmail || "—"}</span>
                                {displayedOrder.userPhone && <span className="text-xs" style={{ color: C.textSec }}>{displayedOrder.userPhone}</span>}
                            </div>
                        </div>

                        <div>
                            <h4 className="font-bold text-[15px] mb-2" style={{ color: C.darkDesk }}>Items</h4>
                            <div className="rounded-xl p-3 flex flex-col gap-2" style={{ border: `1px solid ${C.border}` }}>
                                {(displayedOrder.items || []).length === 0 && (
                                    <p className="text-sm" style={{ color: C.textSec }}>No item details available.</p>
                                )}
                                {(displayedOrder.items || []).map((it, i) => (
                                    <div key={i} className="flex items-center justify-between text-sm">
                                        <span style={{ color: C.darkDesk }}>{it.title || it.name || "Item"} {it.quantity ? `x${it.quantity}` : ""}</span>
                                        <span className="font-semibold" style={{ color: C.textSec }}>{it.price != null ? formatINR(it.price) : ""}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 className="font-bold text-[15px] mb-2" style={{ color: C.darkDesk }}>Payment & Shipping</h4>
                            <div className="rounded-xl p-3 flex flex-col gap-1" style={{ border: `1px solid ${C.border}` }}>
                                <span className="text-sm" style={{ color: C.textSec }}>Payment: <span style={{ color: C.darkDesk, fontWeight: 600 }}>{displayedOrder.paymentMethod || "—"}</span></span>
                                <span className="text-sm" style={{ color: C.textSec }}>Shipping Address: <span style={{ color: C.darkDesk, fontWeight: 600 }}>{displayedOrder.address || "No address on file"}</span></span>
                            </div>
                        </div>
                    </>
                )}
            </RightDrawer>
        </div>
    )
}

/* ============================================================
   SUB-COMPONENTS
============================================================ */
const KpiCard = ({ label, icon, value, trend, className }) => (
    <div className={`${className} rounded-xl bg-surface p-4`} style={{ border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: C.textSec }}>{label}</span>
            <span style={{ color: C.textSec }}>{icon}</span>
        </div>
        <div className="text-2xl font-bold mb-1" style={{ color: C.darkDesk }}>{value}</div>
        {trend}
    </div>
)

const SummaryStat = ({ label, value, green }) => (
    <div className="text-center">
        <p className="text-xs" style={{ color: C.textSec }}>{label}</p>
        <p className="font-bold" style={{ color: green ? C.green : C.darkDesk }}>{value}</p>
    </div>
)

const Stat = ({ label, value, green }) => (
    <div className="text-center min-w-[90px] hidden lg:block">
        <p className="text-[10px] tracking-wide" style={{ color: C.textSec }}>{label}</p>
        <p className="font-semibold text-sm" style={{ color: green ? C.green : C.darkDesk }}>{value}</p>
    </div>
)

const Avatar = ({ user, highlight, size = 48 }) => {
    const s = { width: size, height: size }
    if (user.photoURL) {
        return <img src={user.photoURL} alt={user.name} className="rounded-full object-cover flex-shrink-0" style={{ ...s, border: highlight ? `2px solid ${C.green}` : "none" }} />
    }
    return (
        <span className="rounded-full flex items-center justify-center flex-shrink-0 font-bold text-inverse" style={{ ...s, background: avatarColor(user.name), border: highlight ? `2px solid ${C.green}` : "none", fontSize: size * 0.36 }}>
            {initials(user.name)}
        </span>
    )
}

const MobKpi = ({ label, value, trend, stable }) => (
    <div className="kpi-card rounded-xl bg-surface p-4" style={{ border: `1px solid ${C.border}` }}>
        <p className="text-xs" style={{ color: C.textSec }}>{label}</p>
        <div className="flex items-end gap-1.5 mt-1">
            <span className="text-xl font-bold" style={{ color: C.darkMob }}>{value}</span>
            {stable ? (
                <span className="text-xs font-semibold mb-0.5" style={{ color: C.textSec }}>Stable</span>
            ) : (
                <span className="text-xs font-semibold mb-0.5" style={{ color: trend.up ? C.green : C.red }}>{trend.up ? "+" : "-"}{trend.pct}%</span>
            )}
        </div>
    </div>
)

export default AllUsersOrdersAnalytics