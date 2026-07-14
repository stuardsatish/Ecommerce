import React, { useEffect, useState, useRef, useMemo, useLayoutEffect } from "react"
import Papa from "papaparse"
import {
    collection, addDoc, onSnapshot, deleteDoc, doc, serverTimestamp,
} from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from "firebase/storage"
import { fireDB, storage } from "../../context/FirebaseConfig"
import { useNavigate } from "react-router-dom"
import gsap from "gsap"
import {
    Download, FileText, Plus, Search, Filter, LayoutGrid, List as ListIcon,
    Eye, Pencil, Trash2, UploadCloud, X, ChevronLeft, ChevronRight, Image as ImageIcon,
} from "lucide-react"

/* ============================== TOKENS ============================== */
const C = {
    indigo: "#A91515", indigoDark: "#A43B31", indigo2: "#C92626",
    greenBg: "#6FFBBE", greenText: "#005236", green: "#A43B31",
    blueBg: "#DCE2F7", blueText: "#404758",
    redBg: "#FFDAD6", redText: "#93000A", red: "#BA1A1A",
    surface: "#F2F3F6", border: "#E4E2E1", chip: "#EDEEF1",
    textP: "#191C1E", textS: "#464554",
}
const GEIST = "'Geist', 'Inter', sans-serif"
const INTER = "'Inter', sans-serif"

const PAGE_SIZE = 10
const EMPTY_FORM = { title: "", category: "", price: "", stock: "", brand: "", sku: "", shortDescription: "", description: "" }

const toMillis = (v) => {
    if (!v) return 0
    if (v?.toDate) return v.toDate().getTime()
    const d = new Date(v)
    return isNaN(d.getTime()) ? 0 : d.getTime()
}
const money = (n) => `₹${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const AddProductPage = () => {
    const navigate = useNavigate()

    const [products, setProducts] = useState([])
    const [loading, setLoading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)

    // form
    const [form, setForm] = useState(EMPTY_FORM)
    const [status, setStatus] = useState("active")
    const [thumbFile, setThumbFile] = useState(null)
    const [thumbPreview, setThumbPreview] = useState("")
    const [galleryFiles, setGalleryFiles] = useState([])
    const [galleryPreviews, setGalleryPreviews] = useState([])

    // csv
    const [csvName, setCsvName] = useState("")
    const [csvRows, setCsvRows] = useState([])

    // table
    const [search, setSearch] = useState("")
    const [viewMode, setViewMode] = useState("list")
    const [page, setPage] = useState(1)

    // drawer
    const [selected, setSelected] = useState(null)
    const [drawerImg, setDrawerImg] = useState(0)

    const rootRef = useRef(null)
    const drawerRef = useRef(null)
    const progressRef = useRef(null)

    /* ---------------- REALTIME PRODUCTS ---------------- */
    useEffect(() => {
        const unsub = onSnapshot(collection(fireDB, "products"), (snap) => {
            const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
            arr.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
            setProducts(arr)
        })
        return () => unsub()
    }, [])

    /* ---------------- DERIVED ---------------- */
    const categories = useMemo(
        () => [...new Set(products.map((p) => p.category).filter(Boolean))],
        [products]
    )
    const stats = useMemo(() => {
        const total = products.length
        const activeCategories = categories.length
        const lowStock = products.filter((p) => Number(p.stock) < 10).length
        const outStock = products.filter((p) => Number(p.stock) === 0).length
        const now = new Date()
        const addedThisMonth = products.filter((p) => {
            const d = toMillis(p.createdAt)
            if (!d) return false
            const dt = new Date(d)
            return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear()
        }).length
        return { total, activeCategories, lowStock, outStock, addedThisMonth }
    }, [products, categories])

    const filtered = useMemo(() => {
        const q = search.toLowerCase()
        return products.filter((p) =>
            !q || p.title?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)
        )
    }, [products, search])

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    useEffect(() => { if (page > totalPages) setPage(1) }, [totalPages, page])

    /* ---------------- FORM HANDLERS ---------------- */
    const onField = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

    const onThumb = (e) => {
        const file = e.target.files[0]
        if (!file) return
        setThumbFile(file)
        setThumbPreview(URL.createObjectURL(file))
    }
    const onGallery = (e) => {
        const files = [...e.target.files]
        setGalleryFiles(files)
        setGalleryPreviews(files.map((f) => URL.createObjectURL(f)))
    }
    const clearForm = () => {
        setForm(EMPTY_FORM); setStatus("active")
        setThumbFile(null); setThumbPreview(""); setGalleryFiles([]); setGalleryPreviews([])
        setUploadProgress(0)
    }

    const saveProduct = async (saveStatus) => {
        if (!form.title || !form.price || !form.category) return alert("Title, Price and Category are required")
        if (!thumbFile && !thumbPreview) return alert("Primary image is required")
        setLoading(true); setUploadProgress(5)
        try {
            const productId = `prod_${Date.now()}`
            let thumbUrl = ""
            if (thumbFile) {
                const tRef = ref(storage, `products/${productId}/thumbnail/${thumbFile.name}`)
                await uploadBytes(tRef, thumbFile)
                thumbUrl = await getDownloadURL(tRef)
            }
            setUploadProgress(25)
            const galleryUrls = []
            for (let i = 0; i < galleryFiles.length; i++) {
                const gRef = ref(storage, `products/${productId}/gallery/${galleryFiles[i].name}`)
                await uploadBytes(gRef, galleryFiles[i])
                galleryUrls.push(await getDownloadURL(gRef))
                setUploadProgress(25 + Math.round(((i + 1) / galleryFiles.length) * 70))
            }
            setUploadProgress(100)
            await addDoc(collection(fireDB, "products"), {
                title: form.title,
                category: form.category || "general",
                price: Number(form.price) || 0,
                stock: Number(form.stock) || 0,
                brand: form.brand || "",
                sku: form.sku || "",
                shortDescription: form.shortDescription || "",
                description: form.description || "",
                thumbnail: thumbUrl,
                gallery: galleryUrls,
                status: saveStatus,
                createdAt: serverTimestamp(),
                productId,
            })
            alert(`Product ${saveStatus === "draft" ? "saved as draft" : "saved"} successfully`)
            clearForm()
        } catch (err) {
            console.error(err)
            alert("Error saving product")
        } finally {
            setLoading(false)
        }
    }

    /* ---------------- CSV ---------------- */
    const onCsv = (file) => {
        if (!file) return
        setCsvName(file.name)
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            complete: (res) => {
                const rows = res.data.map((r) => {
                    const title = r.title || r.name || ""
                    const price = r.price
                    const category = r.category || ""
                    let error = ""
                    if (!title) error = "Missing Title"
                    else if (price === undefined || price === "" || isNaN(Number(price))) error = "Missing Price"
                    else if (!category) error = "Missing Category"
                    return { raw: r, sku: r.sku || r.SKU || "—", title, price, category, valid: !error, error }
                })
                setCsvRows(rows)
            },
        })
    }
    const startBatchUpload = async () => {
        const valid = csvRows.filter((r) => r.valid)
        if (valid.length === 0) return alert("No valid rows to upload")
        setLoading(true)
        try {
            for (const r of valid) {
                await addDoc(collection(fireDB, "products"), {
                    title: r.title,
                    category: r.category || "general",
                    price: Number(r.price) || 0,
                    stock: Number(r.raw.stock) || 0,
                    brand: r.raw.brand || "",
                    sku: r.sku === "—" ? "" : r.sku,
                    shortDescription: r.raw.shortDescription || "",
                    description: r.raw.description || "",
                    thumbnail: r.raw.image || r.raw.thumbnail || "",
                    gallery: [],
                    status: "active",
                    createdAt: serverTimestamp(),
                    productId: `prod_${Date.now()}_${Math.round(Number(r.price))}`,
                })
            }
            alert(`Uploaded ${valid.length} products`)
            setCsvRows([]); setCsvName("")
        } catch (err) {
            console.error(err); alert("Batch upload failed")
        } finally {
            setLoading(false)
        }
    }

    /* ---------------- DELETE ---------------- */
    const deleteProduct = async (id, productId) => {
        if (!window.confirm("Delete this product and its images?")) return
        try {
            setLoading(true)
            await deleteDoc(doc(fireDB, "products", id))
            if (productId) {
                const delFolder = async (path) => {
                    const obj = await listAll(ref(storage, path))
                    for (const item of obj.items) await deleteObject(item)
                    for (const f of obj.prefixes) await delFolder(f.fullPath)
                }
                await delFolder(`products/${productId}`).catch(() => { })
            }
            if (selected?.id === id) closeDrawer()
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    /* ---------------- DRAWER ---------------- */
    const openDrawer = (p) => { setDrawerImg(0); setSelected(p) }
    const closeDrawer = () => {
        if (drawerRef.current) {
            gsap.to(drawerRef.current, { xPercent: 100, duration: 0.3, ease: "power3.in", onComplete: () => setSelected(null) })
        } else setSelected(null)
    }
    useLayoutEffect(() => {
        if (selected && drawerRef.current) {
            gsap.set(drawerRef.current, { xPercent: 100 })
            gsap.to(drawerRef.current, { xPercent: 0, duration: 0.4, ease: "power3.out" })
        }
    }, [selected])

    /* ---------------- SCROLL SAFETY ---------------- */
    // Guarantee this page is scrollable no matter where the user came from. Other
    // routes (the mobile nav drawer, the smooth-scroll landing page) can leave a
    // global scroll lock behind — `overflow: hidden` on <body> or leftover Lenis
    // classes on <html> — which would otherwise freeze scrolling here.
    useEffect(() => {
        document.body.style.overflow = ""
        document.documentElement.classList.remove("lenis", "lenis-smooth", "lenis-stopped")
    }, [])

    /* ---------------- ENTRY ANIM ---------------- */
    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.from(".stat-card", { y: 20, opacity: 0, stagger: 0.07, duration: 0.5, ease: "power3.out" })
            gsap.from(".main-panel", { y: 24, opacity: 0, stagger: 0.1, duration: 0.6, ease: "power3.out", delay: 0.1 })
        }, rootRef)
        return () => ctx.revert()
    }, [])

    /* ---------------- helpers ---------------- */
    const inputCls = "w-full bg-[#F2F3F6] border border-[#E4E2E1] rounded-lg px-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-[#4648D4]"
    const labelCls = "block text-[13px] font-semibold mb-1.5"
    const secBtn = "border border-[#E4E2E1] rounded-lg font-bold hover:bg-[#F2F3F6] transition-colors"

    const galleryImagesForDrawer = selected ? [selected.thumbnail, ...(selected.gallery || [])].filter(Boolean) : []

    const StatCard = ({ label, value, valueColor, badge, badgeBg, badgeColor }) => (
        <div className="stat-card bg-white/70 backdrop-blur-sm border border-[#E4E2E1]/50 shadow-sm rounded-xl p-5 flex flex-col gap-2">
            <span className="text-[13px] font-medium" style={{ color: C.textS }}>{label}</span>
            <div className="flex items-end justify-between">
                <span className="text-3xl font-extrabold" style={{ color: valueColor || C.textP, fontFamily: GEIST }}>{value}</span>
                {badge && <span className="text-[11px] font-bold rounded-full px-2.5 py-1" style={{ background: badgeBg, color: badgeColor }}>{badge}</span>}
            </div>
        </div>
    )

    return (
        <div ref={rootRef} className="min-h-screen" style={{ background: C.surface, fontFamily: INTER, color: C.textP }}>
            <div className="px-6 lg:px-10 pt-24 pb-6 sm:pt-6 max-w-[1500px] mx-auto">

                {/* HEADER */}
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
                    <div>
                        <p className="text-[11px] font-bold tracking-widest uppercase" style={{ color: C.textS }}>Dashboard / Catalog Management</p>
                        <h1 className="font-bold mt-1" style={{ fontFamily: GEIST, fontSize: "24px", color: C.textP }}>Product Management</h1>
                        <p className="text-[14px]" style={{ color: C.textS }}>Manage products, inventory, media assets, and bulk imports</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button className={`${secBtn} flex items-center gap-2 px-4 py-2.5 text-sm`}><Download size={16} /> Import</button>
                        <button className={`${secBtn} flex items-center gap-2 px-4 py-2.5 text-sm`}><Download size={16} /> Export</button>
                        <button className={`${secBtn} flex items-center gap-2 px-4 py-2.5 text-sm`}><FileText size={16} /> Template</button>
                        <button onClick={clearForm} className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white rounded-lg shadow-md hover:bg-[#A43B31] transition-colors" style={{ background: C.indigo }}>
                            <Plus size={16} /> Add New Product
                        </button>
                    </div>
                </div>

                {/* STATS ROW */}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
                    <StatCard label="Total Products" value={stats.total} badge={`+${stats.addedThisMonth} new`} badgeBg={C.greenBg} badgeColor={C.greenText} />
                    <StatCard label="Active Categories" value={stats.activeCategories} badge="Catalog" badgeBg={C.blueBg} badgeColor={C.blueText} />
                    <StatCard label="Low Stock" value={stats.lowStock} valueColor={C.red} badge="Attention" badgeBg={C.redBg} badgeColor={C.redText} />
                    <StatCard label="Out of Stock" value={stats.outStock} valueColor={C.red} badge="Critical" badgeBg={C.redBg} badgeColor={C.redText} />
                    <StatCard label="Added This Month" value={`+${stats.addedThisMonth}`} valueColor={C.green} badge={`${stats.total ? Math.round((stats.addedThisMonth / stats.total) * 100) : 0}%`} badgeBg={C.greenBg} badgeColor={C.greenText} />
                </div>

                {/* MAIN: form + bulk import */}
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 mb-6">

                    {/* ADD PRODUCT FORM */}
                    <div className="main-panel bg-white border border-[#E4E2E1] shadow-sm rounded-xl p-6">
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="font-bold" style={{ fontFamily: GEIST, fontSize: "18px" }}>Add New Product</h2>
                            <button onClick={() => setStatus((s) => (s === "active" ? "draft" : "active"))} className="flex items-center gap-2">
                                <span className="text-[13px] font-semibold" style={{ color: C.textS }}>Status</span>
                                <span className="relative inline-flex items-center rounded-full transition-colors" style={{ width: "44px", height: "24px", background: status === "active" ? C.green : "#B9B6C4" }}>
                                    <span className="absolute bg-white rounded-full transition-all" style={{ width: "18px", height: "18px", top: "3px", left: status === "active" ? "23px" : "3px" }} />
                                </span>
                                <span className="text-[13px] font-bold" style={{ color: status === "active" ? C.green : C.textS, width: "44px" }}>{status === "active" ? "Active" : "Draft"}</span>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className={labelCls}>Product Name</label>
                                <input name="title" value={form.title} onChange={onField} placeholder="e.g. Apex Ultra Slim Laptop" className={inputCls} />
                            </div>
                            <div>
                                <label className={labelCls}>Category</label>
                                <select name="category" value={form.category} onChange={onField} className={inputCls}>
                                    <option value="">Select Category</option>
                                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                                    {form.category && !categories.includes(form.category) && <option value={form.category}>{form.category}</option>}
                                </select>
                            </div>
                            <div>
                                <label className={labelCls}>Price (₹)</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px]" style={{ color: C.textS }}>₹</span>
                                    <input name="price" type="number" value={form.price} onChange={onField} placeholder="0.00" className={`${inputCls} pl-7`} />
                                </div>
                            </div>
                            <div>
                                <label className={labelCls}>Stock Quantity</label>
                                <input name="stock" type="number" value={form.stock} onChange={onField} placeholder="0" className={inputCls} />
                            </div>
                            <div>
                                <label className={labelCls}>Brand</label>
                                <input name="brand" value={form.brand} onChange={onField} placeholder="e.g. Apex" className={inputCls} />
                            </div>
                            <div>
                                <label className={labelCls}>SKU</label>
                                <input name="sku" value={form.sku} onChange={onField} placeholder="APX-001-BLU" className={inputCls} />
                            </div>
                            <div className="md:col-span-2">
                                <label className={labelCls}>Short Description</label>
                                <input name="shortDescription" value={form.shortDescription} onChange={onField} placeholder="Brief summary of product features..." className={inputCls} />
                            </div>
                            <div className="md:col-span-2">
                                <label className={labelCls}>Full Description</label>
                                <textarea name="description" value={form.description} onChange={onField} rows={4} placeholder="Detailed product specifications and content..." className={`${inputCls} resize-y`} />
                            </div>
                        </div>

                        {/* MEDIA */}
                        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4 mt-4">
                            {/* Primary */}
                            <div>
                                <label className={labelCls}>Primary Image</label>
                                <label className="flex flex-col items-center justify-center text-center cursor-pointer border border-dashed rounded-xl overflow-hidden" style={{ borderColor: C.border, height: "150px", background: thumbPreview ? "transparent" : "#fff" }}>
                                    {thumbPreview ? (
                                        <img src={thumbPreview} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="flex flex-col items-center gap-2 px-3" style={{ color: C.textS }}>
                                            <UploadCloud size={24} />
                                            <span className="text-[12px]">Click or drag to upload primary product image</span>
                                        </span>
                                    )}
                                    <input type="file" accept="image/*" className="hidden" onChange={onThumb} />
                                </label>
                            </div>
                            {/* Gallery */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-[13px] font-semibold">Gallery Preview</label>
                                    {loading && uploadProgress > 0 && uploadProgress < 100 && (
                                        <span className="text-[12px] font-bold" style={{ color: C.indigo }}>Uploading {uploadProgress}%</span>
                                    )}
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                    {[0, 1, 2, 3].map((i) => {
                                        const imgs = [thumbPreview, ...galleryPreviews].filter(Boolean)
                                        const img = imgs[i]
                                        return (
                                            <div key={i} className="flex items-center justify-center overflow-hidden flex-shrink-0 w-[72px] h-[72px] sm:w-[92px] sm:h-[92px]" style={{ borderRadius: "8px", background: C.chip, border: img ? (i === 0 ? `2px solid ${C.indigo}` : `1px solid ${C.border}`) : `1px dashed #767586` }}>
                                                {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <Plus size={20} style={{ color: "#767586" }} />}
                                            </div>
                                        )
                                    })}
                                    <label className="flex items-center justify-center cursor-pointer flex-shrink-0 w-[72px] h-[72px] sm:w-[92px] sm:h-[92px]" style={{ borderRadius: "8px", border: `1px dashed ${C.border}`, color: C.textS }}>
                                        <span className="text-[11px] text-center px-1">Add gallery</span>
                                        <input type="file" accept="image/*" multiple className="hidden" onChange={onGallery} />
                                    </label>
                                </div>
                                <div className="mt-3 rounded-full overflow-hidden" style={{ height: "8px", background: C.chip }}>
                                    <div ref={progressRef} style={{ height: "100%", width: `${uploadProgress}%`, background: C.indigo, borderRadius: "9999px", transition: "width 0.3s" }} />
                                </div>
                            </div>
                        </div>

                        {/* FOOTER */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-6 pt-6" style={{ borderTop: `1px solid ${C.border}` }}>
                            <button onClick={clearForm} className="text-[14px] font-semibold text-left" style={{ color: C.textS }}>Clear Form</button>
                            <div className="flex flex-wrap items-center gap-2">
                                <button onClick={() => openDrawer({ id: "preview", title: form.title || "Untitled", category: form.category, price: Number(form.price) || 0, stock: Number(form.stock) || 0, shortDescription: form.shortDescription, thumbnail: thumbPreview, gallery: galleryPreviews, status })} className={`${secBtn} px-4 py-2.5 text-sm whitespace-nowrap`}>Preview</button>
                                <button disabled={loading} onClick={() => saveProduct("draft")} className={`${secBtn} px-4 py-2.5 text-sm whitespace-nowrap`} style={{ opacity: loading ? 0.6 : 1 }}>Save as Draft</button>
                                <button disabled={loading} onClick={() => saveProduct("active")} className="px-5 py-2.5 text-sm font-bold text-white rounded-lg shadow-md hover:bg-[#A43B31] transition-colors whitespace-nowrap" style={{ background: C.indigo, opacity: loading ? 0.6 : 1 }}>
                                    {loading ? "Saving…" : "Save Product"}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* BULK IMPORT */}
                    <div className="main-panel bg-white border border-[#E4E2E1] shadow-sm rounded-xl p-6 flex flex-col gap-4">
                        <h2 className="font-bold" style={{ fontFamily: GEIST, fontSize: "18px" }}>Bulk Product Import</h2>
                        <label className="flex flex-col items-center justify-center text-center cursor-pointer rounded-xl" style={{ border: `1px dashed rgba(70,72,212,0.4)`, background: "rgba(225,224,255,0.3)", padding: "28px 16px", gap: "8px" }}>
                            <UploadCloud size={32} style={{ color: C.indigo2 }} />
                            <span className="font-bold text-[16px]" style={{ color: C.indigo2 }}>{csvName || "Drop CSV file here"}</span>
                            <span className="text-[12px]" style={{ color: C.indigo2, opacity: 0.8 }}>Maximum file size: 25MB. Supports up to 5,000 rows per batch.</span>
                            <input type="file" accept=".csv" className="hidden" onChange={(e) => onCsv(e.target.files[0])} />
                        </label>

                        {csvRows.length > 0 && (
                            <>
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: C.textS }}>CSV Preview (Validation)</span>
                                    <span className="text-[11px] font-bold" style={{ color: C.textS }}>{csvRows.length} ROWS DETECTED</span>
                                </div>
                                <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                                    <div className="grid grid-cols-2 text-[12px] font-bold" style={{ background: C.chip }}>
                                        <span className="px-3 py-2">SKU</span>
                                        <span className="px-3 py-2">Status</span>
                                    </div>
                                    {csvRows.slice(0, 4).map((r, i) => (
                                        <div key={i} className="grid grid-cols-2 text-[13px]" style={{ background: r.valid ? "rgba(111,251,190,0.15)" : "rgba(255,218,214,0.4)", borderTop: `1px solid ${C.border}` }}>
                                            <span className="px-3 py-2 truncate" style={{ fontFamily: "monospace" }}>{r.sku}</span>
                                            <span className="px-3 py-2 font-semibold" style={{ color: r.valid ? C.green : C.red }}>{r.valid ? "Valid" : r.error}</span>
                                        </div>
                                    ))}
                                    {csvRows.length > 4 && <div className="px-3 py-2 text-[12px]" style={{ color: C.textS, borderTop: `1px solid ${C.border}` }}>+{csvRows.length - 4} more rows…</div>}
                                </div>
                            </>
                        )}

                        <button onClick={startBatchUpload} disabled={loading || csvRows.length === 0} className="w-full py-3 font-bold text-white rounded-lg shadow-md hover:bg-[#A43B31] transition-colors" style={{ background: C.indigo, opacity: loading || csvRows.length === 0 ? 0.5 : 1 }}>
                            {loading ? "Uploading…" : "Start Batch Upload"}
                        </button>
                    </div>
                </div>

                {/* CATALOG TABLE */}
                <div className="main-panel bg-white border border-[#E4E2E1] shadow-sm rounded-xl p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
                        <h2 className="font-bold" style={{ fontFamily: GEIST, fontSize: "18px" }}>All Products Catalog</h2>
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative flex-1 min-w-[160px] sm:flex-none">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.textS }} />
                                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search catalog..." className="outline-none rounded-lg pl-9 pr-3 py-2 text-sm w-full sm:w-[220px]" style={{ background: C.surface, border: `1px solid ${C.border}` }} />
                            </div>
                            <button className={`${secBtn} flex items-center gap-2 px-3 py-2 text-sm`}><Filter size={15} /> Filters</button>
                            <div className="flex rounded-lg p-1" style={{ background: C.chip }}>
                                <button onClick={() => setViewMode("list")} className="p-1.5 rounded-md" style={viewMode === "list" ? { background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" } : {}}><ListIcon size={16} /></button>
                                <button onClick={() => setViewMode("grid")} className="p-1.5 rounded-md" style={viewMode === "grid" ? { background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" } : {}}><LayoutGrid size={16} /></button>
                            </div>
                        </div>
                    </div>

                    {viewMode === "list" ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[12px] font-bold uppercase tracking-wide" style={{ color: C.textS, borderBottom: `1px solid ${C.border}` }}>
                                        <th className="py-3 pr-4">Image</th><th className="py-3 pr-4">Name / SKU</th><th className="py-3 pr-4">Category</th>
                                        <th className="py-3 pr-4">Price</th><th className="py-3 pr-4">Stock</th><th className="py-3 pr-4">Status</th><th className="py-3">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageItems.map((p) => {
                                        const stock = Number(p.stock || 0)
                                        const low = stock < 10
                                        return (
                                            <tr key={p.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                                                <td className="py-3 pr-4">
                                                    <div className="overflow-hidden flex items-center justify-center" style={{ width: "48px", height: "48px", borderRadius: "8px", background: C.chip }}>
                                                        {(p.thumbnail || p.image) ? <img src={p.thumbnail || p.image} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={18} style={{ color: C.textS }} />}
                                                    </div>
                                                </td>
                                                <td className="py-3 pr-4">
                                                    <p className="font-bold text-[14px]">{p.title}</p>
                                                    <p className="text-[12px]" style={{ color: C.textS }}>SKU: {p.sku || "—"}</p>
                                                </td>
                                                <td className="py-3 pr-4 capitalize" style={{ color: C.textS }}>{p.category}</td>
                                                <td className="py-3 pr-4 font-bold">{money(p.price)}</td>
                                                <td className="py-3 pr-4">
                                                    <span className="text-[12px] font-bold rounded-full px-2.5 py-1" style={{ background: low ? C.redBg : C.greenBg, color: low ? C.redText : C.greenText }}>{stock} {low ? "Low Stock" : "In Stock"}</span>
                                                </td>
                                                <td className="py-3 pr-4">
                                                    <span className="flex items-center gap-1.5 text-[13px]">
                                                        <span className="rounded-full" style={{ width: "8px", height: "8px", background: p.status === "draft" ? "#9A97A6" : C.green }} />
                                                        {p.status === "draft" ? "Draft" : "Active"}
                                                    </span>
                                                </td>
                                                <td className="py-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <button onClick={() => openDrawer(p)} className="p-1.5 rounded-lg" style={{ border: `1px solid ${C.border}` }} title="View"><Eye size={15} style={{ color: C.textS }} /></button>
                                                        <button onClick={() => navigate(`/admin/edit-product/${p.id}`)} className="p-1.5 rounded-lg" style={{ border: `1px solid ${C.border}` }} title="Edit"><Pencil size={15} style={{ color: C.indigo }} /></button>
                                                        <button onClick={() => deleteProduct(p.id, p.productId)} className="p-1.5 rounded-lg" style={{ border: `1px solid ${C.border}` }} title="Delete"><Trash2 size={15} style={{ color: C.red }} /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                    {pageItems.length === 0 && <tr><td colSpan={7} className="py-8 text-center" style={{ color: C.textS }}>No products found.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {pageItems.map((p) => {
                                const stock = Number(p.stock || 0); const low = stock < 10
                                return (
                                    <div key={p.id} className="border rounded-xl overflow-hidden" style={{ borderColor: C.border }}>
                                        <div className="flex items-center justify-center" style={{ height: "140px", background: C.chip }}>
                                            {(p.thumbnail || p.image) ? <img src={p.thumbnail || p.image} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={22} style={{ color: C.textS }} />}
                                        </div>
                                        <div className="p-3">
                                            <p className="font-bold text-[14px] truncate">{p.title}</p>
                                            <p className="text-[12px] capitalize" style={{ color: C.textS }}>{p.category}</p>
                                            <div className="flex items-center justify-between mt-2">
                                                <span className="font-bold">{money(p.price)}</span>
                                                <span className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: low ? C.redBg : C.greenBg, color: low ? C.redText : C.greenText }}>{stock}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-3">
                                                <button onClick={() => openDrawer(p)} className="p-1.5 rounded-lg flex-1 flex justify-center" style={{ border: `1px solid ${C.border}` }}><Eye size={15} style={{ color: C.textS }} /></button>
                                                <button onClick={() => navigate(`/admin/edit-product/${p.id}`)} className="p-1.5 rounded-lg flex-1 flex justify-center" style={{ border: `1px solid ${C.border}` }}><Pencil size={15} style={{ color: C.indigo }} /></button>
                                                <button onClick={() => deleteProduct(p.id, p.productId)} className="p-1.5 rounded-lg flex-1 flex justify-center" style={{ border: `1px solid ${C.border}` }}><Trash2 size={15} style={{ color: C.red }} /></button>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                            {pageItems.length === 0 && <p className="col-span-full py-8 text-center" style={{ color: C.textS }}>No products found.</p>}
                        </div>
                    )}

                    {/* FOOTER / PAGINATION */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
                        <span className="text-[13px]" style={{ color: C.textS }}>
                            Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} products
                        </span>
                        <div className="flex items-center gap-1.5">
                            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className={`${secBtn} flex items-center gap-1 px-3 py-1.5 text-sm`} style={{ opacity: page === 1 ? 0.5 : 1 }}><ChevronLeft size={14} /> Previous</button>
                            {Array.from({ length: totalPages }).slice(0, 5).map((_, i) => {
                                const n = i + 1
                                return (
                                    <button key={n} onClick={() => setPage(n)} className="w-9 h-9 rounded-lg text-sm font-bold" style={page === n ? { background: C.indigo, color: "#fff" } : { border: `1px solid ${C.border}` }}>{n}</button>
                                )
                            })}
                            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className={`${secBtn} flex items-center gap-1 px-3 py-1.5 text-sm`} style={{ opacity: page === totalPages ? 0.5 : 1 }}>Next <ChevronRight size={14} /></button>
                        </div>
                    </div>
                </div>
            </div>

            {/* DETAIL DRAWER */}
            {selected && <div className="fixed inset-0" style={{ zIndex: 60, background: "rgba(0,0,0,0.4)" }} onClick={closeDrawer} />}
            {selected && (
                <div ref={drawerRef} className="fixed top-0 right-0 bottom-0 overflow-y-auto" style={{ width: "480px", maxWidth: "100%", background: "#fff", zIndex: 61, boxShadow: "-10px 0 40px rgba(0,0,0,0.15)" }}>
                    <div className="p-6 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h2 className="font-bold" style={{ fontFamily: GEIST, fontSize: "20px" }}>Product Detail</h2>
                            <button onClick={closeDrawer} className="p-2 rounded-full" style={{ background: C.surface }}><X size={18} /></button>
                        </div>

                        {/* Gallery */}
                        <div className="overflow-hidden flex items-center justify-center" style={{ borderRadius: "12px", background: C.chip, height: "260px" }}>
                            {galleryImagesForDrawer[drawerImg] ? <img src={galleryImagesForDrawer[drawerImg]} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={40} style={{ color: C.textS }} />}
                        </div>
                        {galleryImagesForDrawer.length > 1 && (
                            <div className="flex gap-2">
                                {galleryImagesForDrawer.slice(0, 4).map((img, i) => (
                                    <button key={i} onClick={() => setDrawerImg(i)} className="overflow-hidden" style={{ width: "92px", height: "92px", borderRadius: "8px", background: C.chip, border: i === drawerImg ? `2px solid ${C.indigo}` : `1px solid ${C.border}` }}>
                                        <img src={img} alt="" className="w-full h-full object-cover" />
                                    </button>
                                ))}
                            </div>
                        )}

                        <div>
                            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.indigo }}>{selected.category || "Uncategorized"}</p>
                            <h3 className="font-bold mt-1" style={{ fontSize: "24px", color: C.textP }}>{selected.title}</h3>
                            <p className="text-[14px] mt-1" style={{ color: C.textS }}>{selected.shortDescription || selected.description || "No description provided."}</p>
                        </div>

                        <div className="flex items-center justify-between rounded-xl p-4" style={{ background: C.surface }}>
                            <div>
                                <p className="text-[12px]" style={{ color: C.textS }}>Retail Price</p>
                                <p className="font-bold text-[20px]">{money(selected.price)}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-[12px]" style={{ color: C.textS }}>Current Stock</p>
                                <p className="font-bold text-[20px]" style={{ color: C.green }}>{Number(selected.stock || 0)} units</p>
                            </div>
                        </div>

                        <div>
                            <h4 className="font-bold text-[15px] mb-2">Monthly Performance</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="border rounded-xl p-3" style={{ borderColor: C.border }}>
                                    <p className="text-[12px]" style={{ color: C.textS }}>Views</p>
                                    <p className="font-bold text-[20px]">{Number(selected.views || 0).toLocaleString()}</p>
                                    <p className="text-[12px] font-bold" style={{ color: C.green }}>+0%</p>
                                </div>
                                <div className="border rounded-xl p-3" style={{ borderColor: C.border }}>
                                    <p className="text-[12px]" style={{ color: C.textS }}>Sales</p>
                                    <p className="font-bold text-[20px]">{Number(selected.sales || 0).toLocaleString()}</p>
                                    <p className="text-[12px] font-bold" style={{ color: C.green }}>+0%</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 pt-2">
                            <button onClick={() => selected.id !== "preview" && navigate(`/admin/edit-product/${selected.id}`)} className={`${secBtn} flex-1 py-3`}>Edit Product</button>
                            <button onClick={() => selected.id !== "preview" && navigate(`/product/${selected.id}`)} className="flex-1 py-3 font-bold text-white rounded-lg" style={{ background: C.indigo }}>Quick View Store</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default AddProductPage