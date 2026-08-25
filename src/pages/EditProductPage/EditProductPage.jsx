import React, { useEffect, useState, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { supabase } from "../../context/SupabaseConfig"
import { mapProductRow } from "../../utils/supabaseProducts"
import { validateImageFile, validateImageFiles } from "../../utils/uploadValidation"
import {
    ArrowLeft, UploadCloud, Plus, Trash2, Image as ImageIcon, Save, CheckCircle2
} from "lucide-react"

/* ─── Design tokens (same as AddProductPage) ─── */
const C = {
    indigo: "var(--color-error)", indigoDark: "var(--color-primary)",
    greenBg: "var(--color-success-border)", greenText: "var(--color-success)", green: "var(--color-primary)",
    blueBg: "var(--color-info-subtle)", blueText: "var(--color-body)",
    redBg: "var(--color-error-subtle)", redText: "var(--color-error)", red: "var(--color-error)",
    surface: "var(--color-surface-muted)", border: "var(--color-border)", chip: "var(--color-surface-muted)",
    textP: "var(--color-ink)", textS: "var(--color-body)",
}
const GEIST = "'Geist', 'Inter', sans-serif"
const INTER = "'Inter', sans-serif"
const GST_RATES = ["0", "5", "12", "18", "28"]

/* ─── Cartesian helper ─── */
const cartesian = (arrs) => arrs.reduce((a, b) => a.flatMap((x) => b.map((y) => [...x, y])), [[]])
const rebuildVariantRows = (updatedAttrs, currentRows) => {
    if (!updatedAttrs.length) return []
    const combos = cartesian(updatedAttrs.map((a) => a.options))
    return combos.map((combo, i) => {
        const name = combo.join(" / ")
        const existing = currentRows.find((v) => v.name === name)
        return existing || { id: `var_${Date.now()}_${i}`, name, price: "", stock: "", sku: "", imageUrl: "", imageFile: null }
    })
}

const EMPTY_FORM = {
    title: "", category: "", price: "", stock: "", brand: "", sku: "",
    shortDescription: "", description: "", gstRate: "0", hsnCode: "",
    discount: "", discountExpiry: "", status: "active",
}

const EditProductPage = () => {
    const { id } = useParams()
    const navigate = useNavigate()

    /* ── Core state ── */
    const [form, setForm] = useState(EMPTY_FORM)
    const [fetching, setFetching] = useState(true)
    const [loading, setLoading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [saved, setSaved] = useState(false)

    /* ── Images ── */
    const [thumbFile, setThumbFile] = useState(null)
    const [thumbPreview, setThumbPreview] = useState("")
    const [existingGallery, setExistingGallery] = useState([])   // already-uploaded URLs
    const [newGalleryFiles, setNewGalleryFiles] = useState([])   // new files to upload
    const [newGalleryPreviews, setNewGalleryPreviews] = useState([])

    /* ── Variants ── */
    const [productType, setProductType] = useState("single")
    const [attributes, setAttributes] = useState([])
    const [variantRows, setVariantRows] = useState([])
    const [editingVariantId, setEditingVariantId] = useState(null)
    const [newVariant, setNewVariant] = useState({ name: "", price: "", stock: "", sku: "" })
    const [newAttrName, setNewAttrName] = useState("")
    const [newAttrOptions, setNewAttrOptions] = useState("")

    const progressRef = useRef(null)

    /* ── Fetch product ── */
    useEffect(() => {
        const fetch = async () => {
            try {
                const { data: row, error } = await supabase.from("products").select("*").eq("id", id).maybeSingle()
                if (error) throw error
                if (!row) { navigate("/admin/add-product"); return }
                const p = mapProductRow(row)

                setForm({
                    title: p.title || "",
                    category: p.category || "",
                    price: p.price != null ? String(p.price) : "",
                    stock: p.stock != null ? String(p.stock) : "",
                    brand: p.brand || "",
                    sku: p.sku || "",
                    shortDescription: p.shortDescription || "",
                    description: p.description || "",
                    gstRate: p.gstRate != null ? String(p.gstRate) : "0",
                    hsnCode: p.hsnCode || "",
                    discount: p.discount != null ? String(p.discount) : "",
                    discountExpiry: p.discountExpiry || "",
                    status: p.status || "active",
                })
                setThumbPreview(p.thumbnail || p.image || "")
                setExistingGallery(p.gallery || [])

                const hasV = !!p.hasVariants
                setProductType(hasV ? "variant" : "single")
                setAttributes(p.attributes || [])
                setVariantRows(
                    (p.variants || []).map((v) => ({
                        id: v.id || `var_${Date.now()}_${Math.random()}`,
                        name: v.name || "",
                        price: v.price != null ? String(v.price) : "",
                        stock: v.stock != null ? String(v.stock) : "",
                        sku: v.sku || "",
                        imageUrl: v.image || "",
                        imageFile: null,
                        imagePreview: "",
                    }))
                )
            } catch (e) {
                console.error(e)
                alert("Failed to load product")
            } finally {
                setFetching(false)
            }
        }
        fetch()
    }, [id])

    /* ── Handlers ── */
    const onField = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

    const onThumb = (e) => {
        const file = e.target.files[0]
        if (!file) return
        const v = validateImageFile(file)
        if (!v.ok) { alert(v.error); e.target.value = ""; return }
        setThumbFile(file)
        setThumbPreview(URL.createObjectURL(file))
    }

    const onNewGallery = (e) => {
        const files = [...e.target.files]
        const v = validateImageFiles(files)
        if (!v.ok) { alert(v.error); e.target.value = ""; return }
        setNewGalleryFiles(files)
        setNewGalleryPreviews(files.map((f) => URL.createObjectURL(f)))
    }

    const removeExistingGalleryImg = async (url) => {
        if (!window.confirm("Remove this image from the gallery?")) return
        try {
            setLoading(true)
            const newGallery = existingGallery.filter((u) => u !== url)
            const { error } = await supabase.from("products").update({ gallery: newGallery }).eq("id", id)
            if (error) throw error
            // Best-effort storage delete
            try {
                const marker = "/storage/v1/object/public/products/"
                const idx = url.indexOf(marker)
                if (idx !== -1) await supabase.storage.from("products").remove([url.slice(idx + marker.length)])
            } catch (_) { }
            setExistingGallery(newGallery)
        } catch (e) {
            console.error(e); alert("Failed to remove image")
        } finally { setLoading(false) }
    }

    /* ── Save ── */
    const saveProduct = async () => {
        if (!form.title || !form.category) return alert("Title and Category are required")
        if (!form.price) return alert("Price is required")
        if (productType === "variant") {
            if (variantRows.length === 0) return alert("Add at least one combination before saving")
            if (variantRows.some((v) => !v.name || !(Number(v.price) > 0)))
                return alert("Every combination must have a name and a price")
        }

        setLoading(true); setUploadProgress(5)
        try {
            const prodId = id

            // 1. Upload thumbnail if changed
            let thumbUrl = thumbPreview
            if (thumbFile) {
                const thumbPath = `${prodId}/thumbnail/${thumbFile.name}`
                const { error: tErr } = await supabase.storage.from("products").upload(thumbPath, thumbFile, { upsert: true })
                if (tErr) throw tErr
                thumbUrl = supabase.storage.from("products").getPublicUrl(thumbPath).data.publicUrl
            }
            setUploadProgress(20)

            // 2. Upload new gallery images
            const addedGalleryUrls = []
            for (let i = 0; i < newGalleryFiles.length; i++) {
                const path = `${prodId}/gallery/${newGalleryFiles[i].name}`
                const { error: gErr } = await supabase.storage.from("products").upload(path, newGalleryFiles[i], { upsert: true })
                if (gErr) throw gErr
                addedGalleryUrls.push(supabase.storage.from("products").getPublicUrl(path).data.publicUrl)
                setUploadProgress(20 + Math.round(((i + 1) / newGalleryFiles.length) * 40))
            }
            setUploadProgress(60)

            // 3. Upload per-variant images
            const isVariant = productType === "variant"
            const variantsSaved = []
            for (let vi = 0; vi < variantRows.length; vi++) {
                const v = variantRows[vi]
                let vImgUrl = v.imageUrl || ""
                if (v.imageFile) {
                    const vPath = `${prodId}/variants/${v.id}/${v.imageFile.name}`
                    const { error: vErr } = await supabase.storage.from("products").upload(vPath, v.imageFile, { upsert: true })
                    if (!vErr) vImgUrl = supabase.storage.from("products").getPublicUrl(vPath).data.publicUrl
                }
                variantsSaved.push({
                    id: v.id, name: v.name,
                    price: Number(v.price) || 0,
                    stock: Number(v.stock) || 0,
                    sku: v.sku || "",
                    image: vImgUrl,
                })
            }
            setUploadProgress(90)

            const savedPrice = Number(form.price) || 0
            const savedStock = Number(form.stock) || 0

            const { error: updateErr } = await supabase.from("products").update({
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
                discount: Number(form.discount) || 0,
                discount_expiry: form.discountExpiry || null,
                thumbnail: thumbUrl,
                gallery: [...existingGallery, ...addedGalleryUrls],
                status: form.status || "active",
            }).eq("id", id)
            if (updateErr) throw updateErr

            setUploadProgress(100)
            setSaved(true)
            setTimeout(() => { setSaved(false); navigate("/admin/add-product") }, 1200)
        } catch (e) {
            console.error(e); alert("Failed to update product: " + (e?.message || e))
        } finally {
            setLoading(false)
        }
    }

    /* ── Style helpers ── */
    const inputCls = "w-full bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
    const labelCls = "block text-[13px] font-semibold mb-1.5"

    /* ── Loading skeleton ── */
    if (fetching) {
        const bar = (s) => <div className="animate-pulse rounded-lg" style={{ background: "var(--color-surface-muted)", ...s }} />
        return (
            <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ background: C.surface, fontFamily: INTER }}>
                <div className="w-full max-w-3xl rounded-2xl p-8 shadow-sm" style={{ background: "var(--color-surface)", border: `1px solid ${C.border}` }}>
                    {bar({ height: 32, width: 200, marginBottom: 28 })}
                    <div className="grid grid-cols-2 gap-4 mb-6">{[...Array(6)].map((_, i) => <div key={i}>{bar({ height: 13, width: 90, marginBottom: 8 })}{bar({ height: 44 })}</div>)}</div>
                    {bar({ height: 120, marginBottom: 16 })}
                    {bar({ height: 48, marginTop: 24 })}
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen px-4 sm:px-6 lg:px-10 pt-24 pb-12 sm:pt-8" style={{ background: C.surface, fontFamily: INTER, color: C.textP }}>
            <div className="max-w-4xl mx-auto">

                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                    <button onClick={() => navigate("/admin/add-product")}
                        className="flex items-center justify-center w-9 h-9 rounded-lg border transition-colors hover:bg-[var(--color-surface)]"
                        style={{ borderColor: C.border }}>
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <p className="text-[11px] font-bold tracking-widest uppercase" style={{ color: C.textS }}>Admin / Product Management</p>
                        <h1 className="font-bold text-[22px] mt-0.5" style={{ fontFamily: GEIST }}>Edit Product</h1>
                    </div>
                </div>

                {/* Main card */}
                <div className="rounded-2xl p-6 shadow-sm" style={{ background: "var(--color-surface)", border: `1px solid ${C.border}` }}>

                    {/* Status toggle */}
                    <div className="flex items-center justify-between mb-6 pb-5" style={{ borderBottom: `1px solid ${C.border}` }}>
                        <h2 className="font-bold text-[17px]" style={{ fontFamily: GEIST }}>Product Details</h2>
                        <button type="button" onClick={() => setForm((f) => ({ ...f, status: f.status === "active" ? "draft" : "active" }))}
                            className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold" style={{ color: C.textS }}>Status</span>
                            <span className="relative inline-flex items-center rounded-full transition-colors"
                                style={{ width: 44, height: 24, background: form.status === "active" ? C.green : "var(--color-border-strong)" }}>
                                <span className="absolute bg-surface rounded-full transition-all"
                                    style={{ width: 18, height: 18, top: 3, left: form.status === "active" ? 23 : 3 }} />
                            </span>
                            <span className="text-[13px] font-bold w-11" style={{ color: form.status === "active" ? C.green : C.textS }}>
                                {form.status === "active" ? "Active" : "Draft"}
                            </span>
                        </button>
                    </div>

                    {/* Fields grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className={labelCls}>Product Name</label>
                            <input name="title" value={form.title} onChange={onField} placeholder="e.g. Kaju Katli" className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Category</label>
                            <input name="category" value={form.category} onChange={onField} placeholder="e.g. Sweets" className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Brand</label>
                            <input name="brand" value={form.brand} onChange={onField} placeholder="e.g. Haldiram" className={inputCls} />
                        </div>

                        {/* Price */}
                        <div>
                            <label className={labelCls}>
                                Price (₹)
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px]" style={{ color: C.textS }}>₹</span>
                                <input name="price" type="number" value={form.price} onChange={onField} placeholder="0.00" className={`${inputCls} pl-7`} />
                            </div>
                        </div>

                        {/* Stock */}
                        <div>
                            <label className={labelCls}>
                                Stock Quantity
                            </label>
                            <input name="stock" type="number" value={form.stock} onChange={onField} placeholder="0" className={inputCls} />
                        </div>

                        <div>
                            <label className={labelCls}>SKU</label>
                            <input name="sku" value={form.sku} onChange={onField} placeholder="APX-001" className={inputCls} />
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
                        <div>
                            <label className={labelCls}>Discount (%)</label>
                            <input name="discount" type="number" value={form.discount} onChange={onField} placeholder="0" className={inputCls} />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelCls}>Discount Expiry Date & Time</label>
                            <input name="discountExpiry" type="datetime-local" value={form.discountExpiry || ""} onChange={onField} className={inputCls} />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelCls}>Short Description</label>
                            <input name="shortDescription" value={form.shortDescription} onChange={onField} placeholder="Brief product summary…" className={inputCls} />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelCls}>Full Description</label>
                            <textarea name="description" value={form.description} onChange={onField} rows={4} placeholder="Detailed product description…" className={`${inputCls} resize-y`} />
                        </div>
                    </div>

                    {/* ── MEDIA ── */}
                    <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${C.border}` }}>
                        <h3 className="font-bold text-[15px] mb-4">Images</h3>
                        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
                            {/* Thumbnail */}
                            <div>
                                <label className={labelCls}>Primary Image</label>
                                <label className="flex flex-col items-center justify-center text-center cursor-pointer border border-dashed rounded-xl overflow-hidden"
                                    style={{ borderColor: C.border, height: 150, background: thumbPreview ? "transparent" : "var(--color-surface)" }}>
                                    {thumbPreview
                                        ? <img src={thumbPreview} alt="" className="w-full h-full object-cover" />
                                        : <span className="flex flex-col items-center gap-2 px-3" style={{ color: C.textS }}>
                                            <UploadCloud size={24} /><span className="text-[12px]">Click to upload thumbnail</span>
                                          </span>}
                                    <input type="file" accept="image/*" className="hidden" onChange={onThumb} />
                                </label>
                                {thumbPreview && (
                                    <button type="button" onClick={() => { setThumbFile(null); setThumbPreview("") }}
                                        className="text-[11px] mt-1" style={{ color: C.redText }}>Remove thumbnail</button>
                                )}
                            </div>

                            {/* Gallery */}
                            <div>
                                <label className={labelCls}>Gallery Images</label>

                                {/* Existing gallery */}
                                {existingGallery.length > 0 && (
                                    <div className="flex gap-2 flex-wrap mb-3">
                                        {existingGallery.map((url, i) => (
                                            <div key={i} className="relative flex-shrink-0"
                                                style={{ width: 72, height: 72, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
                                                <img src={url} alt="" className="w-full h-full object-cover" />
                                                <button type="button" onClick={() => removeExistingGalleryImg(url)}
                                                    className="absolute top-0.5 right-0.5 flex items-center justify-center rounded-full text-[10px] font-bold"
                                                    style={{ width: 18, height: 18, background: "var(--color-error)", color: "#fff" }}>✕</button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Add new gallery images */}
                                <label className="inline-flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg text-[13px] font-bold mb-2"
                                    style={{ background: C.chip, border: `1px dashed ${C.border}`, color: C.textS }}>
                                    <UploadCloud size={16} />
                                    {newGalleryPreviews.length > 0 ? `${newGalleryPreviews.length} new image(s) selected` : "Add gallery images"}
                                    <input type="file" accept="image/*" multiple className="hidden" onChange={onNewGallery} />
                                </label>
                                {newGalleryPreviews.length > 0 && (
                                    <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
                                        {newGalleryPreviews.map((src, i) => (
                                            <div key={i} className="flex-shrink-0 overflow-hidden"
                                                style={{ width: 64, height: 64, borderRadius: 8, border: `1px solid ${C.border}` }}>
                                                <img src={src} alt="" className="w-full h-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Progress bar */}
                                {loading && uploadProgress > 0 && uploadProgress < 100 && (
                                    <div className="mt-2 rounded-full overflow-hidden" style={{ height: 6, background: C.chip }}>
                                        <div style={{ height: "100%", width: `${uploadProgress}%`, background: C.indigo, borderRadius: 9999, transition: "width 0.3s" }} />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── PRODUCT TYPE TOGGLE ── */}
                    <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${C.border}` }}>
                        <label className={labelCls}>Product Type</label>
                        <div className="flex gap-2 mt-1">
                            {[["single", "Single Product"], ["variant", "Combination / Variant Product"]].map(([val, lbl]) => (
                                <button key={val} type="button"
                                    onClick={() => { setProductType(val) }}
                                    className="flex-1 py-2.5 text-[13px] font-bold rounded-lg border transition-all"
                                    style={{
                                        background: productType === val ? C.indigo : "transparent",
                                        color: productType === val ? "#fff" : C.textS,
                                        borderColor: productType === val ? C.indigo : C.border,
                                    }}>
                                    {lbl}
                                </button>
                            ))}
                        </div>
                        <p className="text-[12px] mt-1.5" style={{ color: C.textS }}>
                            {productType === "single"
                                ? "Standard product with a single price and stock."
                                : "Product with multiple combinations — each has its own price, stock and optional image."}
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

                            {/* Auto-generate */}
                            <div className="mb-4 p-4 rounded-xl" style={{ background: "var(--color-surface)", border: `1px solid ${C.border}` }}>
                                <p className="text-[12px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textS }}>Auto-generate from attributes</p>
                                <p className="text-[11px] mb-3" style={{ color: C.textS }}>e.g. Attribute: "Weight" → Options: "100g, 250g, 500g"</p>
                                <div className="flex gap-2 flex-wrap">
                                    <input value={newAttrName} onChange={(e) => setNewAttrName(e.target.value)}
                                        placeholder="Attribute name (e.g. Weight)" className={inputCls} style={{ flex: 1, minWidth: 130 }} />
                                    <input value={newAttrOptions} onChange={(e) => setNewAttrOptions(e.target.value)}
                                        placeholder="Options, comma-separated (e.g. 100g, 250g, 500g)" className={inputCls} style={{ flex: 2, minWidth: 200 }} />
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
                                                    setAttributes(updated); setVariantRows(rebuildVariantRows(updated, variantRows))
                                                }} className="ml-1" style={{ color: C.redText }}>✕</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Manual add */}
                            <div className="mb-4 p-4 rounded-xl" style={{ background: "var(--color-surface)", border: `1px solid ${C.border}` }}>
                                <p className="text-[12px] font-bold uppercase tracking-wider mb-3" style={{ color: C.textS }}>Or add a combination manually</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                    {[["name", "Combination Name *", "e.g. Red / Large", "text"], ["price", "Price (₹) *", "0.00", "number"], ["stock", "Stock", "0", "number"], ["sku", "SKU", "Optional", "text"]].map(([key, lbl, ph, type]) => (
                                        <div key={key}>
                                            <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>{lbl}</label>
                                            <input type={type} value={newVariant[key]} onChange={(e) => setNewVariant((v) => ({ ...v, [key]: e.target.value }))}
                                                placeholder={ph} className={inputCls} />
                                        </div>
                                    ))}
                                </div>
                                <button type="button"
                                    onClick={() => {
                                        if (!newVariant.name.trim() || !newVariant.price) return
                                        const existing = variantRows.find((v) => v.name.toLowerCase() === newVariant.name.trim().toLowerCase())
                                        if (existing) return alert("A combination with this name already exists.")
                                        setVariantRows((r) => [...r, {
                                            id: `var_${Date.now()}`, name: newVariant.name.trim(),
                                            price: newVariant.price, stock: newVariant.stock || "0", sku: newVariant.sku || "",
                                            imageUrl: "", imageFile: null, imagePreview: "",
                                        }])
                                        setNewVariant({ name: "", price: "", stock: "", sku: "" })
                                    }}
                                    className="mt-3 flex items-center gap-2 px-4 py-2 text-[13px] font-bold rounded-lg"
                                    style={{ background: "var(--color-ink)", color: "var(--color-inverse)" }}>
                                    <Plus size={14} /> Add Combination
                                </button>
                            </div>

                            {/* Combination cards */}
                            {variantRows.length > 0 && (
                                <div>
                                    <p className="text-[12px] font-bold uppercase tracking-wider mb-3" style={{ color: C.textS }}>
                                        Combinations ({variantRows.length}) — click to edit
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {variantRows.map((v, i) => {
                                            const isEditing = editingVariantId === v.id
                                            const imgSrc = v.imagePreview || v.imageUrl || null
                                            return (
                                                <div key={v.id} className="rounded-xl overflow-hidden"
                                                    style={{ border: isEditing ? "2px solid var(--color-ink)" : `1px solid ${C.border}`, background: "var(--color-surface)", transition: "border 0.15s" }}>

                                                    {/* Card header */}
                                                    <div className="flex items-center gap-3 p-3 cursor-pointer"
                                                        onClick={() => setEditingVariantId(isEditing ? null : v.id)}>
                                                        <div className="flex-shrink-0 flex items-center justify-center overflow-hidden"
                                                            style={{ width: 48, height: 48, borderRadius: 8, background: C.chip, border: `1px dashed ${C.border}` }}>
                                                            {imgSrc
                                                                ? <img src={imgSrc} alt="" className="w-full h-full object-cover" style={{ borderRadius: 8 }} />
                                                                : <ImageIcon size={18} style={{ color: "var(--color-muted)" }} />}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[14px] font-bold truncate">{v.name || <span style={{ color: C.redText }}>No name</span>}</p>
                                                            <p className="text-[12px]" style={{ color: C.textS }}>
                                                                {v.price ? `₹${v.price}` : <span style={{ color: C.redText }}>No price</span>}
                                                                {v.stock ? ` · ${v.stock} in stock` : " · stock 0"}
                                                                {v.sku ? ` · ${v.sku}` : ""}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-2 flex-shrink-0">
                                                            <span className="text-[11px] font-bold px-2 py-1 rounded"
                                                                style={{ background: isEditing ? "var(--color-ink)" : C.chip, color: isEditing ? "var(--color-inverse)" : C.textS }}>
                                                                {isEditing ? "▲ Close" : "✎ Edit"}
                                                            </span>
                                                            <button type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    setVariantRows((r) => r.filter((_, j) => j !== i))
                                                                    if (isEditing) setEditingVariantId(null)
                                                                }}
                                                                className="p-1 rounded" style={{ color: C.redText }}>
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Expanded edit panel */}
                                                    {isEditing && (
                                                        <div className="px-3 pb-4 pt-1" style={{ borderTop: `1px solid ${C.border}`, background: "var(--color-surface-muted)" }}>
                                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                                                                {[["name", "Combination Name *", "text"], ["price", "Price (₹) *", "number"], ["stock", "Stock", "number"], ["sku", "SKU (optional)", "text"]].map(([key, lbl, type]) => (
                                                                    <div key={key}>
                                                                        <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>{lbl}</label>
                                                                        <input type={type} value={v[key]}
                                                                            onChange={(e) => setVariantRows((r) => r.map((x, j) => j === i ? { ...x, [key]: e.target.value } : x))}
                                                                            className={inputCls} />
                                                                    </div>
                                                                ))}

                                                                {/* Variant image */}
                                                                <div className="sm:col-span-2">
                                                                    <label className="text-[11px] font-semibold mb-1 block" style={{ color: C.textS }}>Variant Image (optional)</label>
                                                                    <label className="flex items-center gap-3 cursor-pointer rounded-xl p-2"
                                                                        style={{ border: `1px dashed ${C.border}`, background: "var(--color-surface)", minHeight: 64 }}>
                                                                        {imgSrc ? (
                                                                            <img src={imgSrc} alt="" className="flex-shrink-0 object-cover rounded-lg" style={{ width: 56, height: 56 }} />
                                                                        ) : (
                                                                            <div className="flex-shrink-0 flex items-center justify-center rounded-lg"
                                                                                style={{ width: 56, height: 56, background: C.chip }}>
                                                                                <UploadCloud size={20} style={{ color: "var(--color-muted)" }} />
                                                                            </div>
                                                                        )}
                                                                        <div>
                                                                            <p className="text-[12px] font-semibold">Click to upload image</p>
                                                                            <p className="text-[11px]" style={{ color: C.textS }}>JPG, PNG, WEBP · optional</p>
                                                                        </div>
                                                                        <input type="file" accept="image/*" className="hidden"
                                                                            onChange={(e) => {
                                                                                const file = e.target.files[0]
                                                                                if (!file) return
                                                                                const preview = URL.createObjectURL(file)
                                                                                setVariantRows((r) => r.map((x, j) => j === i ? { ...x, imageFile: file, imagePreview: preview } : x))
                                                                            }} />
                                                                    </label>
                                                                    {imgSrc && (
                                                                        <button type="button"
                                                                            onClick={() => setVariantRows((r) => r.map((x, j) => j === i ? { ...x, imageFile: null, imagePreview: "", imageUrl: "" } : x))}
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
                                    <p className="text-[12px] mt-1" style={{ color: C.textS }}>Auto-generate from attributes above, or add manually.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── ACTION BUTTONS ── */}
                    <div className="flex flex-col sm:flex-row gap-3 mt-8 pt-6" style={{ borderTop: `1px solid ${C.border}` }}>
                        <button type="button" onClick={saveProduct} disabled={loading}
                            className="flex items-center justify-center gap-2 flex-1 py-3 rounded-xl text-[15px] font-bold transition-all"
                            style={{
                                background: saved ? "var(--color-success)" : "var(--color-ink)",
                                color: "var(--color-inverse)",
                                opacity: loading ? 0.7 : 1,
                            }}>
                            {saved ? <><CheckCircle2 size={18} /> Saved!</> : loading ? `Saving… ${uploadProgress > 0 ? `${Math.round(uploadProgress)}%` : ""}` : <><Save size={18} /> Save Changes</>}
                        </button>
                        <button type="button" onClick={() => navigate("/admin/add-product")} disabled={loading}
                            className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-[15px] font-bold border transition-colors"
                            style={{ borderColor: C.border, color: C.textS }}>
                            <ArrowLeft size={16} /> Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default EditProductPage