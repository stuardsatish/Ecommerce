import { useState, useCallback } from "react"
import { callFunction } from "../../utils/edgeFunctions"
import { toast } from "react-toastify"
import { useDispatch, useSelector } from "react-redux"
import { clearCart } from "../../context/CartSlice"
import { broadcastAuth } from "../../utils/sessionUtils"
import {
  ClipboardPaste, CheckCircle2, AlertCircle, Loader2,
  User, Mail, Phone, Package, ShoppingBag, X, Banknote,
  Clock, BadgeCheck, Trash2
} from "lucide-react"

/* ── design tokens (match existing admin pages) ─────────────────────────── */
const C = {
  brand:     "var(--color-primary)",
  brandDark: "var(--color-error)",
  surface:   "var(--color-surface-muted)",
  border:    "var(--color-border)",
  textP:     "var(--color-ink)",
  textS:     "var(--color-body)",
  textMuted: "var(--color-muted)",
  white:     "var(--color-surface)",
  green:     "var(--color-success)",
  greenBg:   "var(--color-success-subtle)",
  red:       "var(--color-error)",
  redBg:     "var(--color-error-subtle)",
  blueBg:    "var(--color-info-subtle)",
  blueText:  "var(--color-body)",
}
const INTER   = "'Inter', sans-serif"
const MANROPE = "'Manrope', sans-serif"


