import { useState, useRef, useEffect, useMemo } from "react"
import Papa from "papaparse"
import { useSelector } from "react-redux"
import {
  collection, addDoc, doc, setDoc, getDoc, getDocs, increment, Timestamp,
  onSnapshot, query, orderBy, limit, serverTimestamp,
} from "firebase/firestore"
import { fireDB } from "../../context/FirebaseConfig"
import {
  Upload, UploadCloud, CheckCircle2, XCircle, Clock, HelpCircle,
  Download, TableProperties, AlertCircle, ArrowUp,
} from "lucide-react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

/* ============================== STYLE TOKENS ============================== */
const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', 'Geist Mono', monospace"
const glass = {
  background: "rgba(255,255,255,0.85)",
  border: "1px solid rgba(255,255,255,0.5)",
  boxShadow: "0px 10px 30px rgba(0,0,0,0.03)",
  backdropFilter: "blur(10px)",
}

/* ============================== HELPERS ============================== */
const toJsDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null)
const bytesToMB = (n) => (Number(n || 0) / 1024 / 1024).toFixed(1)
const fmtClock = (d) => (d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "")
const relativeTime = (d) => {
  if (!d) return ""
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), days = Math.floor(diff / 86400000)
  if (m < 1) return "Just now"
  if (m < 60) return `${m} min ago`
  if (h < 24) return `${h} hr${h > 1 ? "s" : ""} ago`
  if (days === 1) return "Yesterday"
  return `${days} days ago`
}
const slug = (s) => String(s || "unknown").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown"
const REQUIRED_COLS = ["order_id", "customer_id", "product", "price", "qty"]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const AdminUploadOrders = () => {
  const currentUser = useSelector((s) => s.user?.user)
  const actorName = currentUser?.name || "Admin"

  /* ---------------- STATE ---------------- */
  const [uploadSessions, setUploadSessions] = useState([])
  const [activityLog, setActivityLog] = useState([])
  const [importAnalytics, setImportAnalytics] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [previewData, setPreviewData] = useState([])
  const [columnsValid, setColumnsValid] = useState(false)
  const [idsSanitized, setIdsSanitized] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [hoverBar, setHoverBar] = useState(null)
  const [config, setConfig] = useState({ replaceExisting: false, appendRecords: true, autoValidate: true })

  const fileInputRef = useRef(null)
  const progressFillRef = useRef(null)
  const containerRef = useRef(null)
  const intervalRef = useRef(null)

  /* ---------------- REALTIME LISTENERS ---------------- */
  useEffect(() => {
    const unsubSessions = onSnapshot(
      query(collection(fireDB, "uploadSessions"), orderBy("createdAt", "desc"), limit(10)),
      (snap) => setUploadSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.log("uploadSessions", err)
    )
    const unsubLog = onSnapshot(
      query(collection(fireDB, "activityLog"), orderBy("timestamp", "desc"), limit(8)),
      (snap) => setActivityLog(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.log("activityLog", err)
    )
    getDocs(collection(fireDB, "importAnalytics"))
      .then((snap) => setImportAnalytics(snap.docs.map((d) => d.data())))
      .catch((e) => console.log("importAnalytics", e))
    return () => { unsubSessions(); unsubLog() }
  }, [])

  /* ---------------- DERIVED KPIs (from uploadSessions) ---------------- */
  const kpis = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const todayImports = uploadSessions.filter((s) => { const d = toJsDate(s.createdAt); return d && d >= todayStart }).length
    const pending = uploadSessions.filter((s) => s.status === "pending").length
    const failed = uploadSessions.filter((s) => s.status === "failed").length
    const totalRecords = uploadSessions.reduce((a, s) => a + (Number(s.recordCount) || 0), 0)
    const totalSuccess = uploadSessions.reduce((a, s) => a + (Number(s.successCount) || 0), 0)
    const successRate = totalRecords > 0 ? ((totalSuccess / totalRecords) * 100).toFixed(1) : "0.0"
    return { todayImports, pending, failed, successRate }
  }, [uploadSessions])

  /* ---------------- IMPORT ANALYTICS (collection, else derived from sessions) ---------------- */
  const chartData = useMemo(() => {
    if (importAnalytics.length) {
      const max = Math.max(...importAnalytics.map((d) => Number(d.count) || 0), 1)
      return { bars: importAnalytics.map((d) => ({ label: d.date, count: Number(d.count) || 0 })), max }
    }
    // Fallback: orders imported per day over the last 7 days, from uploadSessions.
    const buckets = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i)
      buckets.push({ key: d.toISOString().slice(0, 10), label: WEEKDAYS[d.getDay()], count: 0 })
    }
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]))
    uploadSessions.forEach((s) => {
      const d = toJsDate(s.createdAt); if (!d) return
      const k = d.toISOString().slice(0, 10)
      if (byKey[k]) byKey[k].count += Number(s.recordCount) || 0
    })
    const max = Math.max(...buckets.map((b) => b.count), 1)
    return { bars: buckets, max }
  }, [importAnalytics, uploadSessions])

  const growth = useMemo(() => {
    const now = Date.now(), week = 7 * 86400000
    let cur = 0, prev = 0
    uploadSessions.forEach((s) => {
      const d = toJsDate(s.createdAt); if (!d) return
      const age = now - d.getTime()
      if (age <= week) cur += Number(s.recordCount) || 0
      else if (age <= 2 * week) prev += Number(s.recordCount) || 0
    })
    if (prev === 0) return cur > 0 ? "+100%" : "0%"
    const pct = ((cur - prev) / prev) * 100
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
  }, [uploadSessions])

  /* ---------------- ACTIVITY LOG WRITER ---------------- */
  const logActivity = (event, type) =>
    addDoc(collection(fireDB, "activityLog"), { event, actor: actorName, timestamp: serverTimestamp(), type }).catch((e) => console.log(e))

  /* ---------------- CSV PARSE + VALIDATION ---------------- */
  const parseFile = (file) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (results) => {
        const headers = results.meta.fields || []
        const hasAll = REQUIRED_COLS.every((c) => headers.includes(c))
        setColumnsValid(hasAll)

        const rows = results.data.map((r) => {
          const orderId = (r.order_id || "").trim()
          const isValidId = orderId.startsWith("#ORD-") && orderId.length > 5
          const isValidCustomer = !!(r.customer_id || "").trim()
          const isValidPrice = !isNaN(parseFloat(r.price)) && parseFloat(r.price) > 0
          const isValidQty = !isNaN(parseInt(r.qty)) && parseInt(r.qty) > 0
          const valid = isValidId && isValidCustomer && isValidPrice && isValidQty
          return {
            order_id: orderId,
            customer_id: (r.customer_id || "").trim(),
            product: (r.product || "").trim(),
            price: r.price,
            qty: r.qty,
            rawStatus: (r.status || "").trim(),
            status: valid ? "VALID" : "INVALID",
            errorType: !isValidId ? "ID" : !isValidCustomer ? "CUSTOMER" : !isValidPrice ? "PRICE" : !isValidQty ? "QTY" : null,
          }
        })
        const withId = rows.filter((r) => r.order_id)
        setIdsSanitized(withId.length > 0 && withId.every((r) => r.status === "VALID"))
        setPreviewData(rows)
        logActivity("Validation Completed", "success")
      },
      error: (err) => { console.log(err); setPreviewData([]); setColumnsValid(false); setIdsSanitized(false) },
    })
  }

  const handleFile = (file) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith(".csv")) { alert("Please select a .csv file"); return }
    setSelectedFile(file)
    setUploadProgress(0)
    parseFile(file)
  }

  /* ---------------- DRAG & DROP ---------------- */
  const onDrop = (e) => { e.preventDefault(); setIsDragOver(false); handleFile(e.dataTransfer.files?.[0]) }

  /* ---------------- UPLOAD ---------------- */
  const handleUpload = () => {
    if (!selectedFile || isUploading) return
    setIsUploading(true)
    setUploadProgress(0)
    let progress = 0
    intervalRef.current = setInterval(() => {
      progress += Math.random() * 8 + 2
      if (progress >= 95) { clearInterval(intervalRef.current); progress = 95 }
      setUploadProgress(Math.min(Math.floor(progress), 95))
    }, 150)
    finishUpload()
  }

  const finishUpload = async () => {
    try {
      const validRows = previewData.filter((r) => r.status === "VALID")
      const userMap = {}
      try {
        const usersSnap = await getDocs(collection(fireDB, "users"))
        usersSnap.forEach((d) => { const u = d.data(); userMap[d.id] = { name: u.name || "User", email: u.email || "" } })
      } catch { /* names fall back below */ }

      // Group valid rows by CSV order_id → one real order per group.
      const groups = {}
      validRows.forEach((r, i) => { const k = r.order_id || `row_${i}`; (groups[k] = groups[k] || []).push(r) })

      const now = new Date()
      const dailyAgg = {}, monthlyAgg = {}, yearlyAgg = {}, prodAgg = {}, custAgg = {}
      const orderDocs = [], invLogs = []

      Object.values(groups).forEach((rws) => {
        const master = rws[0]
        const uid = String(master.customer_id)
        const products = rws.map((r) => ({
          productId: slug(r.product),
          title: r.product || "Unknown Product",
          price: Number(r.price) || 0,
          quantity: Number(r.qty) || 1,
          category: "imported",
        }))
        const total = Math.round(products.reduce((s, p) => s + p.price * p.quantity, 0))
        const totalItems = products.reduce((s, p) => s + p.quantity, 0)
        const orderRef = doc(collection(fireDB, "orders"))
        orderDocs.push({
          ref: orderRef,
          data: {
            orderId: orderRef.id,
            externalOrderId: master.order_id,
            userId: uid,
            userName: userMap[uid]?.name || "Imported User",
            userEmail: userMap[uid]?.email || "",
            total, totalItems,
            paymentMethod: "Imported",
            paymentStatus: "paid",
            orderStatus: (master.rawStatus || "delivered").toLowerCase(),
            createdAt: Timestamp.fromDate(now),
            products,
            _imported: true,
          },
        })
        const day = now.toISOString().slice(0, 10), month = day.slice(0, 7), year = day.slice(0, 4)
        ;(dailyAgg[day] = dailyAgg[day] || { revenue: 0, orders: 0 }).revenue += total; dailyAgg[day].orders++
        ;(monthlyAgg[month] = monthlyAgg[month] || { revenue: 0, orders: 0 }).revenue += total; monthlyAgg[month].orders++
        ;(yearlyAgg[year] = yearlyAgg[year] || { revenue: 0, orders: 0 }).revenue += total; yearlyAgg[year].orders++
        const ca = custAgg[uid] = custAgg[uid] || { name: userMap[uid]?.name || "Imported User", email: userMap[uid]?.email || "", orders: 0, spent: 0 }
        ca.orders++; ca.spent += total
        products.forEach((p) => {
          const pa = prodAgg[p.productId] = prodAgg[p.productId] || { title: p.title, category: p.category, orders: 0, revenue: 0, qty: 0 }
          pa.orders++; pa.revenue += p.price * p.quantity; pa.qty += p.quantity
          invLogs.push({ productId: p.productId, change: -p.quantity, reason: "import", createdAt: Timestamp.fromDate(now), _imported: true })
        })
      })

      // Write real orders + aggregates (keeps the analytics dashboards consistent).
      for (const od of orderDocs) await setDoc(od.ref, od.data)
      for (const [day, v] of Object.entries(dailyAgg)) await setDoc(doc(fireDB, "analytics", "daily", "stats", day), { date: day, revenue: increment(v.revenue), orders: increment(v.orders) }, { merge: true })
      for (const [month, v] of Object.entries(monthlyAgg)) await setDoc(doc(fireDB, "analytics", "monthly", "stats", month), { month, revenue: increment(v.revenue), orders: increment(v.orders) }, { merge: true })
      for (const [year, v] of Object.entries(yearlyAgg)) await setDoc(doc(fireDB, "analytics", "yearly", "stats", year), { year, revenue: increment(v.revenue), orders: increment(v.orders) }, { merge: true })
      for (const [pid, v] of Object.entries(prodAgg)) await setDoc(doc(fireDB, "productStats", pid), { title: v.title, category: v.category, totalOrders: increment(v.orders), totalRevenue: increment(v.revenue), totalQuantity: increment(v.qty), lastSoldAt: Timestamp.fromDate(now) }, { merge: true })
      for (const [uid, v] of Object.entries(custAgg)) {
        const cRef = doc(fireDB, "customerStats", uid)
        const cSnap = await getDoc(cRef)
        const newO = (cSnap.exists() ? cSnap.data().totalOrders || 0 : 0) + v.orders
        const newS = (cSnap.exists() ? cSnap.data().totalSpent || 0 : 0) + v.spent
        await setDoc(cRef, { name: v.name, email: v.email, totalOrders: newO, totalSpent: newS, avgOrderValue: newO > 0 ? Math.round(newS / newO) : 0, lastOrderDate: Timestamp.fromDate(now) }, { merge: true })
      }
      for (const lg of invLogs) await addDoc(collection(fireDB, "inventoryLogs"), lg)

      // Upload session (drives Upload History + KPIs)
      const failCount = previewData.length - validRows.length
      await addDoc(collection(fireDB, "uploadSessions"), {
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        status: failCount > 0 && validRows.length === 0 ? "failed" : "success",
        uploadedBy: actorName,
        createdAt: serverTimestamp(),
        recordCount: previewData.length,
        successCount: validRows.length,
        failCount,
        config,
      })
      await logActivity(`Imported ${orderDocs.length} order(s) from ${selectedFile.name}`, "upload")

      if (intervalRef.current) clearInterval(intervalRef.current)
      setUploadProgress(100)
      setTimeout(() => {
        setIsUploading(false)
        setSelectedFile(null)
        setPreviewData([])
        setColumnsValid(false)
        setIdsSanitized(false)
        setUploadProgress(0)
      }, 700)
    } catch (err) {
      console.error(err)
      if (intervalRef.current) clearInterval(intervalRef.current)
      setIsUploading(false)
      logActivity(`Upload failed: ${selectedFile?.name || "file"}`, "error")
    }
  }

  /* ---------------- TEMPLATE DOWNLOAD ---------------- */
  const downloadTemplate = () => {
    const headers = ["order_id", "customer_email", "sku", "unit_price", "qty", "customer_id"]
    const sample = ["#ORD-1001", "buyer@example.com", "SKU-001", "499", "2", "user_abc123"]
    const csv = `${headers.join(",")}\n${sample.join(",")}\n`
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }))
    const a = document.createElement("a")
    a.href = url; a.download = "order_import_template.csv"; a.click()
    URL.revokeObjectURL(url)
    logActivity("Template Downloaded", "success")
  }

  /* ---------------- PROGRESS BAR ANIMATION ---------------- */
  useEffect(() => {
    if (progressFillRef.current) gsap.to(progressFillRef.current, { width: `${uploadProgress}%`, duration: 0.3, ease: "power2.out" })
  }, [uploadProgress])

  /* ---------------- ENTRANCE ANIMATIONS ---------------- */
  useGSAP(() => {
    gsap.from(".kpi-card", { y: 20, opacity: 0, stagger: 0.1, duration: 0.5, ease: "power3.out" })
    gsap.from(".upload-card", { y: 30, opacity: 0, duration: 0.6, ease: "power3.out", delay: 0.2 })
    gsap.from(".sidebar-card", { x: 30, opacity: 0, stagger: 0.15, duration: 0.5, ease: "power3.out", delay: 0.3 })
  }, { scope: containerRef })

  useGSAP(() => {
    gsap.from(".analytics-bar", { scaleY: 0, stagger: 0.08, duration: 0.6, ease: "power3.out", transformOrigin: "bottom" })
  }, { scope: containerRef, dependencies: [chartData.bars.length] })

  /* ============================== SMALL UI PIECES ============================== */
  const Toggle = ({ on, onClick }) => (
    <button onClick={onClick} className="flex-shrink-0" style={{ width: "40px", height: "20px", borderRadius: "9999px", background: on ? "#A43B31" : "#F6F3F2", position: "relative", transition: "background 0.2s" }}>
      <span style={{ position: "absolute", top: "2px", left: on ? "22px" : "2px", width: "16px", height: "16px", borderRadius: "9999px", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
    </button>
  )

  const statusVisual = (s) => {
    if (s === "success") return { bg: "#6CF8BB", color: "#00714D", Icon: CheckCircle2, label: "SUCCESS" }
    if (s === "active" || s === "pending") return { bg: "#A43B31", color: "#fff", Icon: Upload, label: s === "pending" ? "PENDING" : "ACTIVE" }
    return { bg: "#FFDAD6", color: "#93000A", Icon: XCircle, label: "FAILED" }
  }
  const dotColor = (t) => ({ success: "#A43B31", upload: "#A43B31", warning: "#855000", error: "#BA1A1A" }[t] || "#A43B31")

  const configCards = [
    { key: "replaceExisting", title: "Replace Existing", sub: "Overwrite duplicate IDs" },
    { key: "appendRecords", title: "Append Records", sub: "Add as new entries" },
    { key: "autoValidate", title: "Auto Validate", sub: "AI-powered checks" },
  ]

  const visiblePreview = previewData.slice(0, 10)

  /* ============================== RENDER ============================== */
  return (
    <div ref={containerRef} className="min-h-screen p-8 pt-[96px] sm:pt-8" style={{ background: "#F8F7F4", fontFamily: INTER }}>
      {/* SECTION 1 — KPI CARDS */}
      <div className="flex flex-wrap justify-center" style={{ gap: "10px", marginBottom: "32px" }}>
        {[
          { label: "Today's Imports", value: kpis.todayImports.toLocaleString(), trend: <><ArrowUp size={10} style={{ color: "#A43B31" }} /><span style={{ color: "#A43B31", fontWeight: 700, fontSize: "10px" }}>+12%</span></> },
          { label: "Pending", value: kpis.pending, trend: <><Clock size={10} style={{ color: "#855000" }} /><span style={{ color: "#855000", fontWeight: 700, fontSize: "10px" }}>In Queue</span></> },
          { label: "Success", value: `${kpis.successRate}%`, trend: <><CheckCircle2 size={10} style={{ color: "#A43B31" }} /><span style={{ color: "#A43B31", fontWeight: 700, fontSize: "10px" }}>Optimized</span></> },
          { label: "Failed", value: kpis.failed, trend: <><AlertCircle size={10} style={{ color: "#BA1A1A" }} /><span style={{ color: "#BA1A1A", fontWeight: 700, fontSize: "10px" }}>Data Error</span></> },
        ].map((c) => (
          <div key={c.label} className="kpi-card flex flex-col justify-between" style={{ ...glass, borderRadius: "24px", padding: "16px", width: "140px", height: "109px" }}>
            <span style={{ fontWeight: 500, fontSize: "12px", color: "#44474C" }}>{c.label}</span>
            <span style={{ fontWeight: 700, fontSize: "24px", color: "#1B1C1C" }}>{c.value}</span>
            <div className="flex items-center" style={{ gap: "4px" }}>{c.trend}</div>
          </div>
        ))}
      </div>

      {/* TWO-COLUMN LAYOUT */}
      <div className="flex flex-col lg:flex-row" style={{ gap: "24px" }}>
        {/* LEFT COLUMN */}
        <div className="flex flex-col min-w-0 lg:flex-1" style={{ gap: "24px", width: "100%" }}>
          {/* UPLOAD CARD */}
          <div className="upload-card" style={{ ...glass, borderRadius: "48px", padding: "32px" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "32px" }}>
              <div className="flex items-center" style={{ gap: "16px" }}>
                <div className="flex items-center justify-center" style={{ width: "48px", height: "48px", background: "#A43B31", borderRadius: "16px", boxShadow: "0px 10px 15px -3px rgba(107,56,212,0.2)" }}>
                  <Upload size={16} style={{ color: "#fff" }} />
                </div>
                <span style={{ fontSize: "16px", color: "#1B1C1C" }}>Bulk Order Import</span>
              </div>
              <button onClick={downloadTemplate} className="flex items-center" style={{ gap: "6px" }}>
                <HelpCircle size={13} style={{ color: "#A43B31" }} />
                <span style={{ fontWeight: 700, fontSize: "14px", color: "#A43B31" }}>View Guide</span>
              </button>
            </div>

            {/* DROP ZONE */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center text-center cursor-pointer"
              style={{ height: "320px", borderRadius: "32px", border: `3px dashed ${isDragOver ? "#A43B31" : "#E4E2E1"}`, background: isDragOver ? "rgba(107,56,212,0.04)" : "rgba(255,255,255,0.4)", gap: "16px", transition: "all 0.2s" }}
            >
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
              {selectedFile ? (
                <>
                  <div className="flex items-center justify-center" style={{ width: "80px", height: "80px", borderRadius: "9999px", background: "#A43B31" }}>
                    <CheckCircle2 size={33} style={{ color: "#fff" }} />
                  </div>
                  <span style={{ fontSize: "16px", color: "#1B1C1C", fontWeight: 700 }}>{selectedFile.name}</span>
                  <span style={{ fontSize: "14px", color: "#44474C" }}>{bytesToMB(selectedFile.size)} MB • {previewData.length} rows parsed</span>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-center" style={{ width: "80px", height: "80px", borderRadius: "9999px", background: "#F6F3F2" }}>
                    <UploadCloud size={33} style={{ color: "#44474C" }} />
                  </div>
                  <span style={{ fontSize: "16px", color: "#1B1C1C" }}>Drag &amp; Drop CSV File Here</span>
                  <span style={{ fontSize: "14px", color: "#44474C" }}>Or click to browse from your computer. Maximum file size is 50 MB.</span>
                  <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }} style={{ background: "#A43B31", borderRadius: "9999px", padding: "12px 32px", fontWeight: 700, fontSize: "14px", color: "#fff", letterSpacing: "0.35px" }}>Select CSV File</button>
                </>
              )}
            </div>

            {/* PROGRESS */}
            {isUploading && (
              <div style={{ background: "#F3EBF8", borderRadius: "24px", padding: "24px", marginTop: "24px" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
                  <span style={{ fontWeight: 700, fontSize: "14px", color: "#1B1C1C" }}>Uploading: {selectedFile?.name}</span>
                  <span style={{ fontWeight: 700, fontSize: "14px", color: "#A43B31" }}>{uploadProgress}%</span>
                </div>
                <div style={{ background: "#F6F3F2", height: "8px", borderRadius: "9999px", overflow: "hidden" }}>
                  <div ref={progressFillRef} style={{ height: "100%", width: "0%", borderRadius: "9999px", background: "linear-gradient(90deg,#A43B31 0%,#A43B31 50%,#A43B31 100%)" }} />
                </div>
              </div>
            )}

            {/* DEPLOY BUTTON */}
            {selectedFile && !isUploading && (
              <button onClick={handleUpload} className="w-full flex items-center justify-center" style={{ marginTop: "24px", background: "#1B1C1C", color: "#fff", borderRadius: "9999px", padding: "16px", fontWeight: 700, fontSize: "14px", letterSpacing: "0.35px", gap: "8px" }}>
                <Upload size={16} /> Deploy {previewData.filter((r) => r.status === "VALID").length} Valid Orders
              </button>
            )}
          </div>

          {/* VALIDATION & PREVIEW TABLE */}
          <div style={{ ...glass, borderRadius: "32px", overflow: "hidden" }}>
            <div className="flex items-center justify-between" style={{ background: "rgba(248,241,254,0.5)", borderBottom: "1px solid #E4E2E1", padding: "24px" }}>
              <div className="flex items-center" style={{ gap: "10px" }}>
                <TableProperties size={18} style={{ color: "#A43B31" }} />
                <span style={{ fontWeight: 700, fontSize: "16px", color: "#1B1C1C" }}>Data Validation &amp; Preview</span>
              </div>
              <div className="flex items-center" style={{ gap: "16px" }}>
                {columnsValid && <span className="flex items-center" style={{ gap: "4px" }}><CheckCircle2 size={12} style={{ color: "#A43B31" }} /><span style={{ fontWeight: 700, fontSize: "12px", color: "#A43B31" }}>Columns OK</span></span>}
                {idsSanitized && <span className="flex items-center" style={{ gap: "4px" }}><CheckCircle2 size={12} style={{ color: "#A43B31" }} /><span style={{ fontWeight: 700, fontSize: "12px", color: "#A43B31" }}>IDs Sanitized</span></span>}
              </div>
            </div>

            <div style={{ maxHeight: "435px", overflowY: "auto" }}>
              <table className="w-full" style={{ borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                  <tr style={{ background: "rgba(231,224,237,0.9)", borderBottom: "1px solid #E4E2E1" }}>
                    {["ORDER ID", "CUSTOMER ID", "PRODUCT", "PRICE", "QTY", "STATUS"].map((h) => (
                      <th key={h} style={{ textAlign: "left", fontWeight: 700, fontSize: "10px", color: "#44474C", textTransform: "uppercase", letterSpacing: "1px", padding: "16px 24px" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiblePreview.map((r, i) => {
                    const invalidId = r.errorType === "ID" || !r.order_id
                    return (
                      <tr key={i} style={{ borderTop: "1px solid #E4E2E1" }}>
                        <td style={{ padding: "16px 24px", fontFamily: MONO, fontSize: "14px", color: invalidId ? "#BA1A1A" : "#1B1C1C" }}>{invalidId ? "#ERR-VOID" : r.order_id}</td>
                        <td style={{ padding: "16px 24px", fontWeight: 500, fontSize: "14px", color: "#1B1C1C" }}>{r.customer_id || "—"}</td>
                        <td style={{ padding: "16px 24px", fontSize: "14px", color: "#1B1C1C" }}>{r.product || "—"}</td>
                        <td style={{ padding: "16px 24px", fontSize: "14px", color: "#1B1C1C" }}>{isNaN(parseFloat(r.price)) ? "—" : `$${parseFloat(r.price).toLocaleString()}`}</td>
                        <td style={{ padding: "16px 24px", fontSize: "14px", color: "#1B1C1C" }}>{r.qty || "—"}</td>
                        <td style={{ padding: "16px 24px" }}>
                          {r.status === "VALID" ? (
                            <span style={{ background: "#6CF8BB", color: "#00714D", borderRadius: "9999px", padding: "2.5px 10px", fontWeight: 700, fontSize: "10px", textTransform: "uppercase" }}>Valid</span>
                          ) : (
                            <span className="inline-flex items-center" style={{ gap: "4px", background: "#FFDAD6", color: "#93000A", borderRadius: "9999px", padding: "2.5px 10px", fontWeight: 700, fontSize: "10px", textTransform: "uppercase" }}>
                              <AlertCircle size={9} /> Invalid {r.errorType || "ID"}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {previewData.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: "56px", textAlign: "center", color: "#44474C", fontSize: "14px" }}>Select a CSV file to preview and validate rows.</td></tr>
                  )}
                </tbody>
              </table>
              {previewData.length > 10 && (
                <p style={{ padding: "12px 24px", textAlign: "center", fontSize: "12px", color: "#44474C" }}>… and {previewData.length - 10} more rows</p>
              )}
            </div>
          </div>

          {/* IMPORT CONFIGURATION */}
          <div style={{ ...glass, borderRadius: "32px", padding: "24px" }}>
            <h3 style={{ fontWeight: 700, fontSize: "16px", color: "#1B1C1C", marginBottom: "24px" }}>Import Configuration</h3>
            <div className="flex flex-col sm:flex-row" style={{ gap: "24px" }}>
              {configCards.map((c) => (
                <div key={c.key} className="flex items-center justify-between flex-1" style={{ background: "#F6F3F2", border: "1px solid #E4E2E1", borderRadius: "16px", padding: "16px", minHeight: "104px" }}>
                  <div className="flex flex-col" style={{ gap: "4px" }}>
                    <span style={{ fontWeight: 700, fontSize: "14px", color: "#1B1C1C" }}>{c.title}</span>
                    <span style={{ fontWeight: 400, fontSize: "10px", color: "#44474C" }}>{c.sub}</span>
                  </div>
                  <Toggle on={config[c.key]} onClick={() => setConfig((p) => ({ ...p, [c.key]: !p[c.key] }))} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN — cards stacked vertically; becomes the fixed sidebar on desktop */}
        <div className="flex flex-col gap-6 lg:flex-shrink-0 lg:max-w-[384px]" style={{ width: "100%" }}>
          {/* UPLOAD HISTORY */}
          <div className="sidebar-card" style={{ ...glass, borderRadius: "32px", padding: "24px" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "24px" }}>
              <span style={{ fontWeight: 700, fontSize: "16px", color: "#1B1C1C" }}>Upload History</span>
              <button style={{ fontWeight: 700, fontSize: "12px", color: "#A43B31" }}>See All</button>
            </div>
            <div className="flex flex-col" style={{ gap: "12px" }}>
              {uploadSessions.length === 0 && <p style={{ fontSize: "12px", color: "#44474C" }}>No uploads yet.</p>}
              {uploadSessions.slice(0, 3).map((s) => {
                const v = statusVisual(s.status)
                return (
                  <div key={s.id} className="flex items-center" style={{ gap: "12px", padding: "12px", borderRadius: "16px", background: "rgba(248,241,254,0.4)" }}>
                    <div className="flex items-center justify-center flex-shrink-0" style={{ width: "32px", height: "40px", borderRadius: "12px", background: v.bg }}>
                      <v.Icon size={12} style={{ color: v.color }} />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="truncate" style={{ fontWeight: 700, fontSize: "12px", color: "#1B1C1C" }}>{s.fileName || "upload.csv"}</span>
                      <span style={{ fontWeight: 400, fontSize: "10px", color: "#44474C" }}>{bytesToMB(s.fileSize)} MB • {relativeTime(toJsDate(s.createdAt))}</span>
                    </div>
                    <span style={{ background: v.bg, color: v.color, borderRadius: "9999px", padding: "2px 8px", fontWeight: 700, fontSize: "8px", letterSpacing: "0.8px", textTransform: "uppercase" }}>{v.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* IMPORT ANALYTICS */}
          <div className="sidebar-card" style={{ ...glass, borderRadius: "32px", padding: "24px" }}>
            <span style={{ fontWeight: 700, fontSize: "16px", color: "#1B1C1C" }}>Import Analytics</span>
            <p style={{ fontWeight: 400, fontSize: "12px", color: "#44474C" }}>Orders Imported Per Day</p>
            <div className="flex items-end justify-center" style={{ height: "160px", padding: "20px 0 12px", gap: "8px" }}>
              {chartData.bars.map((b, i) => {
                const isCurrent = i === chartData.bars.length - 1
                const h = Math.max(4, (b.count / chartData.max) * 128)
                return (
                  <div key={i} className="relative flex flex-col items-center" style={{ justifyContent: "flex-end", height: "128px", flex: 1, minWidth: 0 }}
                    onMouseEnter={() => setHoverBar(i)} onMouseLeave={() => setHoverBar(null)}>
                    {hoverBar === i && (
                      <div style={{ position: "absolute", top: "-26px", background: "#322F39", borderRadius: "4px", padding: "4px 8px", color: "#F5EEFB", fontSize: "10px", whiteSpace: "nowrap" }}>{b.count} orders</div>
                    )}
                    <div className="analytics-bar" style={{ width: "100%", maxWidth: "43px", height: `${h}px`, borderRadius: "8px 8px 0 0", background: isCurrent ? "#A43B31" : `rgba(107,56,212,${0.1 + (b.count / chartData.max) * 0.3})`, boxShadow: isCurrent ? "0px 10px 15px -3px rgba(107,56,212,0.3)" : "none" }} />
                    <span style={{ fontSize: "9px", color: "#44474C", marginTop: "6px" }}>{b.label}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center justify-between" style={{ borderTop: "1px solid #E4E2E1", paddingTop: "16px", marginTop: "4px" }}>
              <div className="flex flex-col">
                <span style={{ fontWeight: 700, fontSize: "10px", color: "#44474C", textTransform: "uppercase", letterSpacing: "1px" }}>Success Rate</span>
                <span style={{ fontWeight: 700, fontSize: "18px", color: "#A43B31" }}>{kpis.successRate}%</span>
              </div>
              <div className="flex flex-col items-end">
                <span style={{ fontWeight: 700, fontSize: "10px", color: "#44474C", textTransform: "uppercase", letterSpacing: "1px" }}>Growth</span>
                <span style={{ fontWeight: 700, fontSize: "18px", color: "#1B1C1C" }}>{growth}</span>
              </div>
            </div>
          </div>

          {/* CSV TEMPLATE */}
          <div className="sidebar-card relative" style={{ background: "#A43B31", border: "1px solid rgba(255,255,255,0.5)", boxShadow: "0px 10px 30px rgba(0,0,0,0.03)", borderRadius: "32px", padding: "24px", minHeight: "307px", overflow: "hidden", isolation: "isolate" }}>
            <div style={{ position: "absolute", top: "-47px", right: "-47px", width: "128px", height: "128px", background: "rgba(255,255,255,0.1)", filter: "blur(20px)", borderRadius: "9999px" }} />
            <div style={{ position: "absolute", bottom: "-31px", left: "-31px", width: "96px", height: "96px", background: "rgba(255,255,255,0.1)", filter: "blur(12px)", borderRadius: "9999px" }} />
            <div style={{ position: "relative", zIndex: 2 }}>
              <h3 style={{ fontWeight: 700, fontSize: "16px", color: "#fff", marginBottom: "8px" }}>CSV Template</h3>
              <p style={{ fontWeight: 400, fontSize: "12px", color: "rgba(255,255,255,0.8)", lineHeight: "16px", marginBottom: "16px" }}>Ensure your data matches our system schema by downloading our master template.</p>
              <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "12px", padding: "20px 12px 12px" }}>
                <span style={{ fontWeight: 700, fontSize: "10px", color: "#fff", textTransform: "uppercase", letterSpacing: "1px" }}>Required Columns:</span>
                <div className="flex flex-wrap" style={{ gap: "8px", marginTop: "8px" }}>
                  {["order_id", "customer_email", "sku", "unit_price"].map((c) => (
                    <span key={c} style={{ background: "rgba(255,255,255,0.2)", borderRadius: "9999px", padding: "2px 8px", fontSize: "10px", color: "#fff" }}>{c}</span>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={downloadTemplate} className="flex items-center justify-center" style={{ position: "absolute", bottom: "24px", left: "24px", right: "24px", background: "#fff", borderRadius: "16px", padding: "12px 0", gap: "8px", zIndex: 2 }}>
              <Download size={13} style={{ color: "#A43B31" }} />
              <span style={{ fontWeight: 700, fontSize: "14px", color: "#A43B31" }}>Download CSV Template</span>
            </button>
          </div>

          {/* ACTIVITY LOG */}
          <div className="sidebar-card" style={{ ...glass, borderRadius: "32px", padding: "24px" }}>
            <h3 style={{ fontWeight: 700, fontSize: "16px", color: "#1B1C1C", marginBottom: "24px" }}>Activity Log</h3>
            <div className="relative flex flex-col" style={{ gap: "24px", isolation: "isolate" }}>
              {activityLog.length > 1 && <div style={{ position: "absolute", width: "2px", background: "#E4E2E1", left: "5px", top: "8px", bottom: "8px" }} />}
              {activityLog.length === 0 && <p style={{ fontSize: "12px", color: "#44474C" }}>No activity yet.</p>}
              {activityLog.slice(0, 4).map((a) => {
                const d = toJsDate(a.timestamp)
                return (
                  <div key={a.id} className="relative flex flex-col" style={{ paddingLeft: "32px" }}>
                    <span style={{ position: "absolute", left: "0px", top: "2px", width: "12px", height: "12px", borderRadius: "9999px", background: dotColor(a.type), boxShadow: "0 0 0 4px #fff" }} />
                    <span style={{ fontWeight: 700, fontSize: "12px", color: "#1B1C1C" }}>{a.event}</span>
                    <span style={{ fontWeight: 400, fontSize: "10px", color: "#44474C" }}>{a.actor || "System"} • {fmtClock(d)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminUploadOrders