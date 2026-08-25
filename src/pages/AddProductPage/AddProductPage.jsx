import React, { useEffect, useState, useRef, useMemo } from "react"
import Papa from "papaparse"
import { supabase } from "../../context/SupabaseConfig"
import { mapProductRows } from "../../utils/supabaseProducts"
import { validateImageFile, validateImageFiles } from "../../utils/uploadValidation"
import { useNavigate } from "react-router-dom"
import gsap from "gsap"
import {
    Download, Plus, Search, Filter, LayoutGrid, List as ListIcon,
    Eye, Pencil, Trash2, UploadCloud, ChevronLeft, ChevronRight, Image as ImageIcon,
} from "lucide-react"
import { PRODUCT_IMPORT_HEADERS, PRODUCT_IMPORT_SAMPLE_ROW } from "../../constants/productImportHeaders"
import RightDrawer from "../../components/Common/RightDrawer"

/* ============================== TOKENS ============================== */
const C = {
    indigo: "var(--color-error)", indigoDark: "var(--color-primary)", indigo2: "var(--color-error)",
    greenBg: "var(--color-success-border)", greenText: "var(--color-success)", green: "var(--color-primary)",
    blueBg: "var(--color-info-subtle)", blueText: "var(--color-body)",
    redBg: "var(--color-error-subtle)", redText: "var(--color-error)", red: "var(--color-error)",
    surface: "var(--color-surface-muted)", border: "var(--color-border)", chip: "var(--color-surface-muted)",
    textP: "var(--color-ink)", textS: "var(--color-body)",
}
const GEIST = "'Geist', 'Inter', sans-serif"
const INTER = "'Inter', sans-serif"

const PAGE_SIZE = 10
const EMPTY_FORM = { title: "", category: "", price: "", stock: "", brand: "", sku: "", shortDescription: "", description: "", gstRate: "0", hsnCode: "" }
const GST_RATES = ["0", "5", "12", "18", "28"]