/* ── helpers ────────────────────────────────────────────────────────────── */
const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`


/* ── simple CLIENT-SIDE parser for live preview (non-authoritative) ──────── */
function clientParse(text) {
  if (!text.trim()) return null
  const clean = text.replace(/\*+/g, "")
  const lines  = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  const result = {
    customerId: "", customerName: "", email: "", phone: "",
    items: [], totalItems: 0,
    subtotal: 0, shipping: 0, promoCode: "", promoDiscount: 0, totalAmount: 0,
  }
  const pick       = (line) => line.slice(line.indexOf(":") + 1).trim()
  // Keep only digits and decimal point — fixes ₹8.18 being parsed as 818
  const parsePrice = (str)  => parseFloat(String(str).replace(/[^0-9.]/g, "")) || 0

  for (const line of lines) {
    const lc = line.toLowerCase()
    if      (lc.startsWith("customer id:"))   result.customerId   = pick(line)
    else if (lc.startsWith("customer name:")) result.customerName = pick(line)
    else if (lc.startsWith("email:"))         result.email        = pick(line)
    else if (lc.startsWith("phone:"))         result.phone        = pick(line)
    else if (/^total items\s*:/.test(lc))     result.totalItems   = parseInt(pick(line), 10) || 0
    else if (/^subtotal\s*:/.test(lc))        result.subtotal     = parsePrice(pick(line))
    else if (/^shipping\s*:/.test(lc))        result.shipping     = parsePrice(pick(line))
    else if (/^promo code\s*:/.test(lc)) { const v = pick(line); result.promoCode = (v === "None" || v === "none") ? "" : v }
    else if (/^promo discount\s*:/.test(lc))  result.promoDiscount = parsePrice(pick(line))
    else if (/^total amount\s*:/.test(lc))    result.totalAmount  = parsePrice(pick(line))
  }

  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(/^(\d+)[.)\s]+(.+)$/)
    if (m) {
      const title = m[2].trim()
      let qty = 0, mrp = 0, discountPct = 0, discountedPrice = 0, legacyPrice = 0
      let j = i + 1
      while (j < lines.length) {
        const nl = lines[j].toLowerCase()
        if      (nl.startsWith("quantity:"))          { qty             = parseInt(lines[j].slice(lines[j].indexOf(":") + 1), 10) || 0; j++ }
        else if (nl.startsWith("mrp:"))               { mrp             = parsePrice(lines[j].slice(lines[j].indexOf(":") + 1)); j++ }
        else if (nl.startsWith("discount:"))          { discountPct     = parseFloat(lines[j].slice(lines[j].indexOf(":") + 1).replace(/%/g,"").trim()) || 0; j++ }
        else if (nl.startsWith("discounted price:"))  { discountedPrice = parsePrice(lines[j].slice(lines[j].indexOf(":") + 1)); j++ }
        else if (nl.startsWith("price:"))             { legacyPrice     = parsePrice(lines[j].slice(lines[j].indexOf(":") + 1)); j++ }
        else if (/^\d+[.)\s]/.test(lines[j]) || /^(total|subtotal|shipping|promo)/.test(nl)) break
        else j++
      }
      if (title && qty > 0) result.items.push({
        title, quantity: qty,
        price: discountedPrice || mrp || legacyPrice,
        mrp:   mrp || legacyPrice,
        discountPct,
      })
      i = j
    } else i++
  }
  return result
}

/* ─────────────────────────────────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────────────────────────────────── */
const CreateOrdersPage = () => {
  const dispatch = useDispatch()
  const currentUser = useSelector((state) => state.user.user)
  const [message,       setMessage]       = useState("")
  const [paymentStatus, setPaymentStatus] = useState("paid")   // "paid" | "pending"
  const [loading,       setLoading]       = useState(false)
  const [result,        setResult]        = useState(null)   // { success, orderId, parsedOrder, error }

  const preview = clientParse(message)
  const hasContent = message.trim().length > 0

  const handleClear = () => {
    setMessage("")
    setResult(null)
  }

  const handleSubmit = useCallback(async (allowPriceOverride = false) => {
    if (!hasContent) return
    setLoading(true)
    setResult(null)

    try {
      const { res, data } = await callFunction("orders-manual-create", { message, paymentStatus, allowPriceOverride })

      // Server refused because the pasted total ≠ the live catalog total.
      // Ask the admin to explicitly confirm the negotiated price, then retry.
      if (res.status === 409 && data.code === "PRICE_MISMATCH") {
        setLoading(false)
        const ok = window.confirm(
          `Price mismatch:\n\nPasted total: ${money(data.pastedTotal)}\nCatalog total: ${money(data.serverTotal)}\n\n` +
          `Create the order at the pasted (negotiated) price of ${money(data.pastedTotal)}?`
        )
        if (ok) return handleSubmit(true)
        setResult({ success: false, error: "Order cancelled — price mismatch not confirmed." })
        return
      }

      if (res.ok && data.success) {
        setResult({ success: true, orderId: data.orderId, parsedOrder: data.parsedOrder })
        toast.success(`Order ${data.orderId} created successfully!`, { theme: "dark" })

        // Clear the currently logged-in (admin) user's cart in Redux and broadcast it.
   const userUid = currentUser?.uid
   if (userUid) {
    dispatch(clearCart())
    broadcastAuth("cart-clear")
    localStorage.setItem("cart-clear-trigger", Date.now().toString())
   }

   // Reload the page after a short delay so the toast is visible
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        setResult({ success: false, error: data.error || "Failed to create order" })
        toast.error(data.error || "Failed to create order")
      }
    } catch (err) {
      const msg = err.message || "Network error — could not reach the server"
      setResult({ success: false, error: msg })
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [message, paymentStatus, hasContent, dispatch, currentUser])

  /* ── styles (shared shorthand) ──────────────────────────────────────── */
  const card = {
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: "16px",
    padding: "28px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
  }
  const label = {
    fontFamily: MANROPE,
    fontWeight: 700,
    fontSize: "13px",
    letterSpacing: "0.6px",
    textTransform: "uppercase",
    color: C.textS,
    marginBottom: "10px",
    display: "block",
  }

  return (
    <div style={{ background: C.surface, minHeight: "100vh", fontFamily: INTER, color: C.textP }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "40px 32px 80px" }}>

        {/* ── PAGE HEADER ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: "36px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "8px" }}>
            <div style={{
              width: "44px", height: "44px", borderRadius: "12px",
              background: `color-mix(in srgb, var(--color-primary) 9%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              <ClipboardPaste size={22} color={C.brand} />
            </div>
            <h1 style={{ fontFamily: MANROPE, fontWeight: 800, fontSize: "28px", letterSpacing: "-0.5px", margin: 0 }}>
              Create Manual Order
            </h1>
          </div>
          <p style={{ color: C.textS, fontSize: "15px", margin: 0, paddingLeft: "58px" }}>
            Paste a WhatsApp order message. The backend will parse, validate, and create the order
            using the same pipeline as online payments.
          </p>
        </div>

        {/* ── TWO-COLUMN LAYOUT ───────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "24px", alignItems: "start" }}>

          {/* ── LEFT: INPUT CARD ────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

            {/* Textarea card */}
            <div style={card}>
              <label style={label}>
                <ClipboardPaste size={13} style={{ marginRight: "6px", verticalAlign: "middle" }} />
                Paste WhatsApp Order
              </label>
              <textarea
                id="whatsapp-order-input"
                value={message}
                onChange={(e) => { setMessage(e.target.value); setResult(null) }}
                placeholder={"Paste the entire WhatsApp order here...\n\nExample:\nCustomer Name: Satish\nEmail: satish@example.com\n\n1. Product Name\nQuantity: 2\nPrice: 499\n\nTotal Amount : ₹998"}
                style={{
                  width: "100%",
                  minHeight: "360px",
                  resize: "vertical",
                  background: C.surface,
                  border: `1.5px solid ${C.border}`,
                  borderRadius: "10px",
                  padding: "16px",
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize: "13px",
                  lineHeight: "1.7",
                  color: C.textP,
                  outline: "none",
                  transition: "border-color 0.2s",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => (e.target.style.borderColor = C.brand)}
                onBlur={(e)  => (e.target.style.borderColor = C.border)}
              />
            </div>

            {/* Payment status card */}
            <div style={card}>
              <label style={label}>
                <Banknote size={13} style={{ marginRight: "6px", verticalAlign: "middle" }} />
                Payment Status
              </label>
              <div style={{ display: "flex", gap: "12px" }}>
                {[
                  { value: "paid",    label: "Paid",    icon: BadgeCheck, color: C.green, bg: C.greenBg },
                  { value: "pending", label: "Pending", icon: Clock,      color: "var(--color-accent-strong)", bg: "var(--color-accent-subtle)" },
                ].map(({ value, label: lbl, icon: Icon, color, bg }) => {
                  const active = paymentStatus === value
                  return (
                    <button
                      key={value}
                      id={`payment-status-${value}`}
                      onClick={() => setPaymentStatus(value)}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        height: "48px",
                        borderRadius: "10px",
                        border: active ? `2px solid ${color}` : `1.5px solid ${C.border}`,
                        background: active ? bg : C.white,
                        color: active ? color : C.textS,
                        fontFamily: MANROPE,
                        fontWeight: 700,
                        fontSize: "14px",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      <Icon size={16} />
                      {lbl}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                id="create-order-btn"
                onClick={() => handleSubmit(false)}
                disabled={loading || !hasContent}
                style={{
                  flex: 1,
                  height: "52px",
                  background: loading || !hasContent ? "var(--color-disabled)" : C.brand,
                  color: C.white,
                  border: "none",
                  borderRadius: "12px",
                  fontFamily: MANROPE,
                  fontWeight: 700,
                  fontSize: "15px",
                  cursor: loading || !hasContent ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                  transition: "background 0.2s",
                  boxShadow: loading || !hasContent ? "none" : `0 4px 16px color-mix(in srgb, var(--color-primary) 25%, transparent)`,
                }}
              >
                {loading
                  ? <><Loader2 size={18} className="animate-spin" /> Processing…</>
                  : <><ShoppingBag size={18} /> Create Order</>
                }
              </button>

              <button
                id="clear-order-btn"
                onClick={handleClear}
                disabled={loading}
                style={{
                  width: "52px",
                  height: "52px",
                  background: C.white,
                  border: `1.5px solid ${C.border}`,
                  borderRadius: "12px",
                  cursor: loading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: C.textS,
                  transition: "border-color 0.15s, color 0.15s",
                }}
                title="Clear"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.color = C.brand }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textS }}
              >
                <Trash2 size={18} />
              </button>
            </div>

            {/* Result banner */}
            {result && (
              <div style={{
                ...card,
                padding: "20px 24px",
                background: result.success ? C.greenBg : C.redBg,
                border: `1.5px solid ${result.success ? "var(--color-success-border)" : "var(--color-error-subtle)"}`,
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {result.success
                    ? <CheckCircle2 size={20} color={C.green} />
                    : <AlertCircle  size={20} color={C.red}   />
                  }
                  <span style={{ fontFamily: MANROPE, fontWeight: 700, fontSize: "15px",
                    color: result.success ? C.green : C.red }}>
                    {result.success ? "Order Created Successfully" : "Order Creation Failed"}
                  </span>
                </div>

                {result.success && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px",
                      color: C.green, fontWeight: 600 }}>
                      Order ID: {result.orderId}
                    </span>
                    {result.parsedOrder?.isGuest && (
                      <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                        Created as guest order — no matching user account found.
                      </span>
                    )}
                  </div>
                )}

                {!result.success && (
                  <p style={{ margin: 0, fontSize: "14px", color: C.red, whiteSpace: "pre-line" }}>
                    {result.error}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT: LIVE PREVIEW PANEL ────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", position: "sticky", top: "104px" }}>

            {/* Customer preview */}
            <div style={card}>
              <label style={label}>
                <User size={13} style={{ marginRight: "6px", verticalAlign: "middle" }} />
                Parsed Customer
              </label>

              {preview && (preview.customerName || preview.email) ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {[
                    { icon: User,  value: preview.customerName || "—",  label: "Name" },
                    { icon: Mail,  value: preview.email        || "—",  label: "Email" },
                    { icon: Phone, value: preview.phone        || "—",  label: "Phone" },
                  ].map(({ icon: Icon, value, label: lbl }) => (
                    <div key={lbl} style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                      <div style={{
                        width: "32px", height: "32px", borderRadius: "8px",
                        background: `color-mix(in srgb, var(--color-primary) 7%, transparent)`, display: "flex", alignItems: "center",
                        justifyContent: "center", flexShrink: 0,
                      }}>
                        <Icon size={14} color={C.brand} />
                      </div>
                      <div>
                        <div style={{ fontSize: "11px", color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          {lbl}
                        </div>
                        <div style={{ fontSize: "14px", color: C.textP, fontWeight: 500, marginTop: "2px" }}>
                          {value}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "24px 0", color: C.textMuted, fontSize: "13px" }}>
                  Paste a message to see preview
                </div>
              )}
            </div>

            {/* Items preview */}
            <div style={card}>
              <label style={label}>
                <Package size={13} style={{ marginRight: "6px", verticalAlign: "middle" }} />
                Parsed Items {preview?.items?.length ? `(${preview.items.length})` : ""}
              </label>

              {preview?.items?.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {preview.items.map((item, idx) => (
                    <div key={idx} style={{
                      background: C.surface,
                      borderRadius: "10px",
                      padding: "12px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "8px",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: C.textP,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.title}
                        </div>
                        <div style={{ fontSize: "12px", color: C.textMuted, marginTop: "2px" }}>
                          Qty: {item.quantity}
                        </div>
                      </div>
                      {item.price > 0 && (
                        <span style={{ fontSize: "13px", fontWeight: 700, color: C.brand, flexShrink: 0 }}>
                          {money(item.price * item.quantity)}
                        </span>
                      )}
                    </div>
                  ))}

                  {/* Subtotal / Shipping / Promo breakdown */}
                  {(preview.shipping > 0 || preview.promoDiscount > 0) && (
                    <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: "10px", marginTop: "2px",
                      display: "flex", flexDirection: "column", gap: "6px" }}>
                      {preview.subtotal > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: "12px", color: C.textMuted }}>Subtotal</span>
                          <span style={{ fontSize: "12px", color: C.textS, fontWeight: 600 }}>{money(preview.subtotal)}</span>
                        </div>
                      )}
                      {preview.shipping > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: "12px", color: C.textMuted }}>Shipping</span>
                          <span style={{ fontSize: "12px", color: C.textS, fontWeight: 600 }}>{money(preview.shipping)}</span>
                        </div>
                      )}
                      {preview.promoDiscount > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: "12px", color: C.green }}>Promo {preview.promoCode ? `(${preview.promoCode})` : "Discount"}</span>
                          <span style={{ fontSize: "12px", color: C.green, fontWeight: 600 }}>-{money(preview.promoDiscount)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Total row */}
                  {preview.totalAmount > 0 && (
                    <div style={{
                      borderTop: `1px dashed ${C.border}`,
                      paddingTop: "12px",
                      marginTop: "4px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}>
                      <span style={{ fontFamily: MANROPE, fontWeight: 700, fontSize: "14px", color: C.textS }}>
                        Total ({preview.totalItems || preview.items.reduce((s, i) => s + i.quantity, 0)} items)
                      </span>
                      <span style={{ fontFamily: MANROPE, fontWeight: 800, fontSize: "16px", color: C.brand }}>
                        {money(preview.totalAmount)}
                      </span>
                    </div>
                  )}

                  {/* Payment status badge */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingTop: "4px" }}>
                    {paymentStatus === "paid"
                      ? <><BadgeCheck size={14} color={C.green} /><span style={{ fontSize: "12px", color: C.green, fontWeight: 600 }}>Will be marked Paid</span></>
                      : <><Clock      size={14} color="var(--color-accent-strong)" /><span style={{ fontSize: "12px", color: "var(--color-accent-strong)", fontWeight: 600 }}>Will be marked Pending</span></>
                    }
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "24px 0", color: C.textMuted, fontSize: "13px" }}>
                  No items detected yet
                </div>
              )}
            </div>

            {/* Info card */}
            <div style={{
              ...card,
              background: C.blueBg,
              border: `1px solid var(--color-info-subtle)`,
              padding: "18px 20px",
            }}>
              <p style={{ margin: 0, fontSize: "13px", color: C.blueText, lineHeight: "1.6" }}>
                <strong> What happens on submit:</strong><br />
                The server parses, matches each product to the catalog,
                validates stock, deducts inventory, creates the order,
                updates analytics, clears the customer's cart, and records
                the revenue — identical to an online payment.
              </p>
            </div>
          </div>

        </div>{/* end grid */}
      </div>
    </div>
  )
}

export default CreateOrdersPage