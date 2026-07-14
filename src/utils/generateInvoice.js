import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { getInvoiceSettings } from "../services/settingsService"

/**
 * @typedef {Object} OrderProduct
 * @property {string} [title]    Product name
 * @property {string} [sku]      SKU / item code
 * @property {number} [price]    Unit price (GST-inclusive)
 * @property {number} [quantity] Quantity ordered
 * @property {string} [category] Product category
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} [orderId]
 * @property {string} [userName]
 * @property {string} [userEmail]
 * @property {string} [userPhone]
 * @property {string} [address]
 * @property {string} [shippingAddress]
 * @property {number} [total]
 * @property {string} [paymentMethod]
 * @property {string} [paymentStatus]
 * @property {*}      [createdAt]   Firestore Timestamp | ISO string | Date
 * @property {OrderProduct[]} [products]
 */

/* ============================== CONFIG ============================== */
const COMPANY = {
  name: "Nexus Commerce Pvt. Ltd.",
  address: "12 Industrial Layout, Whitefield, Bengaluru, Karnataka 560066",
  gstin: "29ABCDE1234F1Z5",
  state: "Karnataka",
  email: "support@nexuscommerce.in",
  phone: "+91 80 4000 1234",
}
const GST_RATE = 0.18 // 18% — line prices are treated as GST-inclusive (India retail convention)
const CUR = "Rs. "

/* ============================== HELPERS ============================== */
/** Strip HTML tags + collapse whitespace from any value, with a fallback. */
const clean = (v, fallback = "N/A") => {
  const s = String(v ?? "").replace(/<[^>]*>/g, "").trim()
  return s === "" ? fallback : s
}
/** Format a number as a 2-decimal money string. */
const money = (n) => `${CUR}${Number(n || 0).toFixed(2)}`
/** Coerce a Firestore Timestamp / ISO string / Date into a JS Date (or null). */
const toDate = (v) => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}
/** Format a date as "DD Mon YYYY", or "N/A". */
const fmtDate = (d) => (d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "N/A")
/** Make a string safe for a filename. */
const fileSafe = (s) => String(s || "").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "NA"

/** Load an image from an external URL and resolve an HTML Image Element. */
const loadImage = (url) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous"; // Prevent CORS issues
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
};

/**
 * Generate and download a professional A4 PDF tax invoice for an order,
 * fully client-side. Safe to call from both user and admin pages.
 *
 * @param {Order} order               The order document.
 * @param {Object} [userDetails={}]   Optional customer details ({name,email,phone,address,state}).
 * @returns {Promise<void>}
 */
export async function generateInvoice(order, userDetails = {}) {
  if (!order) return

  // Fetch customizable settings from Firestore or fall back to defaults
  let invoiceSettings = null;
  try {
    invoiceSettings = await getInvoiceSettings();
  } catch (error) {
    console.error("Error fetching invoice settings for PDF:", error);
  }

  const settings = invoiceSettings || {};
  console.log("DEBUG: Fetched Invoice Settings:", invoiceSettings);
  const companyName = settings.companyName || COMPANY.name;
  const address = settings.address || COMPANY.address;
  const email = settings.email || COMPANY.email;
  const phone = settings.mobile || settings.phone || COMPANY.phone;
  const gstin = settings.gstin || COMPANY.gstin;
  const website = settings.website || "";

  // Pre-load company logo image if URL is configured
  let logoImg = null;
  if (settings.logo) {
    try {
      logoImg = await loadImage(settings.logo);
    } catch (error) {
      console.error("Failed to load invoice logo image:", error);
    }
  }

  const doc = new jsPDF({ unit: "pt", format: "a4" })
  const M = 40
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - M * 2
  const rightX = pageW - M

  /* ---- identifiers ---- */
  const rawId = order.externalOrderId ? String(order.externalOrderId).replace(/^#/, "") : (order.orderId || order.id || "")
  const now = new Date()
  const invDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
  const invoiceNo = `INV-${invDate}-${rawId}`
  const orderDate = fmtDate(toDate(order.createdAt))
  const customerName = clean(userDetails.name || order.userName, "Guest Customer")

  /* ---- line items + tax maths ---- */
  const products = Array.isArray(order.products) ? order.products : []
  let itemsTotal = 0

  const getItemFinalPrice = (p) => {
    const mrp = Number(p.originalPrice ?? p.price ?? 0)
    const disc = Number(p.discount || 0)
    const stored = Number(p.finalPrice ?? p.price ?? 0)
    if (disc > 0 && stored >= mrp && mrp > 0) {
      return Math.round(mrp * (1 - disc / 100) * 100) / 100
    }
    return stored || mrp
  }

  const body = products.map((p, i) => {
    const qty = Number(p.quantity) || 1
    const mrp = Number(p.originalPrice ?? p.price ?? p.finalPrice) || 0
    const unit = getItemFinalPrice(p)
    const discAmt = Math.max(0, Number((mrp - unit).toFixed(2)))
    const discPct = discAmt > 0
      ? (Number(p.discount) > 0 ? `${Math.round(Number(p.discount))}%` : `${Math.round((discAmt / mrp) * 100)}%`)
      : "0%"
    const lineTotal = unit * qty
    itemsTotal += lineTotal
    const taxable = lineTotal / (1 + GST_RATE)
    return [
      String(i + 1),
      discAmt > 0
        ? `${clean(p.title, "Item")} (${discPct} off Rs.${mrp.toFixed(2)})`
        : clean(p.title, "Item"),
      clean(p.sku, "N/A"),
      String(qty),
      money(mrp),
      money(discAmt),
      `${Math.round(GST_RATE * 100)}%`,
      money(taxable),
      money(lineTotal),
    ]
  })
  if (body.length === 0) body.push(["1", "N/A", "N/A", "0", money(0), money(0), "0%", money(0), money(0)])

  const grand = Number(order.total) || itemsTotal
  const promoDiscount = Number(order.promoDiscount ?? 0)
  const promoCode = order.promoCode || ""
  const storedShipping = Number(order.shipping ?? 0)
  const derivedShipping = Math.max(0, Math.round((grand - itemsTotal + promoDiscount) * 100) / 100)
  const shipping = storedShipping > 0 ? storedShipping : derivedShipping
  const goodsValue = itemsTotal
  const taxableTotal = goodsValue / (1 + GST_RATE)
  const gstTotal = goodsValue - taxableTotal

  const interState = !!userDetails.state && clean(userDetails.state, "").toLowerCase() !== (settings.state || COMPANY.state).toLowerCase()

  /* ============================== HEADER ============================== */
  let textY = M;
  const logoSize = 40;

  if (logoImg) {
    try {
      doc.addImage(logoImg, "PNG", M, M, logoSize, logoSize);
    } catch (e) {
      console.error("Failed to add logo to jsPDF document:", e);
    }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(20)
    doc.setTextColor(40, 20, 180)
    doc.text(companyName, M + 50, M + 15)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(70, 68, 85)
    textY = M + 50;
  } else {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(20)
    doc.setTextColor(40, 20, 180)
    doc.text(companyName, M, M + 6)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(70, 68, 85)
    textY = M + 24;
  }

  // Render company address rows
  if (address) {
    doc.text(address, M, textY);
    textY += 14;
  }

  // Render email | mobile/phone | website dynamically
  const contactParts = [];
  if (email) contactParts.push(email);
  if (phone) contactParts.push(phone);
  if (website) contactParts.push(website);
  if (contactParts.length > 0) {
    doc.text(contactParts.join("  |  "), M, textY);
    textY += 14;
  }

  // Render GSTIN number if available
  if (gstin) {
    doc.text(`GSTIN: ${gstin}`, M, textY);
    textY += 14;
  }

  const separatorY = Math.max(textY + 4, M + 64);

  // draw separator line
  doc.setDrawColor(199, 196, 215)
  doc.line(M, separatorY, rightX, separatorY)

  // "TAX INVOICE" label (right)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.setTextColor(25, 28, 30)
  doc.text("TAX INVOICE", rightX, M + 6, { align: "right" })

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(70, 68, 85)
  doc.text(`Invoice No: ${invoiceNo}`, rightX, M + 20, { align: "right" })
  doc.text(`Invoice Date: ${fmtDate(now)}`, rightX, M + 38, { align: "right" })
  doc.text(`Order Date: ${orderDate}`, rightX, M + 52, { align: "right" })

  /* ============================== BILL TO / SHIP TO ============================== */
  const addr = clean(userDetails.address || order.address || order.shippingAddress, "Address not on file")
  const emailVal = clean(userDetails.email || order.userEmail)
  const phoneVal = clean(userDetails.phone || order.userPhone)
  let y = separatorY + 20

  const colGap = contentW / 2
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(25, 28, 30)
  doc.text("BILL TO", M, y)
  doc.text("SHIP TO", M + colGap, y)
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(70, 68, 85)

  const billLines = [customerName, emailVal, phoneVal, ...doc.splitTextToSize(addr, colGap - 16)]
  const shipLines = [customerName, phoneVal, ...doc.splitTextToSize(addr, colGap - 16)]
  billLines.forEach((l, i) => doc.text(String(l), M, y + 16 + i * 13))
  shipLines.forEach((l, i) => doc.text(String(l), M + colGap, y + 16 + i * 13))
  y += 16 + Math.max(billLines.length, shipLines.length) * 13 + 12

  /* ============================== ITEMS TABLE ============================== */
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["#", "Product", "SKU", "Qty", "Unit", "Disc.", "GST", "Taxable", "Total"]],
    body,
    styles: { font: "helvetica", fontSize: 8, cellPadding: 5, textColor: [40, 40, 50], lineColor: [225, 224, 235], lineWidth: 0.5 },
    headStyles: { fillColor: [40, 20, 180], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 247, 252] },
    columnStyles: {
      0: { halign: "center", cellWidth: 24 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 60 },
      3: { halign: "center", cellWidth: 28 },
      4: { halign: "right", cellWidth: 58 },
      5: { halign: "right", cellWidth: 48 },
      6: { halign: "center", cellWidth: 32 },
      7: { halign: "right", cellWidth: 64 },
      8: { halign: "right", cellWidth: 64 },
    },
  })

  /* ============================== SUMMARY BLOCK (right) ============================== */
  let sy = doc.lastAutoTable.finalY + 18
  const labelX = rightX - 200
  const valX = rightX
  const row = (label, value, opts = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal")
    doc.setFontSize(opts.bold ? 11 : 9)
    doc.setTextColor(...(opts.color || [70, 68, 85]))
    doc.text(label, labelX, sy)
    doc.text(value, valX, sy, { align: "right" })
    sy += opts.bold ? 18 : 14
  }
  row("Subtotal (Taxable)", money(taxableTotal))
  if (interState) {
    row(`IGST (${Math.round(GST_RATE * 100)}%)`, money(gstTotal))
  } else {
    row(`CGST (${(GST_RATE * 100) / 2}%)`, money(gstTotal / 2))
    row(`SGST (${(GST_RATE * 100) / 2}%)`, money(gstTotal / 2))
  }
  row("Shipping", shipping === 0 ? "FREE" : money(shipping))
  if (promoDiscount > 0) {
    row(`Promo Discount${promoCode ? ` (${promoCode})` : ""}`, `-${money(promoDiscount)}`, { color: [21, 128, 61] })
  }
  doc.setDrawColor(199, 196, 215); doc.line(labelX, sy - 4, valX, sy - 4)
  row("Grand Total", money(grand), { bold: true, color: [40, 20, 180] })

  /* ---- payment row (left, aligned with summary) ---- */
  let py = doc.lastAutoTable.finalY + 18
  const txnId = clean(order.razorpayPaymentId, "")
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(25, 28, 30)
  doc.text("Payment Method:", M, py)
  doc.text("Payment Status:", M, py + 16)
  if (txnId) doc.text("Transaction ID:", M, py + 32)
  doc.setFont("helvetica", "normal"); doc.setTextColor(70, 68, 85)
  doc.text(clean(order.paymentMethod, "N/A"), M + 95, py)
  doc.text(clean(order.paymentStatus, "N/A").toUpperCase(), M + 95, py + 16)
  if (txnId) doc.text(txnId, M + 95, py + 32)
  const payBottom = txnId ? py + 32 : py + 16

  /* ============================== FOOTER ============================== */
  let fy = Math.max(sy, payBottom) + 40
  if (fy > pageH - 90) fy = pageH - 90
  // dotted separator
  doc.setLineDashPattern([2, 2], 0)
  doc.setDrawColor(199, 196, 215)
  doc.line(M, fy, rightX, fy)
  doc.setLineDashPattern([], 0)

  let footerY = fy + 20;

  // Footer Title (Default "Thank You!" if settings empty or not set)
  const footerTitleText = settings.footerTitle || "Thank You!";
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(40, 20, 180)
  doc.text(footerTitleText, M, footerY)
  footerY += 14;

  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(70, 68, 85)

  // Footer Sub Note (if available)
  if (settings.footerSubNote) {
    doc.text(settings.footerSubNote, M, footerY)
    footerY += 12;
  }

  // Help info (Support Email & Phone)
  const supportEmailVal = settings.supportEmail || "";
  const supportPhoneVal = settings.supportPhone || "";
  let helpText = "";
  if (supportEmailVal && supportPhoneVal) {
    helpText = `Need help? Email ${supportEmailVal} or call ${supportPhoneVal}`;
  } else if (supportEmailVal) {
    helpText = `Need help? Email ${supportEmailVal}`;
  } else if (supportPhoneVal) {
    helpText = `Need help? Call ${supportPhoneVal}`;
  }

  if (helpText) {
    doc.text(helpText, M, footerY)
    footerY += 12;
  }

  // UPI ID (if available)
  if (settings.upiId) {
    doc.text(`UPI ID: ${settings.upiId}`, M, footerY)
    footerY += 12;
  }

  // Computer generated disclaimer
  doc.setFontSize(7); doc.setTextColor(150, 150, 160)
  doc.text("This is a computer-generated invoice and does not require a signature.", M, footerY)

  /* ============================== SAVE ============================== */
  const filename = `Invoice_${fileSafe(rawId)}_${fileSafe(customerName)}.pdf`
  doc.save(filename)
}

export default generateInvoice