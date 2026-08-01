import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSettings } from "../../hooks/useSettings";
import {
  CreditCard,
  Receipt,
  Save,
  Loader2,
  Building,
  MapPin,
  Phone,
  Mail,
  FileText,
  Globe,
  Heading,
  Info,
  DollarSign,
  Image as ImageIcon,
  Truck,
  PackageCheck,
  Banknote,
} from "lucide-react";

const Optimization = () => {
  const navigate = useNavigate();
  const {
    paymentSettings,
    invoiceSettings,
    shippingSettings,
    loading,
    savingPayment,
    savingInvoice,
    savingShipping,
    updatePaymentSettings,
    updateInvoiceSettings,
    updateShippingSettings,
  } = useSettings(); // Local Form States

  const [whatsappPayment, setWhatsappPayment] = useState(true);
  const [razorpayPayment, setRazorpayPayment] = useState(true);
  const [codPayment, setCodPayment] = useState(true); // Shipping state

  const [freeShippingThreshold, setFreeShippingThreshold] = useState(500);
  const [shippingCost, setShippingCost] = useState(49);

  const [companyName, setCompanyName] = useState("");
  const [address, setAddress] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [gstin, setGstin] = useState("");
  const [sellerState, setSellerState] = useState("");
  const [website, setWebsite] = useState("");
  const [footerTitle, setFooterTitle] = useState("Thank You!");
  const [footerSubNote, setFooterSubNote] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [upiId, setUpiId] = useState("");
  const [logo, setLogo] = useState(""); // Sync state with hook data when loaded

  useEffect(() => {
    if (!loading) {
      setWhatsappPayment(!!paymentSettings.whatsappPayment);
      setRazorpayPayment(!!paymentSettings.razorpayPayment);
      setCodPayment(paymentSettings.codPayment !== false);

      setFreeShippingThreshold(
        Number(shippingSettings.freeShippingThreshold ?? 500),
      );
      setShippingCost(Number(shippingSettings.shippingCost ?? 49));

      setCompanyName(invoiceSettings.companyName || "");
      setAddress(invoiceSettings.address || "");
      setMobile(invoiceSettings.mobile || "");
      setEmail(invoiceSettings.email || "");
      setGstin(invoiceSettings.gstin || "");
      setSellerState(invoiceSettings.state || "");
      setWebsite(invoiceSettings.website || "");
      setFooterTitle(invoiceSettings.footerTitle || "Thank You!");
      setFooterSubNote(invoiceSettings.footerSubNote || "");
      setSupportEmail(invoiceSettings.supportEmail || "");
      setSupportPhone(invoiceSettings.supportPhone || "");
      setUpiId(invoiceSettings.upiId || "");
      setLogo(invoiceSettings.logo || "");
    }
  }, [loading, paymentSettings, invoiceSettings, shippingSettings]);

  const handleSavePayment = async (e) => {
    e.preventDefault();
    await updatePaymentSettings({
      whatsappPayment,
      razorpayPayment,
      codPayment,
    });
  };

  const handleSaveShipping = async (e) => {
    e.preventDefault();
    const threshold = Number(freeShippingThreshold);
    const cost = Number(shippingCost);
    if (isNaN(threshold) || threshold < 0) {
      alert("Please enter a valid free shipping threshold (0 or more).");
      return;
    }
    if (isNaN(cost) || cost < 0) {
      alert("Please enter a valid shipping cost (0 or more).");
      return;
    }
    await updateShippingSettings({
      freeShippingThreshold: threshold,
      shippingCost: cost,
    });
  };

  const handleSaveInvoice = async (e) => {
    e.preventDefault();
    await updateInvoiceSettings({
      companyName,
      address,
      mobile,
      email,
      gstin,
      state: sellerState,
      website,
      footerTitle,
      footerSubNote,
      supportEmail,
      supportPhone,
      upiId,
      logo,
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-amber-600" />   
           {" "}
        <p className="text-neutral-500 font-medium text-sm">
          Loading modules settings...
        </p>
             {" "}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Header */}     {" "}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
               {" "}
        <div>
                   {" "}
          <h1
            className="text-3xl font-extrabold tracking-tight text-neutral-900"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
                        Optimization Module          {" "}
          </h1>
                   {" "}
          <p className="text-neutral-500 text-sm mt-1">
                        Toggle customer payment methods and customize
            downloadable invoice PDF structures.          {" "}
          </p>
                 {" "}
        </div>
             {" "}
      </div>
           {" "}
      <div className="space-y-8">
                {/* PAYMENT SETTINGS CARD */}       {" "}
        <div className="bg-white rounded-3xl border border-neutral-200/80 shadow-[0_10px_30px_rgba(0,0,0,0.02)] overflow-hidden">
                   {" "}
          <form onSubmit={handleSavePayment} className="p-6 md:p-8 space-y-6">
                       {" "}
            <div className="border-b border-neutral-100 pb-4">
                           {" "}
              <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2">
                               {" "}
                <CreditCard className="text-amber-600" size={22} /> Payment
                Settings              {" "}
              </h2>
                           {" "}
              <p className="text-neutral-500 text-sm mt-1">
                                Configure which checkout methods are active for
                users. If all are disabled, checkout will be locked.            
                 {" "}
              </p>
                         {" "}
            </div>
                       {" "}
            <div className="space-y-4">
                           {" "}
              <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider">
                                Available Payment Methods              {" "}
              </label>
                                         {" "}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* WhatsApp Payment Toggle */}               {" "}
                <div
                  onClick={() => setWhatsappPayment(!whatsappPayment)}
                  className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer select-none ${
                    whatsappPayment
                      ? "border-emerald-500/30 bg-emerald-50/20 text-emerald-900"
                      : "border-neutral-200 hover:border-neutral-300 text-neutral-600"
                  }`}
                >
                                   {" "}
                  <div className="flex items-center gap-3">
                                       {" "}
                    <input
                      type="checkbox"
                      checked={whatsappPayment}
                      readOnly
                      className="h-4.5 w-4.5 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                                       {" "}
                    <div className="text-left">
                                           {" "}
                      <span className="block font-bold text-sm">
                        WhatsApp Payment
                      </span>
                                           {" "}
                      <span className="block text-[11px] text-neutral-400 font-medium">
                        Place order and text details via WhatsApp
                      </span>
                                         {" "}
                    </div>
                                     {" "}
                  </div>
                                 {" "}
                </div>
                                {/* Razorpay Payment Toggle */}               {" "}
                <div
                  onClick={() => setRazorpayPayment(!razorpayPayment)}
                  className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer select-none ${
                    razorpayPayment
                      ? "border-amber-500/30 bg-amber-50/20 text-amber-900"
                      : "border-neutral-200 hover:border-neutral-300 text-neutral-600"
                  }`}
                >
                                   {" "}
                  <div className="flex items-center gap-3">
                                       {" "}
                    <input
                      type="checkbox"
                      checked={razorpayPayment}
                      readOnly
                      className="h-4.5 w-4.5 rounded border-neutral-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                    />
                                       {" "}
                    <div className="text-left">
                                           {" "}
                      <span className="block font-bold text-sm">
                        Razorpay Payment
                      </span>
                                           {" "}
                      <span className="block text-[11px] text-neutral-400 font-medium">
                        Secure online payments via Razorpay card/UPI
                      </span>
                                         {" "}
                    </div>
                                     {" "}
                  </div>
                                 {" "}
                </div>
                                {/* Cash on Delivery Toggle */}               {" "}
                <div
                  onClick={() => setCodPayment(!codPayment)}
                  className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer select-none ${
                    codPayment
                      ? "border-slate-500/30 bg-slate-50/40 text-slate-900"
                      : "border-neutral-200 hover:border-neutral-300 text-neutral-600"
                  }`}
                >
                                   {" "}
                  <div className="flex items-center gap-3">
                                       {" "}
                    <input
                      type="checkbox"
                      checked={codPayment}
                      readOnly
                      className="h-4.5 w-4.5 rounded border-neutral-300 text-slate-600 focus:ring-slate-500 cursor-pointer"
                    />
                                       {" "}
                    <div className="text-left flex items-center gap-2">
                                           {" "}
                      <Banknote
                        size={18}
                        className={
                          codPayment ? "text-emerald-600" : "text-neutral-400"
                        }
                      />
                                           {" "}
                      <div>
                                               {" "}
                        <span className="block font-bold text-sm">
                          Cash on Delivery (COD)
                        </span>
                                               {" "}
                        <span className="block text-[11px] text-neutral-400 font-medium">
                          Allow customers to pay cash when their order is
                          delivered.
                        </span>
                                             {" "}
                      </div>
                                         {" "}
                    </div>
                                     {" "}
                  </div>
                                 {" "}
                </div>
                             {" "}
              </div>
                         {" "}
            </div>
                       {" "}
            <div className="flex justify-end pt-2">
                           {" "}
              <button
                type="submit"
                disabled={savingPayment}
                className={`w-full sm:w-auto px-6 h-12 rounded-xl font-bold text-white text-sm tracking-wide flex items-center justify-center gap-2 shadow-md transition-all ${
                  savingPayment
                    ? "bg-neutral-300 text-neutral-500 cursor-not-allowed shadow-none"
                    : "bg-amber-600 hover:bg-amber-700 active:scale-[0.99] cursor-pointer"
                }`}
              >
                               {" "}
                {savingPayment ? (
                  <>
                                       {" "}
                    <Loader2 size={16} className="animate-spin" /> Saving
                    Settings...                  {" "}
                  </>
                ) : (
                  <>
                                        <Save size={16} /> Save Payment Settings
                                     {" "}
                  </>
                )}
                             {" "}
              </button>
                         {" "}
            </div>
                     {" "}
          </form>
                 {" "}
        </div>
                {/* SHIPPING ESTIMATE CARD */}       {" "}
        <div className="bg-white rounded-3xl border border-neutral-200/80 shadow-[0_10px_30px_rgba(0,0,0,0.02)] overflow-hidden">
                   {" "}
          <form onSubmit={handleSaveShipping} className="p-6 md:p-8 space-y-6">
                       {" "}
            <div className="border-b border-neutral-100 pb-4">
                           {" "}
              <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2">
                                <Truck className="text-amber-600" size={22} />{" "}
                Shipping Estimate              {" "}
              </h2>
                           {" "}
              <p className="text-neutral-500 text-sm mt-1">
                                Define the minimum order value required for free
                shipping and the flat shipping fee applied below that threshold.
                These values are read server-side during payment computation.  
                           {" "}
              </p>
                         {" "}
            </div>
                        {/* Live preview badge */}           {" "}
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-100">
                           {" "}
              <PackageCheck
                className="text-amber-600 flex-shrink-0"
                size={20}
              />
                           {" "}
              <p className="text-sm font-medium text-amber-800">
                                Current rule: Orders above{" "}
                <strong>₹{freeShippingThreshold}</strong> get{" "}
                <strong>free shipping</strong>; orders below pay{" "}
                <strong>₹{shippingCost}</strong> shipping.              {" "}
              </p>
                         {" "}
            </div>
                       {" "}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            {/* Free Shipping Threshold */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2.5">
                                    Free Shipping Threshold (₹)              
                   {" "}
                </label>
                               {" "}
                <div className="relative">
                                   {" "}
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-500 font-bold text-sm">
                    ₹
                  </span>
                                   {" "}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={freeShippingThreshold}
                    onChange={(e) => setFreeShippingThreshold(e.target.value)}
                    placeholder="e.g. 500"
                    className="w-full h-12 pl-8 pr-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-semibold"
                  />
                                 {" "}
                </div>
                               {" "}
                <p className="text-[11px] text-neutral-400 mt-1.5 font-medium">
                  Orders at or above this amount qualify for free delivery.
                </p>
                             {" "}
              </div>
                            {/* Shipping Cost */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2.5">
                                    Shipping Cost (₹)                {" "}
                </label>
                               {" "}
                <div className="relative">
                                   {" "}
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-500 font-bold text-sm">
                    ₹
                  </span>
                                   {" "}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={shippingCost}
                    onChange={(e) => setShippingCost(e.target.value)}
                    placeholder="e.g. 49"
                    className="w-full h-12 pl-8 pr-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-semibold"
                  />
                                 {" "}
                </div>
                               {" "}
                <p className="text-[11px] text-neutral-400 mt-1.5 font-medium">
                  Flat fee charged on orders below the free shipping threshold.
                </p>
                             {" "}
              </div>
                         {" "}
            </div>
                       {" "}
            <div className="flex justify-end pt-2">
                           {" "}
              <button
                type="submit"
                disabled={savingShipping}
                className={`w-full sm:w-auto px-6 h-12 rounded-xl font-bold text-white text-sm tracking-wide flex items-center justify-center gap-2 shadow-md transition-all ${
                  savingShipping
                    ? "bg-neutral-300 text-neutral-500 cursor-not-allowed shadow-none"
                    : "bg-amber-600 hover:bg-amber-700 active:scale-[0.99] cursor-pointer"
                }`}
              >
                               {" "}
                {savingShipping ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Saving...    
                                 {" "}
                  </>
                ) : (
                  <>
                    <Save size={16} /> Save Shipping Settings                
                     {" "}
                  </>
                )}
                             {" "}
              </button>
                         {" "}
            </div>
                     {" "}
          </form>
                 {" "}
        </div>
                {/* INVOICE SETTINGS CARD */}       {" "}
        <div className="bg-white rounded-3xl border border-neutral-200/80 shadow-[0_10px_30px_rgba(0,0,0,0.02)] overflow-hidden">
                   {" "}
          <form onSubmit={handleSaveInvoice} className="p-6 md:p-8 space-y-6">
                       {" "}
            <div className="border-b border-neutral-100 pb-4">
                           {" "}
              <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2">
                                <Receipt className="text-amber-600" size={22} />{" "}
                Invoice Settings              {" "}
              </h2>
                           {" "}
              <p className="text-neutral-500 text-sm mt-1">
                                Customize values shown inside tax invoices
                generated dynamically. Empty optional fields will be hidden in
                the PDF layout.              {" "}
              </p>
                         {" "}
            </div>
                       {" "}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Company Name */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <Building size={14} className="text-neutral-400" /> Company
                  Name <span className="text-red-500">*</span>             
                   {" "}
                </label>
                               {" "}
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Nexus Commerce Pvt. Ltd."
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-semibold"
                />
                             {" "}
              </div>
                            {/* Logo URL */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <ImageIcon size={14} className="text-neutral-400" /> Logo URL
                  (optional)                {" "}
                </label>
                               {" "}
                <input
                  type="url"
                  value={logo}
                  onChange={(e) => setLogo(e.target.value)}
                  placeholder="e.g. https://domain.com/logo.png"
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                />
                             {" "}
              </div>
                            {/* Company Address */}             {" "}
              <div className="md:col-span-2">
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <MapPin size={14} className="text-neutral-400" /> Company
                  Address                {" "}
                </label>
                               {" "}
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Full physical billing location details"
                  rows={2}
                  className="w-full p-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium resize-none"
                />
                             {" "}
              </div>
                            {/* Company Mobile */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <Phone size={14} className="text-neutral-400" /> Company
                  Mobile                {" "}
                </label>
                               {" "}
                <input
                  type="text"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="e.g. +91 99405 74522"
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                />
                             {" "}
              </div>
                            {/* Company Email */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <Mail size={14} className="text-neutral-400" /> Company Email
                                 {" "}
                </label>
                               {" "}
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. billing@company.com"
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                />
                             {" "}
              </div>
                            {/* GSTIN Number */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <FileText size={14} className="text-neutral-400" /> GSTIN
                  Number                {" "}
                </label>
                               {" "}
                <input
                  type="text"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value)}
                  placeholder="e.g. 29ABCDE1234F1Z5"
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-semibold uppercase"
                />
                             {" "}
              </div>
                           {" "}
              {/* Seller State (for GST CGST/SGST vs IGST determination) */}   
                       {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <FileText size={14} className="text-neutral-400" /> Seller
                  State                {" "}
                </label>
                               {" "}
                <input
                  type="text"
                  value={sellerState}
                  onChange={(e) => setSellerState(e.target.value)}
                  placeholder="e.g. Tamil Nadu"
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                />
                               {" "}
                <p className="text-xs text-neutral-500 mt-1">
                  Used to split GST: same state as the buyer → CGST + SGST,
                  different state → IGST.
                </p>
                             {" "}
              </div>
                            {/* Website */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <Globe size={14} className="text-neutral-400" /> Website      
                           {" "}
                </label>
                               {" "}
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="e.g. https://www.company.com"
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                />
                             {" "}
              </div>
                            {/* Invoice Footer Heading */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <Heading size={14} className="text-neutral-400" /> Footer
                  Heading                {" "}
                </label>
                               {" "}
                <input
                  type="text"
                  value={footerTitle}
                  onChange={(e) => setFooterTitle(e.target.value)}
                  placeholder="Thank You!"
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                />
                             {" "}
              </div>
                            {/* Footer Sub Note */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <Info size={14} className="text-neutral-400" /> Footer Sub
                  Note                {" "}
                </label>
                               {" "}
                <input
                  type="text"
                  value={footerSubNote}
                  onChange={(e) => setFooterSubNote(e.target.value)}
                  placeholder="We appreciate your business. Visit Again."
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                />
                             {" "}
              </div>
                            {/* Support Email */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <Mail size={14} className="text-neutral-400" /> Support Email
                                 {" "}
                </label>
                               {" "}
                <input
                  type="email"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  placeholder="e.g. support@company.com"
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                />
                             {" "}
              </div>
                            {/* Support Phone */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <Phone size={14} className="text-neutral-400" /> Support Phone
                                 {" "}
                </label>
                               {" "}
                <input
                  type="text"
                  value={supportPhone}
                  onChange={(e) => setSupportPhone(e.target.value)}
                  placeholder="e.g. +91 80 4000 1234"
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                />
                             {" "}
              </div>
                            {/* UPI ID */}             {" "}
              <div>
                               {" "}
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                   {" "}
                  <DollarSign size={14} className="text-neutral-400" /> UPI ID
                  (optional)                {" "}
                </label>
                               {" "}
                <input
                  type="text"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="e.g. company@upi"
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-semibold"
                />
                             {" "}
              </div>
                         {" "}
            </div>
                       {" "}
            <div className="flex justify-end pt-4 border-t border-neutral-100">
                           {" "}
              <button
                type="submit"
                disabled={savingInvoice}
                className={`w-full sm:w-auto px-8 h-12 rounded-xl font-bold text-white text-sm tracking-wide flex items-center justify-center gap-2 shadow-md transition-all ${
                  savingInvoice
                    ? "bg-neutral-300 text-neutral-500 cursor-not-allowed shadow-none"
                    : "bg-amber-600 hover:bg-amber-700 active:scale-[0.99] cursor-pointer"
                }`}
              >
                               {" "}
                {savingInvoice ? (
                  <>
                                       {" "}
                    <Loader2 size={16} className="animate-spin" /> Saving
                    Settings...                  {" "}
                  </>
                ) : (
                  <>
                                        <Save size={16} /> Save Invoice Settings
                                     {" "}
                  </>
                )}
                             {" "}
              </button>
                         {" "}
            </div>
                     {" "}
          </form>
                 {" "}
        </div>
             {" "}
      </div>
         {" "}
    </div>
  );
};

export default Optimization;