const toMillis = (v) => {
    if (!v) return 0
    if (v?.toDate) return v.toDate().getTime()
    const d = new Date(v)
    return isNaN(d.getTime()) ? 0 : d.getTime()
}
const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const AddProductPage = () => {
    const navigate = useNavigate()

    /* -------- product catalog state -------- */
    const [products, setProducts] = useState([])
    const [loading, setLoading] = useState(false)
    const [catalogLoading, setCatalogLoading] = useState(true)
    const [uploadProgress, setUploadProgress] = useState(0)

    /* -------- add-product form -------- */
    const [form, setForm] = useState(EMPTY_FORM)
    const [status, setStatus] = useState("active")
    const [addingCategory, setAddingCategory] = useState(false)
    const [thumbFile, setThumbFile] = useState(null)
    const [thumbPreview, setThumbPreview] = useState("")
    const [galleryFiles, setGalleryFiles] = useState([])
    const [galleryPreviews, setGalleryPreviews] = useState([])

    /* -------- variant / combination product -------- */
    const [productType, setProductType] = useState("single")   // "single" | "variant"
    const [attributes, setAttributes] = useState([])           // [{ name, options:[] }]
    const [variantRows, setVariantRows] = useState([])         // [{ id, name, price, stock, sku, imageUrl, imageFile }]
    const [newAttrName, setNewAttrName] = useState("")
    const [newAttrOptions, setNewAttrOptions] = useState("")
    const [editingVariantId, setEditingVariantId] = useState(null)  // which card is being edited
    const [newVariant, setNewVariant] = useState({ name: "", price: "", stock: "", sku: "" }) // manual add form

    /* -------- CSV bulk import -------- */
    const [csvName, setCsvName] = useState("")
    const [csvRows, setCsvRows] = useState([])

    /* -------- catalog table / filter -------- */
    const [search, setSearch] = useState("")
    const [viewMode, setViewMode] = useState("list")
    const [page, setPage] = useState(1)
    const [showFilters, setShowFilters] = useState(false)
    const [categoryFilter, setCategoryFilter] = useState("all")
    const [statusFilter, setStatusFilter] = useState("all")

    /* -------- drawer -------- */
    const [selected, setSelected] = useState(null)
    const [displayedProduct, setDisplayedProduct] = useState(null)
    const [drawerImg, setDrawerImg] = useState(0)

    const rootRef = useRef(null)
    const progressRef = useRef(null)

    /* ===============================================================
       REALTIME PRODUCTS
    =============================================================== */
    useEffect(() => {
        const fetchProducts = async () => {
            const { data, error } = await supabase.from("products").select("*")
            if (error) { console.error("Error loading products:", error); setCatalogLoading(false); return }
            const arr = mapProductRows(data)
            arr.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
            setProducts(arr)
            setCatalogLoading(false)
        }
        fetchProducts()
        const channel = supabase
            .channel("admin-products-list")
            .on("postgres_changes", { event: "*", schema: "public", table: "products" }, fetchProducts)
            .subscribe()
        return () => supabase.removeChannel(channel)
    }, [])

    /* ===============================================================
       DERIVED
    =============================================================== */
    const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))], [products])

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
        return products.filter((p) => {
            const matchSearch = !q || p.title?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)
            const matchCat = categoryFilter === "all" || p.category === categoryFilter
            const pSt = p.status === "draft" ? "draft" : "active"
            const matchSt = statusFilter === "all" || pSt === statusFilter
            return matchSearch && matchCat && matchSt
        })
    }, [products, search, categoryFilter, statusFilter])

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    useEffect(() => { if (page > totalPages) setPage(1) }, [totalPages, page])

    /* ===============================================================
       FORM HANDLERS
    =============================================================== */
    const onField = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

    const onThumb = (e) => {
        const file = e.target.files[0]
        if (!file) return
        const v = validateImageFile(file)
        if (!v.ok) { alert(v.error); e.target.value = ""; return }
        setThumbFile(file)
        setThumbPreview(URL.createObjectURL(file))
    }

    const onGallery = (e) => {
        const files = [...e.target.files]
        const v = validateImageFiles(files)
        if (!v.ok) { alert(v.error); e.target.value = ""; return }
        setGalleryFiles(files)
        setGalleryPreviews(files.map((f) => URL.createObjectURL(f)))
    }

    const clearForm = () => {
        setForm(EMPTY_FORM); setStatus("active"); setAddingCategory(false)
        setThumbFile(null); setThumbPreview(""); setGalleryFiles([]); setGalleryPreviews([])
        setUploadProgress(0)
        setProductType("single"); setAttributes([]); setVariantRows([])
        setNewAttrName(""); setNewAttrOptions("")
        setEditingVariantId(null)
        setNewVariant({ name: "", price: "", stock: "", sku: "" })
    }

    /* ===============================================================
       VARIANT HELPERS
    =============================================================== */
    // Cartesian product — turns attribute option arrays into all combinations.
    const cartesian = (arrs) => arrs.reduce((a, b) => a.flatMap((x) => b.map((y) => [...x, y])), [[]])

    const rebuildVariantRows = (updatedAttrs, currentRows) => {
        if (!updatedAttrs.length) return []
        const combos = cartesian(updatedAttrs.map((a) => a.options))
        return combos.map((combo, i) => {
            const name = combo.join(" / ")
            const existing = currentRows.find((v) => v.name === name)
            return existing || { id: `var_${Date.now()}_${i}`, name, price: "", stock: "", sku: "" }
        })
    }

    /* ===============================================================
       SAVE PRODUCT
    =============================================================== */
    const saveProduct = async (saveStatus) => {
        if (!form.title || !form.category) return alert("Title and Category are required")
        if (productType === "single" && !form.price) return alert("Price is required")
        if (productType === "variant") {
            if (variantRows.length === 0) return alert("Add at least one variant combination before saving")
            if (variantRows.some((v) => !v.name || !(Number(v.price) > 0)))
                return alert("Every variant must have a name and a price greater than zero")
        }
        if (!thumbFile && !thumbPreview) return alert("Primary image is required")

        setLoading(true); setUploadProgress(5)
        try {
            const productId = `prod_${Date.now()}`
            let thumbUrl = ""
            if (thumbFile) {
                const thumbPath = `${productId}/thumbnail/${thumbFile.name}`
                const { error: thumbErr } = await supabase.storage.from("products").upload(thumbPath, thumbFile, { upsert: true })
                if (thumbErr) throw thumbErr
                thumbUrl = supabase.storage.from("products").getPublicUrl(thumbPath).data.publicUrl
            }
            setUploadProgress(25)

            const galleryUrls = []
            for (let i = 0; i < galleryFiles.length; i++) {
                const galleryPath = `${productId}/gallery/${galleryFiles[i].name}`
                const { error: galleryErr } = await supabase.storage.from("products").upload(galleryPath, galleryFiles[i], { upsert: true })
                if (galleryErr) throw galleryErr
                galleryUrls.push(supabase.storage.from("products").getPublicUrl(galleryPath).data.publicUrl)
                setUploadProgress(25 + Math.round(((i + 1) / galleryFiles.length) * 70))
            }
            setUploadProgress(100)

            const isVariant = productType === "variant"
            const savedPrice = isVariant
                ? Math.min(...variantRows.map((v) => Number(v.price) || 0))
                : Number(form.price) || 0
            const savedStock = isVariant
                ? variantRows.reduce((s, v) => s + (Number(v.stock) || 0), 0)
                : Number(form.stock) || 0

            // Upload per-variant images
            const variantsSaved = []
            for (let vi = 0; vi < variantRows.length; vi++) {
                const v = variantRows[vi]
                let vImgUrl = v.imageUrl || ""
                if (v.imageFile) {
                    const vPath = `${productId}/variants/${v.id}/${v.imageFile.name}`
                    const { error: vErr } = await supabase.storage.from("products").upload(vPath, v.imageFile, { upsert: true })
                    if (!vErr) vImgUrl = supabase.storage.from("products").getPublicUrl(vPath).data.publicUrl
                }
                variantsSaved.push({ id: v.id, name: v.name, price: Number(v.price) || 0, stock: Number(v.stock) || 0, sku: v.sku || "", image: vImgUrl })
            }

            const { error: insertErr } = await supabase.from("products").insert({
                id: productId,
                title: form.title,
                category: form.category || "general",
                price: savedPrice,
                stock: savedStock,
                has_variants: isVariant,
                variants: isVariant ? variantsSaved : [],
                attributes: isVariant ? attributes : [],
                brand: form.brand || "",
                sku: form.sku || "",
                gst_rate: Number(form.gstRate) || 0,
                hsn_code: form.hsnCode || "",
                price_type: "inclusive",
                short_description: form.shortDescription || "",
                description: form.description || "",
                thumbnail: thumbUrl,
                gallery: galleryUrls,
                status: saveStatus,
            })
            if (insertErr) throw insertErr
            alert(`Product ${saveStatus === "draft" ? "saved as draft" : "saved"} successfully`)
            clearForm()
        } catch (err) {
            console.error(err)
            alert("Error saving product")
        } finally {
            setLoading(false)
        }
    }

    /* ===============================================================
       CSV HELPERS
    =============================================================== */
    const getCsvVal = (row, ...aliases) => {
        if (!row) return undefined
        const keys = Object.keys(row)
        for (const alias of aliases) {
            const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, "")
            for (const key of keys) {
                if (key.trim().toLowerCase().replace(/[^a-z0-9]/g, "") === cleanAlias) return row[key]
            }
        }
        return undefined
    }

    const parseCsvNumber = (val, fallback = 0) => {
        if (val == null || val === "") return fallback
        if (typeof val === "number") return isNaN(val) ? fallback : val
        const cleaned = String(val).replace(/[^0-9.-]/g, "").trim()
        const num = Number(cleaned)
        return isNaN(num) ? fallback : num
    }

    const downloadSampleCsv = () => {
        const csv = Papa.unparse({ fields: PRODUCT_IMPORT_HEADERS, data: [PRODUCT_IMPORT_SAMPLE_ROW] })
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url; a.download = "product-import-sample.csv"
        document.body.appendChild(a); a.click()
        document.body.removeChild(a); URL.revokeObjectURL(url)
    }

    const onCsv = (file) => {
        if (!file) return
        setCsvName(file.name)
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            transformHeader: (h) => h.trim(),
            complete: (res) => {
                const rows = res.data.map((r) => {
                    const title = String(getCsvVal(r, "title", "name", "productName") || "").trim()
                    const rawPrice = getCsvVal(r, "price", "mrp", "unit price", "rate")
                    const parsedPrice = parseCsvNumber(rawPrice, null)
                    const category = String(getCsvVal(r, "category", "cat") || "").trim()
                    const sku = String(getCsvVal(r, "sku", "item code", "product code") || "—").trim()
                    let error = ""
                    if (!title) error = "Missing Title"
                    else if (parsedPrice === null || isNaN(parsedPrice)) error = "Missing Price"
                    else if (!category) error = "Missing Category"
                    return { raw: r, sku: sku || "—", title, price: parsedPrice !== null ? parsedPrice : rawPrice, category, valid: !error, error }
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
            const rows = valid.map((r, i) => ({
                id: `prod_${Date.now()}_${i}`,
                title: r.title, category: r.category || "general",
                price: parseCsvNumber(r.price, 0),
                stock: parseCsvNumber(getCsvVal(r.raw, "stock", "quantity", "qty"), 0),
                brand: String(getCsvVal(r.raw, "brand", "company", "manufacturer") || "").trim(),
                sku: r.sku === "—" ? "" : r.sku,
                gst_rate: parseCsvNumber(getCsvVal(r.raw, "gstRate", "gst", "gst_rate"), 0),
                hsn_code: String(getCsvVal(r.raw, "hsnCode", "hsn", "hsn_code") || "").trim(),
                price_type: "inclusive",
                short_description: String(getCsvVal(r.raw, "shortDescription", "short_description", "summary") || "").trim(),
                description: String(getCsvVal(r.raw, "description", "desc", "details") || "").trim(),
                thumbnail: String(getCsvVal(r.raw, "image", "thumbnail", "img", "imageUrl", "photo") || "").trim(),
                gallery: [], status: "active",
            }))
            const { error } = await supabase.from("products").insert(rows)
            if (error) throw error
            alert(`Uploaded ${valid.length} products`)
            setCsvRows([]); setCsvName("")
        } catch (err) {
            console.error(err); alert("Batch upload failed")
        } finally {
            setLoading(false)
        }
    }

    /* ===============================================================
       DELETE PRODUCT
    =============================================================== */
    const deleteProduct = async (id, productId) => {
        if (!window.confirm("Delete this product and its images?")) return
        try {
            setLoading(true)

            // Remove any cart rows referencing this product first.
            // This avoids the Realtime REPLICA IDENTITY error that fires when
            // Postgres tries to cascade-delete from the publication-tracked table.
            await supabase.from("cart_items").delete().eq("product_id", id)

            const { error } = await supabase.from("products").delete().eq("id", id)
            if (error) throw error

            if (productId) {
                const delFolder = async (path) => {
                    const { data: entries } = await supabase.storage.from("products").list(path)
                    if (!entries?.length) return
                    const filePaths = []
                    for (const entry of entries) {
                        const entryPath = `${path}/${entry.name}`
                        if (entry.id === null) await delFolder(entryPath)
                        else filePaths.push(entryPath)
                    }
                    if (filePaths.length) await supabase.storage.from("products").remove(filePaths)
                }
                await delFolder(productId).catch(() => { })
            }
            if (selected?.id === id) closeDrawer()
        } catch (err) {
            console.error(err)
            alert("Failed to delete product: " + (err?.message || err))
        } finally {
            setLoading(false)
        }
    }

    /* ===============================================================
       DRAWER
    =============================================================== */
    const openDrawer = (p) => { setDrawerImg(0); setSelected(p); setDisplayedProduct(p) }
    const closeDrawer = () => setSelected(null)

    /* ===============================================================
       EFFECTS
    =============================================================== */
    useEffect(() => {
        document.body.style.overflow = ""
        document.documentElement.classList.remove("lenis", "lenis-smooth", "lenis-stopped")
    }, [])

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.from(".stat-card", { y: 20, opacity: 0, stagger: 0.07, duration: 0.5, ease: "power3.out" })
            gsap.from(".main-panel", { y: 24, opacity: 0, stagger: 0.1, duration: 0.6, ease: "power3.out", delay: 0.1 })
        }, rootRef)
        return () => ctx.revert()
    }, [])

    /* ===============================================================
       STYLE HELPERS
    =============================================================== */
    const inputCls = "w-full bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
    const labelCls = "block text-[13px] font-semibold mb-1.5"
    const secBtn = "border border-[var(--color-border)] rounded-lg font-bold hover:bg-[var(--color-surface-muted)] transition-colors"

    const galleryImagesForDrawer = displayedProduct
        ? [displayedProduct.thumbnail, ...(displayedProduct.gallery || [])].filter(Boolean)
        : []

    const StatCard = ({ label, value, valueColor, badge, badgeBg, badgeColor }) => (
        <div className="stat-card bg-surface/70 backdrop-blur-sm border border-[var(--color-border)]/50 shadow-sm rounded-xl p-5 flex flex-col gap-2">
            <span className="text-[13px] font-medium" style={{ color: C.textS }}>{label}</span>
            <div className="flex items-end justify-between">
                <span className="text-3xl font-extrabold" style={{ color: valueColor || C.textP, fontFamily: GEIST }}>{value}</span>
                {badge && <span className="text-[11px] font-bold rounded-full px-2.5 py-1" style={{ background: badgeBg, color: badgeColor }}>{badge}</span>}
            </div>
        </div>
    )

    /* ===============================================================
       RENDER
    =============================================================== */
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
                </div>

                {/* STATS */}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
                    <StatCard label="Total Products" value={stats.total} badge={`+${stats.addedThisMonth} new`} badgeBg={C.greenBg} badgeColor={C.greenText} />
                    <StatCard label="Active Categories" value={stats.activeCategories} badge="Catalog" badgeBg={C.blueBg} badgeColor={C.blueText} />
                    <StatCard label="Low Stock" value={stats.lowStock} valueColor={C.red} badge="Attention" badgeBg={C.redBg} badgeColor={C.redText} />
                    <StatCard label="Out of Stock" value={stats.outStock} valueColor={C.red} badge="Critical" badgeBg={C.redBg} badgeColor={C.redText} />
                    <StatCard label="Added This Month" value={`+${stats.addedThisMonth}`} valueColor={C.green} badge={`${stats.total ? Math.round((stats.addedThisMonth / stats.total) * 100) : 0}%`} badgeBg={C.greenBg} badgeColor={C.greenText} />
                </div>

                {/* MAIN GRID: form + bulk import */}
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 mb-6">

                    {/* ── ADD PRODUCT FORM ── */}
                    <div className="main-panel bg-surface border border-[var(--color-border)] shadow-sm rounded-xl p-6">
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="font-bold" style={{ fontFamily: GEIST, fontSize: "18px" }}>Add New Product</h2>
                            <button onClick={() => setStatus((s) => (s === "active" ? "draft" : "active"))} className="flex items-center gap-2">
                                <span className="text-[13px] font-semibold" style={{ color: C.textS }}>Status</span>
                                <span className="relative inline-flex items-center rounded-full transition-colors" style={{ width: "44px", height: "24px", background: status === "active" ? C.green : "var(--color-border-strong)" }}>
                                    <span className="absolute bg-surface rounded-full transition-all" style={{ width: "18px", height: "18px", top: "3px", left: status === "active" ? "23px" : "3px" }} />
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
                                {addingCategory ? (
                                    <div className="flex gap-2">
                                        <input name="category" value={form.category} onChange={onField} placeholder="New category name" className={inputCls} autoFocus />
                                        <button type="button" onClick={() => { setAddingCategory(false); setForm((f) => ({ ...f, category: "" })) }} className={`${secBtn} px-3 text-sm whitespace-nowrap`}>Cancel</button>
                                    </div>
                                ) : (
                                    <select name="category" value={form.category}
                                        onChange={(e) => {
                                            if (e.target.value === "__new__") { setAddingCategory(true); setForm((f) => ({ ...f, category: "" })) }
                                            else onField(e)
                                        }}
                                        className={inputCls}
                                    >
                                        <option value="">Select Category</option>
                                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                                        {form.category && !categories.includes(form.category) && <option value={form.category}>{form.category}</option>}
                                        <option value="__new__">+ Add new category</option>
                                    </select>
                                )}
                            </div>

                            {/* Price — hidden for variant products; each variant carries its own price */}
                            {productType === "single" && (
                                <div>
                                    <label className={labelCls}>Price (₹)</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px]" style={{ color: C.textS }}>₹</span>
                                        <input name="price" type="number" value={form.price} onChange={onField} placeholder="0.00" className={`${inputCls} pl-7`} />
                                    </div>
                                </div>
                            )}
                            {/* Stock — hidden for variant products; each variant carries its own stock */}
                            {productType === "single" && (
                                <div>
                                    <label className={labelCls}>Stock Quantity</label>
                                    <input name="stock" type="number" value={form.stock} onChange={onField} placeholder="0" className={inputCls} />
                                </div>
                            )}

                            <div>
                                <label className={labelCls}>Brand</label>
                                <input name="brand" value={form.brand} onChange={onField} placeholder="e.g. Apex" className={inputCls} />
                            </div>
                            <div>
                                <label className={labelCls}>SKU</label>
                                <input name="sku" value={form.sku} onChange={onField} placeholder="APX-001-BLU" className={inputCls} />
                            </div>
                            <div>
                                <label className={labelCls}>GST Rate (%)</label>
                                <select name="gstRate" value={form.gstRate} onChange={onField} className={inputCls}>
                                    {GST_RATES.map((r) => <option key={r} value={r}>{r === "0" ? "0% (Exempt)" : `${r}%`}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className={labelCls}>HSN Code</label>
                                <input name="hsnCode" value={form.hsnCode} onChange={onField} placeholder="e.g. 0207" className={inputCls} />
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
                            <div>
                                <label className={labelCls}>Primary Image</label>
                                <label className="flex flex-col items-center justify-center text-center cursor-pointer border border-dashed rounded-xl overflow-hidden" style={{ borderColor: C.border, height: "150px", background: thumbPreview ? "transparent" : "var(--color-surface)" }}>
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
                                            <div key={i} className="flex items-center justify-center overflow-hidden flex-shrink-0 w-[72px] h-[72px] sm:w-[92px] sm:h-[92px]"
                                                style={{ borderRadius: "8px", background: C.chip, border: img ? (i === 0 ? `2px solid ${C.indigo}` : `1px solid ${C.border}`) : `1px dashed var(--color-border-strong)` }}>
                                                {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <Plus size={20} style={{ color: "var(--color-muted)" }} />}
                                            </div>
                                        )
                                    })}
                                    <label className="flex items-center justify-center cursor-pointer flex-shrink-0 w-[72px] h-[72px] sm:w-[92px] sm:h-[92px]"
                                        style={{ borderRadius: "8px", border: `1px dashed ${C.border}`, color: C.textS }}>
                                        <span className="text-[11px] text-center px-1">Add gallery</span>
                                        <input type="file" accept="image/*" multiple className="hidden" onChange={onGallery} />
                                    </label>
                                </div>
                                <div className="mt-3 rounded-full overflow-hidden" style={{ height: "8px", background: C.chip }}>
                                    <div ref={progressRef} style={{ height: "100%", width: `${uploadProgress}%`, background: C.indigo, borderRadius: "9999px", transition: "width 0.3s" }} />
                                </div>
                            </div>
                        </div>

                        {/* ── PRODUCT TYPE TOGGLE ── */}
                        <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${C.border}` }}>
                            <label className={labelCls}>Product Type</label>
                            <div className="flex gap-2 mt-1">
                                {[["single", "Single Product"], ["variant", "Combination / Variant Product"]].map(([val, lbl]) => (
                                    <button key={val} type="button"
                                        onClick={() => { setProductType(val); setAttributes([]); setVariantRows([]); setNewAttrName(""); setNewAttrOptions("") }}
                                        className="flex-1 py-2.5 text-[13px] font-bold rounded-lg border transition-all"
                                        style={{ background: productType === val ? C.indigo : "transparent", color: productType === val ? "#fff" : C.textS, borderColor: productType === val ? C.indigo : C.border }}>
                                        {lbl}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[12px] mt-1.5" style={{ color: C.textS }}>
                                {productType === "single"
                                    ? "Standard product with a single price and stock quantity."
                                    : "Product with multiple combinations (e.g. Weight: 100g, 250g, 500g or Size: S, M, L). Each combination has its own price and stock."}
                            </p>
                        </div>

                        {/* ── VARIANT MANAGER ── */}
                        {productType === "variant" && (
                            <div className="mt-4 rounded-xl p-4" style={{ border: `1px solid ${C.border}`, background: "var(--color-surface-muted)" }}>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-[15px]">Variant / Combination Manager</h3>
                                    <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ background: C.blueBg, color: C.blueText }}>
                                        {variantRows.length} combination{variantRows.length !== 1 ? "s" : ""}
                                    </span>
                                </div>

                                {/* ── STEP 1: Auto-generate from attributes ── */}
                                <div className="mb-4 p-4 rounded-xl" style={{ background: "var(--color-surface)", border: `1px solid ${C.border}` }}>
                                    <p className="text-[12px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textS }}>Auto-generate combinations from attributes</p>
                                    <p className="text-[11px] mb-3" style={{ color: C.textS }}>e.g. Attribute: "Weight" → Options: "100g, 250g, 500g" — generates all combinations automatically.</p>
                                    <div className="flex gap-2 flex-wrap">
                                        <input value={newAttrName} onChange={(e) => setNewAttrName(e.target.value)}
                                            placeholder='Attribute name (e.g. Weight)'
                                            className={inputCls} style={{ flex: 1, minWidth: "130px" }} />
                                        <input value={newAttrOptions} onChange={(e) => setNewAttrOptions(e.target.value)}
                                            placeholder='Options, comma-separated (e.g. 100g, 250g, 500g)'
                                            className={inputCls} style={{ flex: 2, minWidth: "200px" }} />
                                        <button type="button"
                                            onClick={() => {
                                                if (!newAttrName.trim()) return
                                                const opts = newAttrOptions.split(",").map((s) => s.trim()).filter(Boolean)
                                                if (!opts.length) return
                                                const updated = [...attributes.filter((a) => a.name !== newAttrName.trim()), { name: newAttrName.trim(), options: opts }]
                                                setAttributes(updated)
                                                setVariantRows(rebuildVariantRows(updated, variantRows))
                                                setNewAttrName(""); setNewAttrOptions("")
                                            }}
                                            className="px-4 py-2.5 text-[13px] font-bold text-white rounded-lg whitespace-nowrap"
                                            style={{ background: C.indigo }}>Generate
                                        </button>
                                    </div>
                                    {attributes.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-3">
                                            {attributes.map((a, i) => (
                                                <span key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: C.blueBg, color: C.blueText }}>
                                                    {a.name}: {a.options.join(", ")}
                                                    <button type="button" onClick={() => {
                                                        const updated = attributes.filter((_, j) => j !== i)
                                                        setAttributes(updated)
                                                        setVariantRows(rebuildVariantRows(updated, variantRows))
                                                    }} className="ml-1" style={{ color: C.redText }}>✕</button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* ── STEP 2: Manually add a single combination ── */}
                                <div className="mb-4 p-4 rounded-xl" style={{ background: "var(--color-surface)", border: `1px solid ${C.border}` }}>
                                    <p className="text-[12px] font-bold uppercase tracking-wider mb-3" style={{ color: C.textS }}>Or add a combination manually</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                        <div>
                                            <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>Combination Name *</label>
                                            <input value={newVariant.name} onChange={(e) => setNewVariant(v => ({ ...v, name: e.target.value }))}
                                                placeholder="e.g. Red / Large" className={inputCls} />
                                        </div>
                                        <div>
                                            <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>Price (₹) *</label>
                                            <input type="number" value={newVariant.price} onChange={(e) => setNewVariant(v => ({ ...v, price: e.target.value }))}
                                                placeholder="0.00" className={inputCls} />
                                        </div>
                                        <div>
                                            <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>Stock</label>
                                            <input type="number" value={newVariant.stock} onChange={(e) => setNewVariant(v => ({ ...v, stock: e.target.value }))}
                                                placeholder="0" className={inputCls} />
                                        </div>
                                        <div>
                                            <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>SKU</label>
                                            <input value={newVariant.sku} onChange={(e) => setNewVariant(v => ({ ...v, sku: e.target.value }))}
                                                placeholder="Optional" className={inputCls} />
                                        </div>
                                    </div>
                                    <button type="button"
                                        onClick={() => {
                                            if (!newVariant.name.trim() || !newVariant.price) return
                                            const existing = variantRows.find(v => v.name.toLowerCase() === newVariant.name.trim().toLowerCase())
                                            if (existing) return alert("A combination with this name already exists.")
                                            setVariantRows(r => [...r, {
                                                id: `var_${Date.now()}`,
                                                name: newVariant.name.trim(),
                                                price: newVariant.price,
                                                stock: newVariant.stock || "0",
                                                sku: newVariant.sku || "",
                                                imageUrl: "",
                                                imageFile: null,
                                            }])
                                            setNewVariant({ name: "", price: "", stock: "", sku: "" })
                                        }}
                                        className="mt-3 flex items-center gap-2 px-4 py-2 text-[13px] font-bold rounded-lg"
                                        style={{ background: "var(--color-ink)", color: "var(--color-inverse)" }}>
                                        <Plus size={14} /> Add Combination
                                    </button>
                                </div>

                                {/* ── STEP 3: Combination cards ── */}
                                {variantRows.length > 0 && (
                                    <div>
                                        <p className="text-[12px] font-bold uppercase tracking-wider mb-3" style={{ color: C.textS }}>
                                            Combinations ({variantRows.length}) — click a card to edit
                                        </p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {variantRows.map((v, i) => {
                                                const isEditing = editingVariantId === v.id
                                                const imgSrc = v.imagePreview || v.imageUrl || null
                                                return (
                                                    <div key={v.id}
                                                        className="rounded-xl overflow-hidden"
                                                        style={{ border: isEditing ? `2px solid var(--color-ink)` : `1px solid ${C.border}`, background: "var(--color-surface)", transition: "border 0.15s" }}>

                                                        {/* Card header — collapsed view */}
                                                        <div className="flex items-center gap-3 p-3 cursor-pointer"
                                                            onClick={() => setEditingVariantId(isEditing ? null : v.id)}>
                                                            {/* Variant thumbnail */}
                                                            <div className="flex-shrink-0 flex items-center justify-center overflow-hidden"
                                                                style={{ width: 48, height: 48, borderRadius: 8, background: C.chip, border: `1px dashed ${C.border}` }}>
                                                                {imgSrc
                                                                    ? <img src={imgSrc} alt="" className="w-full h-full object-cover" style={{ borderRadius: 8 }} />
                                                                    : <ImageIcon size={18} style={{ color: "var(--color-muted)" }} />}
                                                            </div>
                                                            {/* Name + summary */}
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-[14px] font-bold truncate" style={{ color: C.textP }}>{v.name}</p>
                                                                <p className="text-[12px]" style={{ color: C.textS }}>
                                                                    {v.price ? `₹${v.price}` : <span style={{ color: C.redText }}>No price</span>}
                                                                    {v.stock ? ` · ${v.stock} in stock` : " · stock 0"}
                                                                    {v.sku ? ` · ${v.sku}` : ""}
                                                                </p>
                                                            </div>
                                                            {/* Edit / delete */}
                                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                                <span className="text-[11px] font-bold px-2 py-1 rounded" style={{ background: isEditing ? "var(--color-ink)" : C.chip, color: isEditing ? "var(--color-inverse)" : C.textS }}>
                                                                    {isEditing ? "▲ Close" : "✎ Edit"}
                                                                </span>
                                                                <button type="button"
                                                                    onClick={(e) => { e.stopPropagation(); setVariantRows(r => r.filter((_, j) => j !== i)); if (isEditing) setEditingVariantId(null) }}
                                                                    className="p-1 rounded" style={{ color: C.redText }}>
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Expanded edit panel */}
                                                        {isEditing && (
                                                            <div className="px-3 pb-4 pt-1" style={{ borderTop: `1px solid ${C.border}`, background: "var(--color-surface-muted)" }}>
                                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                                                                    <div>
                                                                        <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>Combination Name *</label>
                                                                        <input value={v.name}
                                                                            onChange={(e) => setVariantRows(r => r.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                                                                            className={inputCls} />
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>Price (₹) *</label>
                                                                        <input type="number" value={v.price}
                                                                            onChange={(e) => setVariantRows(r => r.map((x, j) => j === i ? { ...x, price: e.target.value } : x))}
                                                                            className={inputCls} />
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>Stock</label>
                                                                        <input type="number" value={v.stock}
                                                                            onChange={(e) => setVariantRows(r => r.map((x, j) => j === i ? { ...x, stock: e.target.value } : x))}
                                                                            className={inputCls} />
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>SKU (optional)</label>
                                                                        <input value={v.sku}
                                                                            onChange={(e) => setVariantRows(r => r.map((x, j) => j === i ? { ...x, sku: e.target.value } : x))}
                                                                            className={inputCls} />
                                                                    </div>

                                                                    {/* Image upload for this variant */}
                                                                    <div className="sm:col-span-2">
                                                                        <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>Variant Image (optional)</label>
                                                                        <label className="flex items-center gap-3 cursor-pointer rounded-xl overflow-hidden p-2"
                                                                            style={{ border: `1px dashed ${C.border}`, background: "var(--color-surface)", minHeight: 64 }}>
                                                                            {imgSrc ? (
                                                                                <img src={imgSrc} alt="" className="flex-shrink-0 object-cover rounded-lg"
                                                                                    style={{ width: 56, height: 56 }} />
                                                                            ) : (
                                                                                <div className="flex-shrink-0 flex items-center justify-center rounded-lg"
                                                                                    style={{ width: 56, height: 56, background: C.chip }}>
                                                                                    <UploadCloud size={20} style={{ color: "var(--color-muted)" }} />
                                                                                </div>
                                                                            )}
                                                                            <div>
                                                                                <p className="text-[12px] font-semibold" style={{ color: C.textP }}>Click to upload image</p>
                                                                                <p className="text-[11px]" style={{ color: C.textS }}>JPG, PNG, WEBP (optional)</p>
                                                                            </div>
                                                                            <input type="file" accept="image/*" className="hidden"
                                                                                onChange={(e) => {
                                                                                    const file = e.target.files[0]
                                                                                    if (!file) return
                                                                                    const preview = URL.createObjectURL(file)
                                                                                    setVariantRows(r => r.map((x, j) => j === i ? { ...x, imageFile: file, imagePreview: preview } : x))
                                                                                }} />
                                                                        </label>
                                                                        {imgSrc && (
                                                                            <button type="button"
                                                                                onClick={() => setVariantRows(r => r.map((x, j) => j === i ? { ...x, imageFile: null, imagePreview: "", imageUrl: "" } : x))}
                                                                                className="text-[11px] mt-1" style={{ color: C.redText }}>Remove image</button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                        <p className="text-[11px] mt-3" style={{ color: C.textS }}>
                                            Display price = lowest variant price · Total stock = sum of all variant stocks
                                        </p>
                                    </div>
                                )}

                                {variantRows.length === 0 && (
                                    <div className="text-center py-8 rounded-xl" style={{ border: `1px dashed ${C.border}` }}>
                                        <p className="text-[14px] font-semibold" style={{ color: C.textS }}>No combinations yet</p>
                                        <p className="text-[12px] mt-1" style={{ color: C.textS }}>Auto-generate them from attributes above, or add manually.</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── FOOTER ── */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-6 pt-6" style={{ borderTop: `1px solid ${C.border}` }}>
                            <button onClick={clearForm} className="text-[14px] font-semibold text-left" style={{ color: C.textS }}>Clear Form</button>
                            <div className="flex flex-wrap items-center gap-2">
                                <button onClick={() => openDrawer({
                                    id: "preview", title: form.title || "Untitled",
                                    category: form.category,
                                    price: productType === "single" ? Number(form.price) || 0 : (variantRows.length > 0 ? Math.min(...variantRows.map((v) => Number(v.price) || 0)) : 0),
                                    stock: productType === "single" ? Number(form.stock) || 0 : variantRows.reduce((s, v) => s + (Number(v.stock) || 0), 0),
                                    shortDescription: form.shortDescription, thumbnail: thumbPreview, gallery: galleryPreviews, status,
                                    hasVariants: productType === "variant", variants: variantRows,
                                })} className={`${secBtn} px-4 py-2.5 text-sm whitespace-nowrap`}>Preview</button>
                                <button disabled={loading} onClick={() => saveProduct("draft")} className={`${secBtn} px-4 py-2.5 text-sm whitespace-nowrap`} style={{ opacity: loading ? 0.6 : 1 }}>Save as Draft</button>
                                <button disabled={loading} onClick={() => saveProduct("active")} className="px-5 py-2.5 text-sm font-bold text-inverse rounded-lg shadow-md hover:bg-[var(--color-primary)] transition-colors whitespace-nowrap" style={{ background: C.indigo, opacity: loading ? 0.6 : 1 }}>
                                    {loading ? "Saving…" : "Save Product"}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ── BULK IMPORT ── */}
                    <div className="main-panel bg-surface border border-[var(--color-border)] shadow-sm rounded-xl p-6 flex flex-col gap-4">
                        <h2 className="font-bold" style={{ fontFamily: GEIST, fontSize: "18px" }}>Bulk Product Import</h2>
                        <div>
                            <button onClick={downloadSampleCsv} type="button" className={`${secBtn} flex items-center justify-center gap-2 px-4 py-2.5 text-sm w-full`}
                                title="Download the template, fill in your product data, then upload it here.">
                                <Download size={16} /> Download Sample CSV Template
                            </button>
                            <p className="text-[11px] mt-1.5" style={{ color: C.textS }}>Download the template, fill in your product data using the same column headers, then upload it here. Remove the example row before uploading.</p>
                        </div>
                        <label className="flex flex-col items-center justify-center text-center cursor-pointer rounded-xl"
                            style={{ border: `1px dashed color-mix(in srgb, var(--color-error) 40%, transparent)`, background: "color-mix(in srgb, var(--color-error) 30%, transparent)", padding: "28px 16px", gap: "8px" }}>
                            <UploadCloud size={32} style={{ color: C.indigo2 }} />
                            <span className="font-bold text-[16px]" style={{ color: C.indigo2 }}>{csvName || "Drop CSV file here"}</span>
                            <span className="text-[12px]" style={{ color: C.indigo2, opacity: 0.8 }}>Maximum file size: 25MB. Supports up to 5,000 rows per batch.</span>
                            <input type="file" accept=".csv" className="hidden" onChange={(e) => onCsv(e.target.files[0])} />
                        </label>
                        {csvRows.length > 0 && (
                            <>
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: C.textS }}>CSV Preview</span>
                                    <span className="text-[11px] font-bold" style={{ color: C.textS }}>{csvRows.length} ROWS</span>
                                </div>
                                <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                                    <div className="grid grid-cols-2 text-[12px] font-bold" style={{ background: C.chip }}>
                                        <span className="px-3 py-2">SKU</span><span className="px-3 py-2">Status</span>
                                    </div>
                                    {csvRows.slice(0, 4).map((r, i) => (
                                        <div key={i} className="grid grid-cols-2 text-[13px]"
                                            style={{ background: r.valid ? "color-mix(in srgb, var(--color-success) 15%, transparent)" : "color-mix(in srgb, var(--color-error) 40%, transparent)", borderTop: `1px solid ${C.border}` }}>
                                            <span className="px-3 py-2 truncate" style={{ fontFamily: "monospace" }}>{r.sku}</span>
                                            <span className="px-3 py-2 font-semibold" style={{ color: r.valid ? C.green : C.red }}>{r.valid ? "Valid" : r.error}</span>
                                        </div>
                                    ))}
                                    {csvRows.length > 4 && <div className="px-3 py-2 text-[12px]" style={{ color: C.textS, borderTop: `1px solid ${C.border}` }}>+{csvRows.length - 4} more rows…</div>}
                                </div>
                            </>
                        )}
                        <button onClick={startBatchUpload} disabled={loading || csvRows.length === 0}
                            className="w-full py-3 font-bold text-inverse rounded-lg shadow-md hover:bg-[var(--color-primary)] transition-colors"
                            style={{ background: C.indigo, opacity: loading || csvRows.length === 0 ? 0.5 : 1 }}>
                            {loading ? "Uploading…" : "Start Batch Upload"}
                        </button>
                    </div>
                </div>

                {/* ── CATALOG TABLE ── */}
                <div className="main-panel bg-surface border border-[var(--color-border)] shadow-sm rounded-xl p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
                        <h2 className="font-bold" style={{ fontFamily: GEIST, fontSize: "18px" }}>All Products Catalog</h2>
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative flex-1 min-w-[160px] sm:flex-none">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.textS }} />
                                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search catalog..."
                                    className="outline-none rounded-lg pl-9 pr-3 py-2 text-sm w-full sm:w-[220px]"
                                    style={{ background: C.surface, border: `1px solid ${C.border}` }} />
                            </div>
                            <div className="relative">
                                <button onClick={() => setShowFilters((s) => !s)} className={`${secBtn} flex items-center gap-2 px-3 py-2 text-sm`}
                                    style={(categoryFilter !== "all" || statusFilter !== "all") ? { borderColor: C.indigo, color: C.indigo } : {}}>
                                    <Filter size={15} /> Filters{(categoryFilter !== "all" || statusFilter !== "all") ? " •" : ""}
                                </button>
                                {showFilters && (
                                    <div className="absolute right-0 mt-2 z-30 p-4 flex flex-col gap-3"
                                        style={{ width: "240px", background: "var(--color-surface)", border: `1px solid ${C.border}`, borderRadius: "12px", boxShadow: "0 8px 28px rgba(0,0,0,0.12)" }}>
                                        <div>
                                            <label className="block text-[12px] font-bold uppercase tracking-wide mb-1.5" style={{ color: C.textS }}>Category</label>
                                            <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }}
                                                className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                                                <option value="all">All categories</option>
                                                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[12px] font-bold uppercase tracking-wide mb-1.5" style={{ color: C.textS }}>Status</label>
                                            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
                                                className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                                                <option value="all">All statuses</option>
                                                <option value="active">Active</option>
                                                <option value="draft">Draft</option>
                                            </select>
                                        </div>
                                        <button onClick={() => { setCategoryFilter("all"); setStatusFilter("all"); setPage(1) }} className="text-[13px] font-semibold text-left" style={{ color: C.red }}>Clear filters</button>
                                    </div>
                                )}
                            </div>
                            <div className="flex rounded-lg p-1" style={{ background: C.chip }}>
                                <button onClick={() => setViewMode("list")} className="p-1.5 rounded-md" style={viewMode === "list" ? { background: "var(--color-surface)", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" } : {}}><ListIcon size={16} /></button>
                                <button onClick={() => setViewMode("grid")} className="p-1.5 rounded-md" style={viewMode === "grid" ? { background: "var(--color-surface)", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" } : {}}><LayoutGrid size={16} /></button>
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
                                        const stock = Number(p.stock || 0); const low = stock < 10
                                        return (
                                            <tr key={p.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                                                <td className="py-3 pr-4">
                                                    <div className="overflow-hidden flex items-center justify-center" style={{ width: "48px", height: "48px", borderRadius: "8px", background: C.chip }}>
                                                        {(p.thumbnail || p.image) ? <img src={p.thumbnail || p.image} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={18} style={{ color: C.textS }} />}
                                                    </div>
                                                </td>
                                                <td className="py-3 pr-4">
                                                    <p className="font-bold text-[14px]">{p.title}</p>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <p className="text-[12px]" style={{ color: C.textS }}>SKU: {p.sku || "—"}</p>
                                                        {p.hasVariants && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: C.blueBg, color: C.blueText }}>VARIANTS</span>}
                                                    </div>
                                                </td>
                                                <td className="py-3 pr-4 capitalize" style={{ color: C.textS }}>{p.category}</td>
                                                <td className="py-3 pr-4 font-bold">{p.hasVariants ? `from ${money(p.price)}` : money(p.price)}</td>
                                                <td className="py-3 pr-4">
                                                    <span className="text-[12px] font-bold rounded-full px-2.5 py-1" style={{ background: low ? C.redBg : C.greenBg, color: low ? C.redText : C.greenText }}>{stock} {low ? "Low" : "In Stock"}</span>
                                                </td>
                                                <td className="py-3 pr-4">
                                                    <span className="flex items-center gap-1.5 text-[13px]">
                                                        <span className="rounded-full" style={{ width: "8px", height: "8px", background: p.status === "draft" ? "var(--color-muted)" : C.green }} />
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
                                    {catalogLoading ? (
                                        [...Array(8)].map((_, i) => (
                                            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }} aria-hidden="true">
                                                <td className="py-3 pr-4"><div className="animate-pulse" style={{ width: "48px", height: "48px", borderRadius: "8px", background: C.chip }} /></td>
                                                <td className="py-3 pr-4"><div className="animate-pulse mb-1.5" style={{ width: "70%", height: "14px", borderRadius: "4px", background: C.chip }} /><div className="animate-pulse" style={{ width: "40%", height: "11px", borderRadius: "4px", background: C.chip }} /></td>
                                                <td className="py-3 pr-4"><div className="animate-pulse" style={{ width: "60%", height: "13px", borderRadius: "4px", background: C.chip }} /></td>
                                                <td className="py-3 pr-4"><div className="animate-pulse" style={{ width: "50%", height: "13px", borderRadius: "4px", background: C.chip }} /></td>
                                                <td className="py-3 pr-4"><div className="animate-pulse" style={{ width: "72px", height: "22px", borderRadius: "9999px", background: C.chip }} /></td>
                                                <td className="py-3 pr-4"><div className="animate-pulse" style={{ width: "56px", height: "13px", borderRadius: "4px", background: C.chip }} /></td>
                                                <td className="py-3"><div className="flex items-center gap-1.5">{[...Array(3)].map((_, j) => <div key={j} className="animate-pulse" style={{ width: "28px", height: "28px", borderRadius: "8px", background: C.chip }} />)}</div></td>
                                            </tr>
                                        ))
                                    ) : pageItems.length === 0 ? (
                                        <tr><td colSpan={7} className="py-8 text-center" style={{ color: C.textS }}>No products found.</td></tr>
                                    ) : null}
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
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <p className="text-[12px] capitalize" style={{ color: C.textS }}>{p.category}</p>
                                                {p.hasVariants && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: C.blueBg, color: C.blueText }}>VARIANTS</span>}
                                            </div>
                                            <div className="flex items-center justify-between mt-2">
                                                <span className="font-bold">{p.hasVariants ? `from ${money(p.price)}` : money(p.price)}</span>
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
                            {catalogLoading && [...Array(8)].map((_, i) => (
                                <div key={i} className="border rounded-xl overflow-hidden animate-pulse" style={{ borderColor: C.border }}>
                                    <div style={{ height: "140px", background: C.chip }} />
                                    <div className="p-3">
                                        <div style={{ height: "14px", background: C.chip, borderRadius: "4px", marginBottom: "6px" }} />
                                        <div style={{ height: "12px", width: "60%", background: C.chip, borderRadius: "4px" }} />
                                    </div>
                                </div>
                            ))}
                            {!catalogLoading && pageItems.length === 0 && (
                                <div className="col-span-full py-8 text-center" style={{ color: C.textS }}>No products found.</div>
                            )}
                        </div>
                    )}

                    {/* PAGINATION */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
                            <span className="text-[13px]" style={{ color: C.textS }}>
                                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                            </span>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className={`${secBtn} p-2`} style={{ opacity: page === 1 ? 0.4 : 1 }}><ChevronLeft size={16} /></button>
                                <span className="text-[13px] font-semibold">{page} / {totalPages}</span>
                                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className={`${secBtn} p-2`} style={{ opacity: page === totalPages ? 0.4 : 1 }}><ChevronRight size={16} /></button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT DRAWER */}
            <RightDrawer open={!!selected} onClose={closeDrawer}>
                {displayedProduct && (
                    <>
                        <div className="overflow-hidden flex items-center justify-center" style={{ borderRadius: "12px", background: C.chip, height: "260px" }}>
                            {galleryImagesForDrawer[drawerImg] ? <img src={galleryImagesForDrawer[drawerImg]} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={40} style={{ color: C.textS }} />}
                        </div>
                        {galleryImagesForDrawer.length > 1 && (
                            <div className="flex gap-2">
                                {galleryImagesForDrawer.slice(0, 4).map((img, i) => (
                                    <button key={i} onClick={() => setDrawerImg(i)} className="overflow-hidden"
                                        style={{ width: "92px", height: "92px", borderRadius: "8px", background: C.chip, border: i === drawerImg ? `2px solid ${C.indigo}` : `1px solid ${C.border}` }}>
                                        <img src={img} alt="" className="w-full h-full object-cover" />
                                    </button>
                                ))}
                            </div>
                        )}
                        <div>
                            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.indigo }}>{displayedProduct.category || "Uncategorized"}</p>
                            <h3 className="font-bold mt-1" style={{ fontSize: "24px", color: C.textP }}>{displayedProduct.title}</h3>
                            <p className="text-[14px] mt-1" style={{ color: C.textS }}>{displayedProduct.shortDescription || displayedProduct.description || "No description provided."}</p>
                        </div>
                        {/* Variant chips */}
                        {displayedProduct.hasVariants && displayedProduct.variants?.length > 0 && (
                            <div>
                                <p className="text-[12px] font-bold uppercase tracking-wider mb-2" style={{ color: C.textS }}>Variants ({displayedProduct.variants.length})</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {displayedProduct.variants.map((v) => (
                                        <span key={v.id} className="px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: C.blueBg, color: C.blueText }}>
                                            {v.name} — ₹{v.price}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="flex items-center justify-between rounded-xl p-4" style={{ background: C.surface }}>
                            <div>
                                <p className="text-[12px]" style={{ color: C.textS }}>{displayedProduct.hasVariants ? "Starting Price" : "Retail Price"}</p>
                                <p className="font-bold text-[20px]">{displayedProduct.hasVariants ? `from ${money(displayedProduct.price)}` : money(displayedProduct.price)}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-[12px]" style={{ color: C.textS }}>Current Stock</p>
                                <p className="font-bold text-[20px]" style={{ color: C.green }}>{Number(displayedProduct.stock || 0)} units</p>
                            </div>
                        </div>
                        <div>
                            <h4 className="font-bold text-[15px] mb-2">Monthly Performance</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="border rounded-xl p-3" style={{ borderColor: C.border }}>
                                    <p className="text-[12px]" style={{ color: C.textS }}>Views</p>
                                    <p className="font-bold text-[20px]">{Number(displayedProduct.views || 0).toLocaleString()}</p>
                                    <p className="text-[12px] font-bold" style={{ color: C.green }}>+0%</p>
                                </div>
                                <div className="border rounded-xl p-3" style={{ borderColor: C.border }}>
                                    <p className="text-[12px]" style={{ color: C.textS }}>Sales</p>
                                    <p className="font-bold text-[20px]">{Number(displayedProduct.sales || 0).toLocaleString()}</p>
                                    <p className="text-[12px] font-bold" style={{ color: C.green }}>+0%</p>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 pt-2">
                            <button onClick={() => displayedProduct.id !== "preview" && navigate(`/admin/edit-product/${displayedProduct.id}`)} className={`${secBtn} flex-1 py-3`}>Edit Product</button>
                            <button onClick={() => displayedProduct.id !== "preview" && navigate(`/product/${displayedProduct.id}`)} className="flex-1 py-3 font-bold text-inverse rounded-lg" style={{ background: C.indigo }}>Quick View Store</button>
                        </div>
                    </>
                )}
            </RightDrawer>
        </div>
    )
}

export default AddProductPage