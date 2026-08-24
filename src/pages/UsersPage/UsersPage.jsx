import { useEffect, useState, useRef, useMemo } from "react"
import { supabase } from "../../context/SupabaseConfig"
import { toast } from "react-toastify"
import {
  Users,
  UserPlus,
  Shield,
  Zap,
  Search,
  Filter,
  CircleDot,
  Calendar,
  AlignLeft,
  Upload,
  MoreVertical,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  X,
  Mail,
  MessageSquare,
  Phone,
  Info,
  KeyRound,
  Ban,
  Check,
} from "lucide-react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

/* ============================== CONSTANTS ============================== */
const ITEMS_PER_PAGE = 10
const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', 'Liberation Mono', monospace"

// const ROLE_OPTIONS = ["all", "admin", "user", "strategist", "director", "operator"]
const ROLE_OPTIONS = ["all", "admin", "user"]
const STATUS_OPTIONS = ["all", "active", "pending", "suspended", "inactive"]
const SORT_OPTIONS = [
  { key: "createdAt", label: "Newest First" },
  { key: "oldest", label: "Oldest First" },
  { key: "name", label: "Name (A–Z)" },
  { key: "role", label: "Role" },
]

/* ============================== HELPERS ============================== */
const toDate = (v) => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}
const fmtDate = (v) => {
  const d = toDate(v)
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "—"
}
const relativeTime = (v) => {
  const d = toDate(v)
  if (!d) return "Never"
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins} min${mins > 1 ? "s" : ""} ago`
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
}
const initials = (name) =>
  String(name || "?").trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?"

const GRADIENTS = [
  ["var(--color-primary)", "var(--color-accent)"],
  ["var(--color-info)", "var(--color-info-border)"],
  ["var(--color-chart-6)", "color-mix(in srgb, var(--color-chart-6) 55%, white)"],
  ["var(--color-chart-7)", "var(--color-error-border)"],
  ["var(--color-accent-strong)", "var(--color-accent)"],
  ["var(--color-success)", "var(--color-success)"],
]
const gradientFor = (name) => {
  const s = String(name || "x")
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  const [a, b] = GRADIENTS[Math.abs(h) % GRADIENTS.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}

const roleOf = (u) => (u.role || "user").toLowerCase()
const statusOf = (u) => (u.status || "active").toLowerCase()
const networkIdOf = (u) => u.networkId || `EX-${String(u.id || "").slice(0, 6).toUpperCase()}`

const ROLE_BADGE = {
  admin: { bg: "var(--color-info-subtle)", color: "var(--color-info)" },
     strategist: { bg: "var(--color-info-subtle)", color: "var(--color-info)" },
     director: { bg: "var(--color-accent-subtle)", color: "var(--color-accent-strong)" },
     operator: { bg: "var(--color-accent-subtle)", color: "var(--color-accent-strong)" },
  user: { bg: "var(--color-surface-muted)", color: "var(--color-body)" },
}
const roleBadge = (r) => ROLE_BADGE[r] || ROLE_BADGE.user

const STATUS_BADGE = {
  active: { bg: "var(--color-success-subtle)", dot: "var(--color-success)", color: "var(--color-success)" },
  pending: { bg: "var(--color-accent-subtle)", dot: "var(--color-accent-strong)", color: "var(--color-accent-strong)" },
  suspended: { bg: "var(--color-error-subtle)", dot: "var(--color-error)", color: "var(--color-error)" },
  inactive: { bg: "var(--color-surface-muted)", dot: "var(--color-muted)", color: "var(--color-body)" },
}
const statusBadge = (s) => STATUS_BADGE[s] || STATUS_BADGE.inactive

/* Build a compact page list with ellipsis (max 5 numbers + last page). */
const buildPages = (page, totalPages) => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages = []
  let start = Math.max(1, page - 2)
  let end = Math.min(totalPages, start + 4)
  start = Math.max(1, end - 4)
  for (let p = start; p <= end; p++) pages.push(p)
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push("…")
    pages.push(totalPages)
  }
  if (start > 1) pages.unshift("…")
  return pages
}

/* ============================== COMPONENT ============================== */
const UsersPage = () => {
  const [usersData, setUsersData] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [globalSearch, setGlobalSearch] = useState("")
  const [filterSearch, setFilterSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [sortBy, setSortBy] = useState("createdAt")
  const [dateStart, setDateStart] = useState("")
  const [dateEnd, setDateEnd] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [openMenu, setOpenMenu] = useState(null) // "role" | "status" | "sort" | "date"
  const [rowMenu, setRowMenu] = useState(null) // { user, top, left } — fixed-position actions popover

  // KPI stats
  const [totalUsers, setTotalUsers] = useState(0)
  const [newRegistrations, setNewRegistrations] = useState(0)
  const [adminCount, setAdminCount] = useState(0)
  const [activeCount, setActiveCount] = useState(0)

  const drawerRef = useRef(null)
  const containerRef = useRef(null)

  /* ---------------- REALTIME USERS + KPIs ---------------- */
  useEffect(() => {
    // Read all users and sort client-side. (orderBy("createdAt") would silently
    // drop legacy docs missing the field.)
         const fetchUsers = async () => {
       const { data, error } = await supabase.from("profiles").select("*")
       if (error) { console.error("profiles fetch:", error); return }
       setUsersData(data || [])
       setLoading(false)
       const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
       setTotalUsers((data || []).length)
       setNewRegistrations((data || []).filter((u) => { const d = toDate(u.created_at); return d && d.getTime() >= cutoff }).length)
       setAdminCount((data || []).filter((u) => roleOf(u) === "admin").length)
       setActiveCount((data || []).filter((u) => statusOf(u) === "active").length)
     }
     fetchUsers()
     const channel = supabase
       .channel("admin-users-realtime")
       .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, fetchUsers)
       .subscribe()
     return () => { supabase.removeChannel(channel) }
  }, [])

  /* ---------------- FILTER + SORT ---------------- */
  const filteredUsers = useMemo(() => {
    const g = globalSearch.toLowerCase()
    const f = filterSearch.toLowerCase()
    const startMs = dateStart ? new Date(dateStart).getTime() : null
    const endMs = dateEnd ? new Date(dateEnd).getTime() + 86400000 : null // inclusive end day

    const list = usersData.filter((u) => {
      const matchesGlobal =
        !g ||
        u.name?.toLowerCase().includes(g) ||
        u.email?.toLowerCase().includes(g) ||
        networkIdOf(u).toLowerCase().includes(g)
      const matchesFilter =
        !f || u.name?.toLowerCase().includes(f) || u.email?.toLowerCase().includes(f)
      const matchesRole = roleFilter === "all" || roleOf(u) === roleFilter
      const matchesStatus = statusFilter === "all" || statusOf(u) === statusFilter
      const created = toDate(u.createdAt)?.getTime() ?? null
      const matchesDate =
        (!startMs || (created != null && created >= startMs)) &&
        (!endMs || (created != null && created < endMs))
      return matchesGlobal && matchesFilter && matchesRole && matchesStatus && matchesDate
    })

    list.sort((a, b) => {
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "")
      if (sortBy === "role") return roleOf(a).localeCompare(roleOf(b))
      const ad = toDate(a.createdAt)?.getTime() || 0
      const bd = toDate(b.createdAt)?.getTime() || 0
      return sortBy === "oldest" ? ad - bd : bd - ad
    })
    return list
  }, [usersData, globalSearch, filterSearch, roleFilter, statusFilter, sortBy, dateStart, dateEnd])

  // Reset to page 1 whenever the filter set changes.
  useEffect(() => { setCurrentPage(1) }, [globalSearch, filterSearch, roleFilter, statusFilter, sortBy, dateStart, dateEnd])

  // The row actions popover is fixed-positioned, so close it on scroll to avoid drift.
  useEffect(() => {
    if (!rowMenu) return
    const close = () => setRowMenu(null)
    window.addEventListener("scroll", close, true)
    return () => window.removeEventListener("scroll", close, true)
  }, [rowMenu])

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedUsers = filteredUsers.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)
  const showingFrom = filteredUsers.length === 0 ? 0 : (safePage - 1) * ITEMS_PER_PAGE + 1
  const showingTo = Math.min(safePage * ITEMS_PER_PAGE, filteredUsers.length)

  /* ---------------- PER-USER ORDER STATS ----------------
     Reads the pre-computed customer_stats aggregate (same data, no full scan). */
   const fetchUserStats = async (userId) => {
     try {
       const { data: stat } = await supabase.from("customer_stats").select("*").eq("user_id", userId).single()
       if (stat) {
         setSelectedUser((prev) =>
           prev && prev.id === userId
             ? { ...prev, totalSpent: Number(stat.total_spent || 0), orderCount: Number(stat.total_orders || 0) }
             : prev
         )
       }
     } catch (e) {
       console.log("user stats", e)
     }
   }

/* ---------------- DRAWER ---------------- */
  const openUser = (user) => {
    setSelectedUser({ ...user, totalSpent: undefined, orderCount: undefined })
    setDrawerOpen(true)
    fetchUserStats(user.id)
  }
  const closeDrawer = () => {
    if (drawerRef.current) {
      gsap.to(drawerRef.current, {
        right: -400, duration: 0.25, ease: "power3.in",
        onComplete: () => { setDrawerOpen(false); setSelectedUser(null) },
      })
    } else {
      setDrawerOpen(false); setSelectedUser(null)
    }
  }
  useEffect(() => {
    if (drawerOpen && drawerRef.current) {
      gsap.fromTo(drawerRef.current, { right: -400 }, { right: 0, duration: 0.35, ease: "power3.out" })
    }
  }, [drawerOpen])

  /* ---------------- ADMIN ACTIONS ---------------- */
  const suspendUser = async (user) => {
     try {
       const { error } = await supabase.from("profiles").update({ status: "suspended" }).eq("id", user.id)
       if (error) throw error
       toast.success(`${user.name || "User"} suspended.`)
       if (selectedUser?.id === user.id) closeDrawer()
     } catch (e) {
       console.log(e); toast.error("Could not suspend account.")
     }
   }
  const deleteUser = async (user) => {
     if (!window.confirm(`Delete ${user.name || "this user"}? This cannot be undone.`)) return
     try {
       const { error } = await supabase.from("profiles").delete().eq("id", user.id)
       if (error) throw error
       toast.success("User deleted.")
       if (selectedUser?.id === user.id) closeDrawer()
     } catch (e) {
       console.log(e); toast.error("Could not delete user.")
     }
   }
 
  const resetKeys = async (user) => {
    // Old behavior: fired a success toast unconditionally with no backend/email call at all -
    // functions/ has no user-management or email route, so nothing was ever sent.
    // Fixed to genuinely dispatch via Supabase Auth built-in reset email and only toast
    // success once that call resolves; failures surface as errors.
    if (!user.email) {
      toast.error("Cannot reset security keys: no email on file for this user.")
      return
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email)
      if (error) throw error
      toast.success(`Security key reset link sent to ${user.email}.`)
    } catch (e) {
      console.error("resetKeys: resetPasswordForEmail failed", { recipient: user.email, message: e.message })
      toast.error(`Could not send reset email to ${user.email}: ${e.message || "unknown error"}`)
    }
  }

  /* ---------------- CSV EXPORT ---------------- */
  const exportCSV = () => {
    if (!filteredUsers.length) { toast.info("No entities to export."); return }
    const headers = ["Name", "Email", "Role", "Status", "Date Added", "Last Login", "Network ID"]
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const rows = filteredUsers.map((u) =>
      [u.name || "", u.email || "", roleOf(u), statusOf(u), fmtDate(u.createdAt),
       u.lastLoginAt != null ? relativeTime(u.lastLoginAt) : "Never", networkIdOf(u)].map(esc).join(",")
    )
    const csv = [headers.map(esc).join(","), ...rows].join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `nexus_entities_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${filteredUsers.length} entities.`)
  }

  /* ---------------- ANIMATIONS ---------------- */
  useGSAP(() => {
    if (loading) return
    gsap.from(".stat-card", { y: 30, opacity: 0, stagger: 0.1, duration: 0.6, ease: "power3.out" })
  }, { scope: containerRef, dependencies: [loading] })

  useGSAP(() => {
    if (loading) return
    gsap.from(".table-row", { opacity: 0, y: 10, stagger: 0.03, duration: 0.3, ease: "power2.out" })
  }, { scope: containerRef, dependencies: [safePage, filteredUsers.length, roleFilter, statusFilter, sortBy] })

  /* ============================== STATS CARD CONFIG ============================== */
  const cards = [
    { icon: Users, label: "TOTAL USERS", value: totalUsers, trend: "+12%", dir: "up" },
    { icon: UserPlus, label: "NEW REGISTRATIONS", value: newRegistrations, trend: "+8%", dir: "up" },
    { icon: Shield, label: "ADMINISTRATORS", value: adminCount, trend: "Neutral", dir: "neutral" },
    { icon: Zap, label: "ACTIVE USERS", value: activeCount, trend: "-2%", dir: "down" },
  ]

  /* ============================== SHARED STYLES ============================== */
  const glassCard = {
    background: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
    boxShadow: "0px 8px 32px rgba(139,92,246,0.08)",
    backdropFilter: "blur(10px)",
  }
  const pillBtn = {
    background: "var(--color-surface-muted)",
    border: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)",
    borderRadius: "48px",
    padding: "10px 16px",
    color: "var(--color-body)",
    fontFamily: INTER,
    fontSize: "15px",
  }
  const menuStyle = {
    position: "absolute", top: "calc(100% + 8px)", zIndex: 40, minWidth: "180px",
    background: "var(--color-surface)", borderRadius: "16px", border: "1px solid color-mix(in srgb, var(--color-border) 40%, transparent)",
    boxShadow: "0px 12px 32px rgba(29,26,35,0.12)", padding: "8px", fontFamily: INTER,
  }
  const menuItem = "w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-[var(--color-surface-muted)] transition-colors capitalize"

  /* ============================== LOADING ============================== */
  if (loading) {
    const bar = (style) => <div aria-hidden="true" className="animate-pulse" style={{ background: "var(--color-surface-muted)", borderRadius: "8px", ...style }} />
    return (
      <div className="relative min-h-screen overflow-x-hidden" style={{ background: "var(--color-background)", fontFamily: INTER }} aria-busy="true">
        <div className="flex flex-col p-10 pt-[96px] sm:pt-10" style={{ gap: "24px" }}>
          {/* SECTION 1 — STAT CARDS */}
          <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: "24px" }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ ...glassCard, borderRadius: "32px", padding: "24px", height: "170px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div className="flex items-start justify-between">
                  {bar({ width: "46px", height: "46px", borderRadius: "16px" })}
                  {bar({ width: "48px", height: "16px" })}
                </div>
                <div className="flex flex-col" style={{ gap: "8px" }}>
                  {bar({ width: "60%", height: "12px" })}
                  {bar({ width: "45%", height: "30px" })}
                </div>
              </div>
            ))}
          </div>

          {/* FILTER BAR */}
          <div className="flex items-center justify-between" style={{ ...glassCard, borderRadius: "16px", padding: "16px" }}>
            <div className="flex flex-wrap items-center" style={{ gap: "12px" }}>
              {bar({ width: "256px", height: "45px", borderRadius: "48px" })}
              {bar({ width: "96px", height: "40px", borderRadius: "48px" })}
              {bar({ width: "96px", height: "40px", borderRadius: "48px" })}
              {bar({ width: "120px", height: "40px", borderRadius: "48px" })}
            </div>
            <div className="flex items-center" style={{ gap: "12px" }}>
              {bar({ width: "88px", height: "40px", borderRadius: "48px" })}
              {bar({ width: "100px", height: "40px", borderRadius: "48px" })}
            </div>
          </div>

          {/* TABLE */}
          <div style={{ background: "var(--color-surface)", border: "1px solid color-mix(in srgb, var(--color-border) 10%, transparent)", boxShadow: "0px 8px 32px rgba(139,92,246,0.08)", borderRadius: "32px", padding: "32px" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "24px" }}>
              {bar({ width: "220px", height: "32px" })}
              {bar({ width: "90px", height: "16px" })}
            </div>
            {/* Column headers */}
            <div className="flex items-center" style={{ gap: "24px", paddingBottom: "16px", borderBottom: "1px solid color-mix(in srgb, var(--color-border) 20%, transparent)" }}>
              <div style={{ minWidth: "232px", flex: 2 }}>{bar({ width: "120px", height: "12px" })}</div>
              {[...Array(5)].map((_, i) => (
                <div key={i} style={{ flex: 1 }}>{bar({ width: "70px", height: "12px" })}</div>
              ))}
              <div style={{ width: "40px" }} />
            </div>
            {/* Rows */}
            {[...Array(8)].map((_, r) => (
              <div key={r} className="flex items-center" style={{ gap: "24px", padding: "24px 0", borderTop: "1px solid color-mix(in srgb, var(--color-border) 10%, transparent)" }}>
                <div className="flex items-center" style={{ gap: "16px", minWidth: "232px", flex: 2 }}>
                  {bar({ width: "48px", height: "48px", borderRadius: "9999px", flexShrink: 0 })}
                  <div className="flex flex-col" style={{ gap: "6px", flex: 1 }}>
                    {bar({ width: "70%", height: "16px" })}
                    {bar({ width: "40%", height: "12px" })}
                  </div>
                </div>
                <div style={{ flex: 1 }}>{bar({ width: "80%", height: "14px" })}</div>
                <div style={{ flex: 1 }}>{bar({ width: "70%", height: "14px" })}</div>
                <div style={{ flex: 1 }}>{bar({ width: "56px", height: "22px", borderRadius: "9999px" })}</div>
                <div style={{ flex: 1 }}>{bar({ width: "68px", height: "22px", borderRadius: "9999px" })}</div>
                <div style={{ flex: 1 }}>{bar({ width: "60%", height: "14px" })}</div>
                <div style={{ width: "40px" }}>{bar({ width: "24px", height: "24px", borderRadius: "9999px" })}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  /* ============================== RENDER ============================== */
  return (
    <div ref={containerRef} className="relative min-h-screen overflow-x-hidden" style={{ background: "var(--color-background)", fontFamily: INTER }}>
      {/* Main content — shifts left when the drawer is open */}
      <div
        className="flex flex-col p-10 pt-[96px] sm:pt-10"
        style={{ gap: "24px", transition: "margin-right 0.35s ease", marginRight: drawerOpen ? "424px" : "0px" }}
      >
        {/* ---------------- SECTION 1 — STATS (all four in one row) ---------------- */}
        <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: "24px" }}>
          {cards.map((c) => {
            const Icon = c.icon
            return (
              <div key={c.label} className="stat-card flex flex-col justify-between" style={{ ...glassCard, borderRadius: "32px", padding: "24px", height: "170px" }}>
                <div className="flex items-start justify-between">
                  <div style={{ background: "color-mix(in srgb, var(--color-accent) 10%, transparent)", borderRadius: "16px", padding: "12px" }}>
                    <Icon size={22} style={{ color: "var(--color-primary)" }} />
                  </div>
                  <div className="flex items-center" style={{ gap: "4px" }}>
                    {c.dir === "up" && <ArrowUp size={13} style={{ color: "var(--color-success)" }} />}
                    {c.dir === "down" && <ArrowDown size={13} style={{ color: "var(--color-error)" }} />}
                    <span style={{ fontSize: "16px", color: c.dir === "up" ? "var(--color-success)" : c.dir === "down" ? "var(--color-error)" : "var(--color-body)" }}>{c.trend}</span>
                  </div>
                </div>
                <div className="flex flex-col" style={{ gap: "4px" }}>
                  <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-body)", letterSpacing: "1.2px", textTransform: "uppercase" }}>{c.label}</span>
                  <span style={{ fontWeight: 600, fontSize: "32px", color: "var(--color-ink)", letterSpacing: "1.6px" }}>{c.value.toLocaleString()}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* ---------------- SECTION 3 — FILTER BAR ---------------- */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3" style={{ ...glassCard, borderRadius: "16px", padding: "16px", position: "relative", zIndex: 36 }}>
          {/* Left controls */}
          <div className="flex flex-wrap items-center" style={{ gap: "12px" }}>
            <div className="relative">
              <Search size={16} className="absolute" style={{ left: "16px", top: "50%", transform: "translateY(-50%)", color: "var(--color-muted)" }} />
              <input
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Filter roster..."
                className="outline-none"
                style={{ width: "256px", maxWidth: "100%", height: "45px", background: "var(--color-surface-muted)", border: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)", borderRadius: "48px", padding: "12px 16px 12px 40px", fontSize: "14px", color: "var(--color-ink)" }}
              />
            </div>

            {/* Role */}
            <div className="relative">
              <button onClick={() => setOpenMenu(openMenu === "role" ? null : "role")} className="flex items-center" style={{ ...pillBtn, gap: "8px" }}>
                <Filter size={16} /> {roleFilter === "all" ? "Role" : roleFilter[0].toUpperCase() + roleFilter.slice(1)}
              </button>
              {openMenu === "role" && (
                <div style={{ ...menuStyle, left: 0 }}>
                  {ROLE_OPTIONS.map((r) => (
                    <button key={r} className={menuItem} style={{ color: roleFilter === r ? "var(--color-primary)" : "var(--color-body)", fontWeight: roleFilter === r ? 600 : 400 }}
                      onClick={() => { setRoleFilter(r); setOpenMenu(null) }}>{r === "all" ? "All Roles" : r}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Status */}
            <div className="relative">
              <button onClick={() => setOpenMenu(openMenu === "status" ? null : "status")} className="flex items-center" style={{ ...pillBtn, gap: "8px" }}>
                <CircleDot size={16} /> {statusFilter === "all" ? "Status" : statusFilter[0].toUpperCase() + statusFilter.slice(1)}
              </button>
              {openMenu === "status" && (
                <div style={{ ...menuStyle, left: 0 }}>
                  {STATUS_OPTIONS.map((s) => (
                    <button key={s} className={menuItem} style={{ color: statusFilter === s ? "var(--color-primary)" : "var(--color-body)", fontWeight: statusFilter === s ? 600 : 400 }}
                      onClick={() => { setStatusFilter(s); setOpenMenu(null) }}>{s === "all" ? "All Statuses" : s}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Date Range */}
            <div className="relative">
              <button onClick={() => setOpenMenu(openMenu === "date" ? null : "date")} className="flex items-center" style={{ ...pillBtn, gap: "8px", ...(dateStart || dateEnd ? { color: "var(--color-primary)", borderColor: "color-mix(in srgb, var(--color-accent) 30%, transparent)" } : null) }}>
                <Calendar size={16} /> Date Range
              </button>
              {openMenu === "date" && (
                <div style={{ ...menuStyle, left: 0, minWidth: "240px" }} className="flex flex-col gap-3 p-4">
                  <label className="flex flex-col gap-1" style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                    From
                    <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="outline-none" style={{ border: "1px solid color-mix(in srgb, var(--color-border) 40%, transparent)", borderRadius: "10px", padding: "8px 10px", fontSize: "13px", color: "var(--color-ink)" }} />
                  </label>
                  <label className="flex flex-col gap-1" style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                    To
                    <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="outline-none" style={{ border: "1px solid color-mix(in srgb, var(--color-border) 40%, transparent)", borderRadius: "10px", padding: "8px 10px", fontSize: "13px", color: "var(--color-ink)" }} />
                  </label>
                  <button onClick={() => { setDateStart(""); setDateEnd("") }} className="text-sm" style={{ color: "var(--color-primary)", fontWeight: 600 }}>Clear dates</button>
                </div>
              )}
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center" style={{ gap: "12px" }}>
            <div className="relative">
              <button onClick={() => setOpenMenu(openMenu === "sort" ? null : "sort")} className="flex items-center" style={{ ...pillBtn, gap: "8px" }}>
                <AlignLeft size={16} /> Sort
              </button>
              {openMenu === "sort" && (
                <div style={{ ...menuStyle, right: 0 }}>
                  {SORT_OPTIONS.map((o) => (
                    <button key={o.key} className={menuItem} style={{ color: sortBy === o.key ? "var(--color-primary)" : "var(--color-body)", fontWeight: sortBy === o.key ? 600 : 400 }}
                      onClick={() => { setSortBy(o.key); setOpenMenu(null) }}>{o.label}</button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={exportCSV} className="flex items-center" style={{ background: "color-mix(in srgb, var(--color-accent) 5%, transparent)", border: "1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)", borderRadius: "48px", padding: "10px 16px", gap: "8px", color: "var(--color-primary)", fontWeight: 600, fontSize: "15px" }}>
              <Upload size={16} style={{ color: "var(--color-primary)" }} /> Export
            </button>
          </div>
        </div>

        {/* ---------------- SECTION 4 — TABLE ---------------- */}
        <div style={{ background: "var(--color-surface)", border: "1px solid color-mix(in srgb, var(--color-border) 10%, transparent)", boxShadow: "0px 8px 32px rgba(139,92,246,0.08)", borderRadius: "32px", padding: "32px" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: "24px" }}>
            <h2 style={{ fontWeight: 600, fontSize: "32px", color: "var(--color-ink)", letterSpacing: "1.6px" }}>Entity Roster</h2>
            <div className="flex items-center" style={{ gap: "8px" }}>
              <span style={{ width: "8px", height: "8px", background: "var(--color-success)", boxShadow: "0px 0px 8px color-mix(in srgb, var(--color-success) 60%, transparent)", borderRadius: "4px" }} />
              <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-success)", letterSpacing: "1.2px" }}>LIVE SYNC</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  {["USER PROFILE", "EMAIL", "DATE ADDED", "ROLE", "STATUS", "LAST LOGIN"].map((h) => (
                    <th key={h} style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-muted)", letterSpacing: "1.2px", textTransform: "uppercase", padding: "1px 24px 16px", borderBottom: "1px solid color-mix(in srgb, var(--color-border) 20%, transparent)" }}>{h}</th>
                  ))}
                  <th style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-muted)", letterSpacing: "1.2px", textTransform: "uppercase", padding: "1px 24px 16px", borderBottom: "1px solid color-mix(in srgb, var(--color-border) 20%, transparent)", textAlign: "right" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map((u) => {
                  const rb = roleBadge(roleOf(u))
                  const sb = statusBadge(statusOf(u))
                  return (
                    <tr key={u.id} className="table-row cursor-pointer transition-colors hover:bg-[var(--color-surface-muted)]" style={{ borderTop: "1px solid color-mix(in srgb, var(--color-border) 10%, transparent)" }} onClick={() => openUser(u)}>
                      {/* USER PROFILE */}
                      <td style={{ padding: "24px", minWidth: "232px" }}>
                        <div className="flex items-center" style={{ gap: "16px" }}>
                          <div className="flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ width: "48px", height: "48px", borderRadius: "9999px", border: "2px solid color-mix(in srgb, var(--color-accent) 10%, transparent)", background: u.photoURL ? "transparent" : gradientFor(u.name) }}>
                            {u.photoURL ? <img src={u.photoURL} alt={u.name} className="w-full h-full object-cover" /> : <span style={{ fontWeight: 700, fontSize: "18px", color: "var(--color-inverse)" }}>{initials(u.name)}</span>}
                          </div>
                          <div className="flex flex-col">
                            <span style={{ fontWeight: 600, fontSize: "16px", color: "var(--color-ink)", lineHeight: 1.2 }}>{u.name || "Unknown"}</span>
                            <span style={{ fontWeight: 400, fontSize: "14px", color: "var(--color-muted)" }}>ID: {networkIdOf(u)}</span>
                          </div>
                        </div>
                      </td>
                      {/* EMAIL */}
                      <td style={{ padding: "24px", fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>{u.email || "—"}</td>
                      {/* DATE ADDED */}
                      <td style={{ padding: "24px", fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>{fmtDate(u.createdAt)}</td>
                      {/* ROLE */}
                      <td style={{ padding: "24px" }}>
                        <span style={{ background: rb.bg, color: rb.color, borderRadius: "9999px", padding: "2.5px 12px", fontWeight: 700, fontSize: "12px", letterSpacing: "-0.3px", textTransform: "uppercase" }}>{roleOf(u)}</span>
                      </td>
                      {/* STATUS */}
                      <td style={{ padding: "24px" }}>
                        <span className="inline-flex items-center" style={{ gap: "6px", background: sb.bg, color: sb.color, borderRadius: "9999px", padding: "4px 12px", fontWeight: 700, fontSize: "12px", letterSpacing: "-0.3px", textTransform: "capitalize" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "9999px", background: sb.dot }} /> {statusOf(u)}
                        </span>
                      </td>
                      {/* LAST LOGIN */}
                      <td style={{ padding: "24px", fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>{u.lastLoginAt != null ? relativeTime(u.lastLoginAt) : "Never"}</td>
                      {/* ACTIONS */}
                      <td style={{ padding: "24px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect()
                            setRowMenu(rowMenu?.user.id === u.id ? null : { user: u, top: r.bottom + 6, left: r.right - 184 })
                          }}
                          className="hover:bg-[var(--color-surface-muted)] transition-colors"
                          style={{ borderRadius: "9999px", padding: "8px" }}
                        >
                          <MoreVertical size={18} style={{ color: "var(--color-muted)" }} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {paginatedUsers.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: "48px", textAlign: "center", color: "var(--color-muted)", fontSize: "15px" }}>No entities match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINATION */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4" style={{ marginTop: "24px" }}>
            <span style={{ fontWeight: 400, fontSize: "14px", color: "var(--color-muted)" }}>
              Showing {showingFrom} to {showingTo} of {filteredUsers.length} entries
            </span>
            <div className="flex items-center" style={{ gap: "8px" }}>
              <button disabled={safePage === 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="flex items-center justify-center" style={{ width: "40px", height: "40px", border: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)", borderRadius: "32px", opacity: safePage === 1 ? 0.5 : 1, cursor: safePage === 1 ? "not-allowed" : "pointer" }}>
                <ChevronLeft size={16} style={{ color: "var(--color-body)" }} />
              </button>
              {buildPages(safePage, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`e${i}`} style={{ color: "var(--color-muted)", padding: "0 4px" }}>…</span>
                ) : (
                  <button key={p} onClick={() => setCurrentPage(p)} className="flex items-center justify-center" style={{ minWidth: "40px", height: "40px", borderRadius: "32px", fontWeight: 600, fontSize: "14px", ...(p === safePage ? { background: "var(--color-primary)", color: "var(--color-inverse)" } : { color: "var(--color-body)" }) }}>{p}</button>
                )
              )}
              <button disabled={safePage === totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="flex items-center justify-center" style={{ width: "40px", height: "40px", border: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)", borderRadius: "32px", opacity: safePage === totalPages ? 0.5 : 1, cursor: safePage === totalPages ? "not-allowed" : "pointer" }}>
                <ChevronRight size={16} style={{ color: "var(--color-body)" }} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Click-away backdrop for any open dropdown */}
      {(openMenu || rowMenu) && <div className="fixed inset-0" style={{ zIndex: 35 }} onClick={() => { setOpenMenu(null); setRowMenu(null) }} />}

      {/* Row actions popover (fixed so the table's overflow can't clip it) */}
      {rowMenu && (
        <div style={{ position: "fixed", top: rowMenu.top, left: rowMenu.left, zIndex: 46, minWidth: "184px", background: "var(--color-surface)", borderRadius: "16px", border: "1px solid color-mix(in srgb, var(--color-border) 40%, transparent)", boxShadow: "0px 12px 32px rgba(29,26,35,0.12)", padding: "8px", fontFamily: INTER }}>
          <button className={menuItem} style={{ color: "var(--color-body)" }} onClick={() => { const u = rowMenu.user; setRowMenu(null); openUser(u) }}>View Details</button>
          <button className={menuItem} style={{ color: "var(--color-body)" }} onClick={() => { const u = rowMenu.user; setRowMenu(null); resetKeys(u) }}>Reset Security Keys</button>
          <button className={menuItem} style={{ color: "var(--color-accent-strong)" }} onClick={() => { const u = rowMenu.user; setRowMenu(null); suspendUser(u) }}>Suspend Account</button>
          <button className={menuItem} style={{ color: "var(--color-error)" }} onClick={() => { const u = rowMenu.user; setRowMenu(null); deleteUser(u) }}>Delete User</button>
        </div>
      )}

      {/* ---------------- ENTITY DETAILS DRAWER ---------------- */}
      <div
        ref={drawerRef}
        style={{ position: "fixed", top: "88px", right: "-400px", height: "calc(100vh - 88px)", width: "400px", maxWidth: "100vw", background: "var(--color-surface)", zIndex: 45, boxShadow: "-12px 0 40px rgba(29,26,35,0.12)", display: "flex", flexDirection: "column" }}
      >
        {selectedUser && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid color-mix(in srgb, var(--color-border) 20%, transparent)", padding: "32px" }}>
              <h3 style={{ fontWeight: 600, fontSize: "20px", color: "var(--color-ink)", letterSpacing: "0.4px" }}>Entity Details</h3>
              <button onClick={closeDrawer} className="hover:bg-[var(--color-surface-muted)] transition-colors" style={{ borderRadius: "9999px", padding: "8px" }}>
                <X size={14} style={{ color: "var(--color-muted)" }} />
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-col overflow-y-auto" style={{ padding: "32px", gap: "40px" }}>
              {/* Profile header */}
              <div className="flex flex-col items-center" style={{ gap: "16px" }}>
                <div className="flex items-center justify-center overflow-hidden" style={{ width: "96px", height: "96px", borderRadius: "9999px", border: "4px solid color-mix(in srgb, var(--color-accent) 10%, transparent)", background: selectedUser.photoURL ? "transparent" : gradientFor(selectedUser.name) }}>
                  {selectedUser.photoURL ? <img src={selectedUser.photoURL} alt={selectedUser.name} className="w-full h-full object-cover" /> : <span style={{ fontWeight: 700, fontSize: "32px", color: "var(--color-inverse)" }}>{initials(selectedUser.name)}</span>}
                </div>
                <div className="flex flex-col items-center" style={{ gap: "2px" }}>
                  <span style={{ fontWeight: 600, fontSize: "20px", color: "var(--color-ink)", letterSpacing: "0.4px", textAlign: "center" }}>{selectedUser.name || "Unknown"}</span>
                  <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-primary)", letterSpacing: "1.2px", textTransform: "uppercase" }}>{roleOf(selectedUser)}</span>
                </div>
                <div className="flex items-center justify-center" style={{ gap: "8px" }}>
                  <a href={`mailto:${selectedUser.email || ""}`} className="flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--color-accent) 10%, transparent)", borderRadius: "48px", padding: "10px" }}><Mail size={20} style={{ color: "var(--color-primary)" }} /></a>
                  <button onClick={() => toast.info("Messaging is not configured yet.")} className="flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--color-accent) 10%, transparent)", borderRadius: "48px", padding: "10px" }}><MessageSquare size={20} style={{ color: "var(--color-primary)" }} /></button>
                  <button onClick={() => toast.info("No phone number on file.")} className="flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--color-accent) 10%, transparent)", borderRadius: "48px", padding: "10px" }}><Phone size={20} style={{ color: "var(--color-primary)" }} /></button>
                </div>
              </div>

              {/* Detailed stats */}
              <div className="flex" style={{ gap: "16px" }}>
                <div className="flex-1 flex flex-col" style={{ background: "var(--color-surface-muted)", borderRadius: "16px", padding: "16px", gap: "4px" }}>
                  <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-muted)", letterSpacing: "1.2px" }}>Total Spent</span>
                  <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-ink)" }}>{selectedUser.totalSpent === undefined ? "…" : `₹${Number(selectedUser.totalSpent).toLocaleString("en-IN")}`}</span>
                </div>
                <div className="flex-1 flex flex-col" style={{ background: "var(--color-surface-muted)", borderRadius: "16px", padding: "16px", gap: "4px" }}>
                  <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-muted)", letterSpacing: "1.2px" }}>Orders</span>
                  <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-ink)" }}>{selectedUser.orderCount === undefined ? "…" : selectedUser.orderCount}</span>
                </div>
              </div>

              {/* Registry data */}
              <div className="flex flex-col" style={{ gap: "24px" }}>
                <div className="flex items-center" style={{ gap: "8px" }}>
                  <Info size={16} style={{ color: "var(--color-body)" }} />
                  <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-body)" }}>Registry Data</span>
                </div>
                {(() => {
                  const s = statusOf(selectedUser)
                  const statusText = s === "active" ? "Verified" : s[0].toUpperCase() + s.slice(1)
                  const statusColor = s === "active" ? "var(--color-success)" : s === "pending" ? "var(--color-accent-strong)" : s === "suspended" ? "var(--color-error)" : "var(--color-body)"
                  const rows = [
                    { label: "Network ID", value: networkIdOf(selectedUser), color: "var(--color-ink)", font: INTER, weight: 600 },
                    { label: "Status", value: statusText, color: statusColor, font: INTER, weight: 600 },
                    { label: "Last IP", value: selectedUser.lastIP || "—", color: "var(--color-ink)", font: MONO, weight: 400 },
                    { label: "Joined", value: fmtDate(selectedUser.createdAt), color: "var(--color-ink)", font: INTER, weight: 600 },
                  ]
                  return rows.map((r) => (
                    <div key={r.label} className="flex items-center justify-between" style={{ borderBottom: "1px solid color-mix(in srgb, var(--color-border) 10%, transparent)", paddingBottom: "8px" }}>
                      <span style={{ fontWeight: 400, fontSize: "14px", color: "var(--color-muted)" }}>{r.label}</span>
                      <span style={{ fontWeight: r.weight, fontSize: "14px", color: r.color, fontFamily: r.font }}>{r.value}</span>
                    </div>
                  ))
                })()}
              </div>

              {/* Administrative controls */}
              <div className="flex flex-col" style={{ gap: "16px" }}>
                <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-body)" }}>Administrative Controls</span>
                <button onClick={() => resetKeys(selectedUser)} className="flex items-center justify-center w-full" style={{ background: "var(--color-surface-muted)", borderRadius: "48px", height: "48px", gap: "8px" }}>
                  <KeyRound size={19} style={{ color: "var(--color-ink)" }} />
                  <span style={{ fontWeight: 600, fontSize: "16px", color: "var(--color-ink)" }}>Reset Security Keys</span>
                </button>
                <button onClick={() => suspendUser(selectedUser)} className="flex items-center justify-center w-full" style={{ background: "var(--color-error-subtle)", borderRadius: "48px", height: "48px", gap: "8px" }}>
                  <Ban size={17} style={{ color: "var(--color-error)" }} />
                  <span style={{ fontWeight: 600, fontSize: "16px", color: "var(--color-error)" }}>Suspend Account</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


export default UsersPage