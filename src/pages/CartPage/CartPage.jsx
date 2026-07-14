import React, { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  addCart,
  removeCart,
  deleteCart,
  clearCart,
} from "../../context/CartSlice";
import { toast } from "react-toastify";
import {
  Minus,
  Plus,
  ShoppingBag,
  ArrowLeft,
  Package,
  Trash2,
  ArrowRight,
  Lock,
  Headphones,
  ExternalLink,
  CreditCard,
  X,
} from "lucide-react";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { sendEmailVerification } from "firebase/auth";

import { fireDB, auth } from "../../context/FirebaseConfig";
import useIsMobile from "../../hooks/useIsMobile";
import {
  loadRazorpayScript,
  createRazorpayOrder,
  verifyRazorpayPayment,
} from "../../utils/razorpay";

const CartPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const cartItems = useSelector((state) => state.cart.cartItems);
  console.log("Cart Items:", cartItems); // Debugging line to check cart items

  const [isProcessing, setIsProcessing] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSettings, setPaymentSettings] = useState({
    whatsappPayment: true,
    razorpayPayment: true,
  });
  const [shippingConfig, setShippingConfig] = useState({
    freeShippingThreshold: 500,
    shippingCost: 49,
  });
  const [settingsLoading, setSettingsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchSettings = async () => {
      try {
        const [paySnap, shipSnap] = await Promise.all([
          getDoc(doc(fireDB, "settings", "paymentSettings")),
          getDoc(doc(fireDB, "settings", "shippingSettings")),
        ]);
        if (active) {
          if (paySnap.exists()) setPaymentSettings(paySnap.data());
          if (shipSnap.exists()) {
            const sd = shipSnap.data();
            setShippingConfig({
              freeShippingThreshold: typeof sd.freeShippingThreshold === "number" ? sd.freeShippingThreshold : 500,
              shippingCost: typeof sd.shippingCost === "number" ? sd.shippingCost : 49,
            });
          }
        }
      } catch (error) {
        console.error("Error fetching settings:", error);
      } finally {
        if (active) {
          setSettingsLoading(false);
        }
      }
    };
    fetchSettings();
    return () => {
      active = false;
    };
  }, []);

  const isCheckoutDisabled = !paymentSettings.whatsappPayment && !paymentSettings.razorpayPayment;

  // Mobile design renders below the `lg` breakpoint; the desktop redesign at lg+.
  const isMobile = useIsMobile(1024);

  /* ---------- DESKTOP REDESIGN STATE ---------- */
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);

  const total = Math.round(
    cartItems.reduce(
      (acc, item) => acc + Number(item.price) * item.quantity,
      0,
    ),
  );

  const totalItems = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  /* ---------- ORDER SUMMARY (derived from cart) ---------- */
  const money = (n) => `₹${Number(n || 0).toFixed(2)}`;
  // const subtotal = cartItems.reduce((s, i) => s + Number(i.price) * i.quantity, 0)

  //const subtotal = cartItems.reduce((s, i) => s + (Number(i.price) - Number(i.discount || 0)) * i.quantity, 0)

  const subtotal = cartItems.reduce((sum, item) => {
    const price = Number(item.price || 0);
    const quantity = Number(item.quantity || 0);
    let discount = Number(item.discount || 0);
    if (item.discountExpiry) {
      const expiry = new Date(item.discountExpiry).getTime();
      if (Date.now() > expiry) discount = 0;
    }

    const discountedPrice = price - (price * discount) / 100;

    return sum + discountedPrice * quantity;
  }, 0);

  // Calculate promo discount dynamically
  let promoDiscount = 0;
  if (appliedPromo) {
    let isExpired = false;
    if (appliedPromo.expiryDate) {
      const expiry = new Date(appliedPromo.expiryDate).getTime();
      if (Date.now() > expiry) {
        isExpired = true;
      }
    }
    if (!isExpired) {
      promoDiscount = appliedPromo.type === "percent"
        ? Math.round((subtotal * Number(appliedPromo.value || 0)) / 100)
        : Number(appliedPromo.value || 0);
    }
  }

  const shippingEstimate = subtotal >= shippingConfig.freeShippingThreshold ? 0 : shippingConfig.shippingCost;
  //const estimatedTax = subtotal * 0.08
  // const orderTotal = Math.max(0, subtotal + shippingEstimate + estimatedTax - promoDiscount)
  const orderTotal = Math.max(0, subtotal + shippingEstimate - promoDiscount);

  /* ---------- FREQUENTLY BOUGHT TOGETHER (fetched once) ---------- */
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let snap;
        try {
          snap = await getDocs(
            query(
              collection(fireDB, "products"),
              orderBy("rating", "desc"),
              limit(8),
            ),
          );
        } catch {
          snap = await getDocs(query(collection(fireDB, "products"), limit(8)));
        }
        if (active)
          setSuggestions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.log("suggestions fetch failed:", e);
      } finally {
        if (active) setLoadingSuggestions(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Exclude products already in the cart; show up to 4.
  const suggestionList = suggestions
    .filter((p) => !cartItems.some((c) => c.id === p.id))
    .slice(0, 4);

  /* ---------- PROMO CODE ---------- */
  const handleApplyPromo = async () => {
    const code = promoCode.trim().toUpperCase();
    if (!code) return;
    try {
      const snap = await getDocs(
        query(collection(fireDB, "promoCodes"), where("code", "==", code)),
      );
      if (snap.empty) {
        setAppliedPromo(null);
        toast.error("Invalid promo code");
        return;
      }
      const data = snap.docs[0].data();

      // Expiry check
      if (data.expiryDate) {
        const expiry = new Date(data.expiryDate).getTime();
        if (Date.now() > expiry) {
          setAppliedPromo(null);
          toast.error("This promo code has expired");
          return;
        }
      }

      setAppliedPromo({
        code: data.code || code,
        type: data.type || "percent",
        value: Number(data.value || 0),
        expiryDate: data.expiryDate || "",
      });

      const disc = data.type === "percent"
        ? Math.round((subtotal * (Number(data.value) || 0)) / 100)
        : Number(data.value || 0);

      toast.success(
        disc > 0 ? `Promo applied: -${money(disc)}` : "Promo applied",
      );
    } catch (e) {
      console.log("promo apply failed:", e);
      toast.error("Could not apply promo code");
    }
  };

  /* Remove an item entirely (desktop "Remove" button). */
  const handleDeleteItem = (id) => dispatch(deleteCart(id));

  /* ADD CART */

  const handleAddCart = (item) => {
    dispatch(addCart(item));
  };

  /* REMOVE CART */

  const handleRemoveCart = (id) => {
    dispatch(removeCart(id));
  };

  /* PLACE ORDER — the server prices the cart, takes payment, and writes the
     order. The client sends only { productId, quantity } and never touches the
     order/stock/analytics docs (those are admin-only at the rules level). */

  const placeOrder = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        toast.error("Please login first");
        return;
      }
      if (!cartItems.length) {
        toast.error("Your cart is empty.");
        return;
      }

      /* Require a verified email before checkout (also enforced server-side). */
      await user.reload();
      if (!user.emailVerified) {
        try {
          await sendEmailVerification(user);
        } catch (e) {
          console.log("verify email send:", e);
        }
        toast.error(
          "Please verify your email before checking out — we just sent you a verification link.",
        );
        return;
      }

      setIsProcessing(true);

      /* Prefill info only — NOT prices. */
      const userRef = doc(fireDB, "users", user.uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.exists() ? userSnap.data() : {};

      /* 1) Load the Razorpay checkout script */
      const scriptOk = await loadRazorpayScript();
      if (!scriptOk) {
        throw new Error(
          "Couldn't reach Razorpay. Check your connection and try again.",
        );
      }

      /* 2) Server validates each item against the catalog and computes the amount.
            promoCode is sent as a plain string; the server validates it against
            Firestore and applies the discount — the client never determines the value. */
      const rzpOrder = await createRazorpayOrder({
        items: cartItems.map((i) => ({
          productId: i.id,
          quantity: i.quantity,
        })),
        promoCode: appliedPromo ? appliedPromo.code : "",
      });

      /* 3) Open checkout. The order is written server-side only after verification. */
      const rzp = new window.Razorpay({
        key: rzpOrder.keyId,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        name: "Nexus Commerce",
        description: `Order • ${totalItems} item(s)`,
        order_id: rzpOrder.orderId,
        prefill: {
          name: userData.name || user.displayName || "",
          email: userData.email || user.email || "",
          contact: userData.phone || "",
        },
        theme: { color: "#A43B31" },
        handler: async (response) => {
          try {
            /* 4) Server verifies the signature AND writes the order from its own
                  validated copy — the client can't influence price or contents here. */
            await verifyRazorpayPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });

            dispatch(clearCart());
            toast.success("Payment successful — order placed ", {
              position: "bottom-right",
              autoClose: 3000,
              theme: "dark",
            });
            navigate("/products");
          } catch (err) {
            console.error("VERIFY/ORDER ERROR:", err);
            toast.error(err.message || "Payment could not be verified.");
          } finally {
            setIsProcessing(false);
          }
        },
        modal: {
          ondismiss: () => {
            setIsProcessing(false);
            toast.info("Payment cancelled.");
          },
        },
      });

      rzp.on("payment.failed", (resp) => {
        setIsProcessing(false);
        toast.error(
          resp?.error?.description || "Payment failed. Please try again.",
        );
      });

      rzp.open();
    } catch (error) {
      console.error("ORDER ERROR:", error);
      toast.error(error.message);
      setIsProcessing(false);
    }
  };

  const handleCheckoutClick = () => {
    if (!cartItems.length) {
      toast.error("Your cart is empty.");
      return;
    }
    setShowPaymentModal(true);
  };

  const handleRazorpayOrder = () => {
    setShowPaymentModal(false);
    placeOrder();
  };

  const sendOrderToWhatsApp = async () => {
    try {
      setShowPaymentModal(false);
      setIsProcessing(true);

      const user = auth.currentUser;
      let userData = {};
      if (user) {
        try {
          const userRef = doc(fireDB, "users", user.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            userData = userSnap.data();
          }
        } catch (e) {
          console.log("Error fetching user data from Firestore:", e);
        }
      }

      const customerName = userData.name || user?.displayName || "";
      const customerEmail = userData.email || user?.email || "";
      const customerPhone = userData.phone || user?.phoneNumber || "NA";
      const customerID = userData.uid || user?.uid || "";

      let itemsStr = "";
      cartItems.forEach((item, index) => {
        const mrp = Number(item.price || 0);
        let discount = Number(item.discount || 0);
        if (item.discountExpiry) {
          const expiry = new Date(item.discountExpiry).getTime();
          if (Date.now() > expiry) discount = 0;
        }
        const discountedPrice = Number((mrp - (mrp * discount) / 100).toFixed(2));
        if (discount > 0) {
          itemsStr += `${index + 1}. ${item.title}\n Quantity: ${item.quantity}\n MRP: ${money(mrp)}\n Discount: ${discount}%\n Discounted Price: ${money(discountedPrice)}\n\n`;
        } else {
          itemsStr += `${index + 1}. ${item.title}\n Quantity: ${item.quantity}\n MRP: ${money(mrp)}\n Discounted Price: ${money(mrp)}\n\n`;
        }
      });

      const totalItems = cartItems.reduce(
        (acc, item) => acc + item.quantity,
        0,
      );

      const promoLine = promoDiscount > 0
        ? `Promo Code : ${appliedPromo?.code || "Applied"}\nPromo Discount : ${money(promoDiscount)}\n`
        : "";

      const message = `Hello,

I would like to place the following order.

**Customer Details:**

Customer ID: ${customerID}
Customer Name: ${customerName}
Email: ${customerEmail}
Phone: ${customerPhone}


**Items:**

${itemsStr}
Total Items : ${totalItems}
Subtotal : ${money(subtotal)}
Shipping : ${money(shippingEstimate)}
${promoLine}Total Amount : ${money(orderTotal)}

Thank you.`;


      const encodedText = encodeURIComponent(message);
      const url = `https://wa.me/919940574522?text=${encodedText}`;
      window.open(url, "_blank");
    } catch (error) {
      console.error("WhatsApp order failed:", error);
      toast.error("Failed to generate WhatsApp order. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const paymentModal = showPaymentModal && (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center p-4"
      style={{
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={() => setShowPaymentModal(false)}
    >
      <div
        className="bg-white w-full max-w-[400px] rounded-2xl p-6 relative overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{
          boxShadow:
            "0px 20px 25px -5px rgba(0,0,0,0.1), 0px 10px 10px -5px rgba(0,0,0,0.04)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={() => setShowPaymentModal(false)}
          className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 transition-colors"
          style={{ cursor: "pointer", background: "none", border: "none" }}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        {/* Title & Subtitle */}
        <div className="text-center mb-6 pt-2">
          <h3
            className="text-xl font-bold text-neutral-800"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Choose Payment Method
          </h3>
          <p className="text-sm text-neutral-500 mt-1 font-medium">
            Select how you would like to place your order.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          {/* Button 1: Razorpay */}
          {paymentSettings.razorpayPayment && (
            <button
              onClick={handleRazorpayOrder}
              className="flex items-center justify-between w-full p-4 rounded-xl text-white transition-all transform hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: "#A43B31",
                boxShadow: "0px 4px 12px rgba(164, 59, 49, 0.2)",
                fontWeight: 700,
                fontSize: "15px",
                cursor: "pointer",
                border: "none",
              }}
            >
              <div className="flex items-center gap-3">
                <CreditCard size={20} />
                <span>Pay with Razorpay</span>
              </div>
              <ArrowRight size={16} />
            </button>
          )}

          {/* Button 2: WhatsApp */}
          {paymentSettings.whatsappPayment && (
            <button
              onClick={sendOrderToWhatsApp}
              className="flex items-center justify-between w-full p-4 rounded-xl text-white transition-all transform hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: "#25D366",
                boxShadow: "0px 4px 12px rgba(37, 211, 102, 0.2)",
                fontWeight: 700,
                fontSize: "15px",
                cursor: "pointer",
                border: "none",
              }}
            >
              <div className="flex items-center gap-3">
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="currentColor"
                >
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.37 9.864-9.799.002-2.63-1.023-5.101-2.885-6.963C16.79 1.982 14.321.958 11.7.958c-5.44 0-9.866 4.372-9.87 9.802 0 1.763.465 3.486 1.348 5.021l-.988 3.61 3.738-.973zm11.758-5.321c-.305-.153-1.808-.891-2.088-.992-.28-.102-.485-.153-.688.153-.203.305-.788.992-.966 1.196-.177.203-.355.228-.66.076-.305-.153-1.288-.475-2.455-1.517-.908-.81-1.52-1.81-1.698-2.115-.177-.305-.019-.47.133-.621.137-.136.305-.355.457-.533.153-.177.203-.305.305-.508.102-.203.05-.381-.025-.533-.076-.153-.688-1.657-.942-2.269-.248-.599-.5-.517-.688-.527-.178-.009-.381-.01-.584-.01-.203 0-.533.076-.813.381-.28.305-1.067 1.042-1.067 2.541 0 1.498 1.092 2.946 1.244 3.149.153.203 2.15 3.284 5.207 4.601.727.314 1.294.502 1.737.643.73.232 1.393.199 1.918.121.584-.087 1.808-.737 2.062-1.449.254-.712.254-1.322.178-1.449-.076-.127-.28-.203-.585-.356z" />
                </svg>
                <span>Order via WhatsApp</span>
              </div>
              <ArrowRight size={16} />
            </button>
          )}
        </div>

        {/* Cancel Button */}
        <button
          onClick={() => setShowPaymentModal(false)}
          className="w-full mt-4 text-center text-sm font-semibold text-neutral-400 hover:text-neutral-600 transition-colors py-2"
          style={{ cursor: "pointer", background: "none", border: "none" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  /* UI */

  /* ============================================================
     MOBILE LAYOUT (≤640px) — shares all cart state/handlers.
  ============================================================ */
  if (isMobile) {
    const processingOverlay = isProcessing && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 backdrop-blur-2xl bg-neutral-900/60">
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-[2rem] p-10 max-w-sm w-full text-center shadow-2xl">
          <div className="relative mb-8 h-20 flex items-center justify-center">
            <div className="absolute inset-0 bg-purple-500/20 blur-3xl rounded-full animate-pulse"></div>
            <Package size={56} className="text-white relative animate-bounce" />
          </div>
          <h2
            className="text-xl font-bold text-white leading-tight"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Placing your order…
            <br />
            Please wait for confirmation
          </h2>
          <div className="flex justify-center gap-1.5 pt-5">
            <div className="w-1.5 h-1.5 rounded-full bg-white opacity-20 animate-bounce [animation-delay:-0.3s]"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-white opacity-40 animate-bounce [animation-delay:-0.15s]"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-white opacity-60 animate-bounce"></div>
          </div>
        </div>
      </div>
    );

    return (
      <div
        className="min-h-screen w-full"
        style={{
          background: "#FBF9F8",
          fontFamily: "Inter, sans-serif",
          overflowX: "hidden",
          maxWidth: "100vw",
        }}
      >
        {cartItems.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ minHeight: "100vh", gap: "16px", padding: "96px 24px 0" }}
          >
            <ShoppingBag size={44} color="#C4C6CD" />
            <p style={{ color: "#74777D", fontSize: "14px", fontWeight: 600 }}>
              Your cart is empty.
            </p>
            <button
              onClick={() => navigate("/products")}
              style={{
                background: "#A43B31",
                color: "#fff",
                fontWeight: 700,
                fontSize: "14px",
                padding: "12px 24px",
                borderRadius: "9999px",
              }}
            >
              Discover Products
            </button>
          </div>
        ) : (
          <>
            <main style={{ padding: "96px 20px 100px" }}>
              <div className="flex flex-col" style={{ gap: "12px" }}>
                {cartItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex bg-white"
                    style={{
                      borderRadius: "12px",
                      padding: "12px",
                      gap: "12px",
                      boxShadow: "0px 4px 20px rgba(26,43,60,0.05)",
                    }}
                  >
                    <div
                      className="flex-shrink-0 flex items-center justify-center"
                      style={{
                        width: "80px",
                        height: "80px",
                        background: "#F6F3F2",
                        borderRadius: "8px",
                        padding: "8px",
                      }}
                    >
                      <img
                        src={item.thumbnail || item.image}
                        alt={item.title}
                        className="w-full h-full"
                        style={{ objectFit: "cover", borderRadius: "4px" }}
                      />
                    </div>
                    <div
                      className="flex flex-col flex-1"
                      style={{ minWidth: 0 }}
                    >
                      <p
                        style={{
                          color: "#74777D",
                          fontWeight: 600,
                          fontSize: "11px",
                          textTransform: "uppercase",
                          letterSpacing: "0.6px",
                        }}
                      >
                        {item.category}
                      </p>
                      <h3
                        style={{
                          color: "#1B1C1C",
                          fontWeight: 700,
                          fontSize: "14px",
                          lineHeight: "18px",
                          marginTop: "2px",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {item.title}
                      </h3>
                      <div
                        className="flex items-center justify-between"
                        style={{ marginTop: "auto", paddingTop: "8px" }}
                      >
                        <div
                          className="flex items-center"
                          style={{
                            border: "1px solid #E4E2E1",
                            borderRadius: "9999px",
                            overflow: "hidden",
                          }}
                        >
                          <button
                            onClick={() => handleRemoveCart(item.id)}
                            aria-label="Decrease"
                            className="flex items-center justify-center"
                            style={{
                              width: "30px",
                              height: "30px",
                              color: "#A43B31",
                            }}
                          >
                            <Minus size={14} />
                          </button>
                          <span
                            style={{
                              minWidth: "24px",
                              textAlign: "center",
                              fontWeight: 700,
                              fontSize: "13px",
                              color: "#1B1C1C",
                            }}
                          >
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => handleAddCart(item)}
                            aria-label="Increase"
                            className="flex items-center justify-center"
                            style={{
                              width: "30px",
                              height: "30px",
                              color: "#A43B31",
                            }}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        {/* <span style={{ color: "#1B1C1C", fontWeight: 700, fontSize: "16px" }}>${Number(item.price * item.quantity).toFixed(2)}</span> */}
                        {(() => {
                          const price = Number(item.price);
                          const qty = Number(item.quantity);
                          let discount = Number(item.discount || 0);
                          if (item.discountExpiry) {
                            const expiry = new Date(item.discountExpiry).getTime();
                            if (Date.now() > expiry) discount = 0;
                          }

                          const originalTotal = price * qty;
                          const discountedTotal =
                            originalTotal - (originalTotal * discount) / 100;

                          return discount > 0 ? (
                            <div className="flex flex-col items-end">
                              <span
                                style={{
                                  color: "#A43B31",
                                  fontWeight: 700,
                                  fontSize: "16px",
                                }}
                              >
                                ₹{discountedTotal.toFixed(2)}
                              </span>

                              <span
                                style={{
                                  textDecoration: "line-through",
                                  color: "#999",
                                  fontSize: "12px",
                                }}
                              >
                                ₹{originalTotal.toFixed(2)}
                              </span>

                              <span
                                style={{
                                  color: "#16A34A",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                }}
                              >
                                {discount}% OFF
                              </span>
                            </div>
                          ) : (
                            <span
                              style={{
                                color: "#1B1C1C",
                                fontWeight: 700,
                                fontSize: "16px",
                              }}
                            >
                              ₹{originalTotal.toFixed(2)}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => dispatch(clearCart())}
                className="w-full flex items-center justify-center"
                style={{
                  marginTop: "16px",
                  height: "44px",
                  borderRadius: "9999px",
                  border: "1px solid #E4E2E1",
                  color: "#74777D",
                  fontWeight: 600,
                  fontSize: "13px",
                  background: "transparent",
                }}
              >
                Clear Cart
              </button>
            </main>

            {/* BOTTOM ACTION BAR — sits above the global mobile tab bar */}
            <div
              className="fixed inset-x-0 z-50 flex items-center justify-between"
              style={{
                bottom: "calc(56px + env(safe-area-inset-bottom))",
                height: "81px",
                padding: "16px 20px",
                gap: "16px",
                background: "rgba(255,255,255,0.92)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                borderTop: "1px solid rgba(228,226,225,0.3)",
              }}
            >
              <div className="flex flex-col">
                <span
                  style={{
                    fontSize: "11px",
                    color: "#74777D",
                    fontWeight: 500,
                  }}
                >
                  Total ({totalItems})
                </span>
                <span
                  style={{
                    fontSize: "20px",
                    fontWeight: 800,
                    color: "#A43B31",
                    letterSpacing: "-0.4px",
                  }}
                >
                  ${Number(total).toFixed(2)}
                </span>
              </div>
              {isCheckoutDisabled ? (
                <div className="text-center p-2.5 border border-red-200 bg-red-50 rounded-2xl text-[10px] font-bold text-red-700 flex-1 max-w-[210px] leading-tight">
                  No payment methods available.<br />Please contact administrator.
                </div>
              ) : (
                <button
                  onClick={handleCheckoutClick}
                  disabled={isProcessing}
                  className="flex items-center justify-center flex-1"
                  style={{
                    maxWidth: "210px",
                    height: "48px",
                    background: "#A43B31",
                    borderRadius: "9999px",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: "16px",
                    boxShadow:
                      "0px 10px 15px -3px rgba(164,59,49,0.2), 0px 4px 6px -4px rgba(164,59,49,0.2)",
                    opacity: isProcessing ? 0.6 : 1,
                  }}
                >
                  {isProcessing ? "Processing…" : "Place Order"}
                </button>
              )}
            </div>
          </>
        )}

        {processingOverlay}
        {paymentModal}
      </div>
    );
  }

  return (
    <div
      className="hidden lg:flex flex-col"
      style={{
        background: "#FBF9F8",
        minHeight: "100vh",
        color: "#1B1C1C",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
          width: "100%",
          padding: "40px 80px",
          display: "flex",
          flexDirection: "column",
          gap: "40px",
        }}
      >
        {/* SECTION 1 — TITLE */}
        <div
          className="flex items-end"
          style={{ justifyContent: "space-between", gap: "16px" }}
        >
          <div className="flex flex-col" style={{ gap: "8px" }}>
            <h1
              style={{
                fontWeight: 900,
                fontSize: "36px",
                letterSpacing: "-0.9px",
                color: "#1B1C1C",
              }}
            >
              Shopping Cart
            </h1>
            <p style={{ fontWeight: 400, fontSize: "16px", color: "#44474C" }}>
              You have {totalItems} {totalItems === 1 ? "item" : "items"} in
              your cart
            </p>
          </div>
          {cartItems.length > 0 && (
            <button
              onClick={() => dispatch(clearCart())}
              className="flex items-center flex-shrink-0"
              style={{
                gap: "8px",
                height: "44px",
                padding: "0 20px",
                border: "1px solid #E4E2E1",
                borderRadius: "9999px",
                color: "#44474C",
                fontWeight: 600,
                fontSize: "14px",
                background: "#fff",
              }}
            >
              <Trash2 size={16} style={{ color: "#44474C" }} />
              Clear Cart
            </button>
          )}
        </div>

        {cartItems.length === 0 ? (
          /* EMPTY STATE */
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ gap: "16px", padding: "80px 0" }}
          >
            <div
              className="flex items-center justify-center"
              style={{
                width: "96px",
                height: "96px",
                borderRadius: "9999px",
                background: "#F6F3F2",
              }}
            >
              <ShoppingBag size={40} style={{ color: "#A43B31" }} />
            </div>
            <h2 style={{ fontWeight: 700, fontSize: "22px", color: "#1B1C1C" }}>
              Your cart is empty
            </h2>
            <p style={{ fontSize: "16px", color: "#44474C" }}>
              Looks like you haven't added anything yet.
            </p>
            <button
              onClick={() => navigate("/products")}
              style={{
                background: "#A43B31",
                color: "#fff",
                fontWeight: 700,
                fontSize: "16px",
                padding: "14px 32px",
                borderRadius: "12px",
              }}
            >
              Continue Shopping
            </button>
          </div>
        ) : (
          <>
            {/* SECTION 2 — TWO COLUMN GRID */}
            <div
              className="flex"
              style={{ gap: "24px", alignItems: "flex-start" }}
            >
              {/* LEFT — cart item cards */}
              <div
                className="flex flex-col"
                style={{ flex: "1 1 65%", gap: "24px", minWidth: 0 }}
              >
                {cartItems.map((item) => {
                  const subtitle = item.variant || item.category || "";
                  return (
                    <div
                      key={item.id}
                      className="flex"
                      style={{
                        background: "#fff",
                        border: "1px solid #E4E2E1",
                        boxShadow: "0px 4px 12px rgba(79,70,229,0.05)",
                        borderRadius: "12px",
                        padding: "24px",
                        gap: "24px",
                      }}
                    >
                      {item.thumbnail || item.image ? (
                        <img
                          src={item.thumbnail || item.image}
                          alt={item.title}
                          style={{
                            width: "160px",
                            height: "160px",
                            borderRadius: "8px",
                            objectFit: "cover",
                            flexShrink: 0,
                            background: "#F6F3F2",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "160px",
                            height: "160px",
                            borderRadius: "8px",
                            background: "#F6F3F2",
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <div
                        className="flex flex-col"
                        style={{
                          justifyContent: "space-between",
                          height: "160px",
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <div
                          className="flex"
                          style={{
                            justifyContent: "space-between",
                            gap: "16px",
                          }}
                        >
                          <div
                            className="flex flex-col"
                            style={{ gap: "4px", minWidth: 0 }}
                          >
                            <span
                              style={{
                                fontWeight: 400,
                                fontSize: "16px",
                                color: "#1B1C1C",
                              }}
                            >
                              {item.title}
                            </span>
                            {subtitle && (
                              <span
                                style={{
                                  fontWeight: 400,
                                  fontSize: "16px",
                                  color: "#44474C",
                                }}
                              >
                                {subtitle}
                              </span>
                            )}
                          </div>
                          {(() => {
                            const price = Number(item.price);
                            const qty = Number(item.quantity);
                            let discount = Number(item.discount || 0);
                            if (item.discountExpiry) {
                              const expiry = new Date(item.discountExpiry).getTime();
                              if (Date.now() > expiry) discount = 0;
                            }

                            const originalTotal = price * qty;
                            const discountedTotal =
                              originalTotal - (originalTotal * discount) / 100;

                            return discount > 0 ? (
                              <div className="flex flex-col items-end">
                                <span
                                  style={{
                                    fontWeight: 700,
                                    fontSize: "16px",
                                    color: "#A43B31",
                                  }}
                                >
                                  ₹{discountedTotal.toFixed(2)}
                                </span>

                                <span
                                  style={{
                                    textDecoration: "line-through",
                                    color: "#999",
                                    fontSize: "13px",
                                  }}
                                >
                                  ₹{originalTotal.toFixed(2)}
                                </span>

                                <span
                                  style={{
                                    color: "#16A34A",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                  }}
                                >
                                  {discount}% OFF
                                </span>
                              </div>
                            ) : (
                              <span
                                style={{
                                  fontWeight: 700,
                                  fontSize: "16px",
                                  color: "#A43B31",
                                }}
                              >
                                ₹{originalTotal.toFixed(2)}
                              </span>
                            );
                          })()}
                        </div>
                        <div
                          className="flex items-center"
                          style={{ justifyContent: "space-between" }}
                        >
                          <div
                            className="flex items-center"
                            style={{
                              background: "#F6F3F2",
                              border: "1px solid #E4E2E1",
                              borderRadius: "8px",
                              padding: "4px",
                              width: "122px",
                              height: "50px",
                            }}
                          >
                            <button
                              onClick={() => dispatch(removeCart(item.id))}
                              aria-label="Decrease quantity"
                              className="flex items-center justify-center"
                              style={{
                                width: "32px",
                                height: "32px",
                                borderRadius: "6px",
                              }}
                            >
                              <Minus size={16} style={{ color: "#1B1C1C" }} />
                            </button>
                            <span
                              style={{
                                width: "48px",
                                textAlign: "center",
                                fontWeight: 700,
                                fontSize: "16px",
                                color: "#1B1C1C",
                              }}
                            >
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => handleAddCart(item)}
                              aria-label="Increase quantity"
                              className="flex items-center justify-center"
                              style={{
                                width: "32px",
                                height: "32px",
                                borderRadius: "6px",
                              }}
                            >
                              <Plus size={16} style={{ color: "#1B1C1C" }} />
                            </button>
                          </div>
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="flex items-center"
                            style={{ gap: "8px", padding: "8px 16px" }}
                          >
                            <Trash2 size={15} style={{ color: "#44474C" }} />
                            <span
                              style={{
                                fontWeight: 600,
                                fontSize: "16px",
                                color: "#44474C",
                              }}
                            >
                              Remove
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* RIGHT — order summary + help */}
              <div
                className="flex flex-col"
                style={{
                  flex: "0 0 32%",
                  gap: "24px",
                  position: "sticky",
                  top: "104px",
                }}
              >
                {/* Order Summary */}
                <div
                  className="flex flex-col"
                  style={{
                    background: "#fff",
                    border: "1px solid #E4E2E1",
                    boxShadow: "0px 4px 12px rgba(79,70,229,0.05)",
                    borderRadius: "16px",
                    padding: "32px",
                    gap: "24px",
                  }}
                >
                  <h2
                    style={{
                      borderBottom: "1px solid #E4E2E1",
                      paddingBottom: "16px",
                      fontWeight: 400,
                      fontSize: "16px",
                      color: "#1B1C1C",
                    }}
                  >
                    Order Summary
                  </h2>

                  <div className="flex flex-col" style={{ gap: "16px" }}>
                    <div
                      className="flex"
                      style={{ justifyContent: "space-between" }}
                    >
                      <span style={{ color: "#44474C" }}>Subtotal</span>
                      <span style={{ fontWeight: 700, color: "#1B1C1C" }}>
                        {money(subtotal)}
                      </span>
                    </div>
                    <div
                      className="flex"
                      style={{ justifyContent: "space-between" }}
                    >
                      <span style={{ color: "#44474C" }}>
                        Shipping Estimate
                      </span>
                      <span style={{ fontWeight: 700, color: "#1B1C1C" }}>
                        {money(shippingEstimate)}
                      </span>
                    </div>
                    {/* <div className="flex" style={{ justifyContent: "space-between" }}>
                      <span style={{ color: "#44474C" }}>Estimated Tax</span>
                      <span style={{ fontWeight: 700, color: "#1B1C1C" }}>{money(estimatedTax)}</span>
                    </div> */}
                    {promoDiscount > 0 && (
                      <div
                        className="flex"
                        style={{ justifyContent: "space-between" }}
                      >
                        <span style={{ color: "#44474C" }}>Promo Discount</span>
                        <span style={{ fontWeight: 700, color: "#15803D" }}>
                          -{money(promoDiscount)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div
                    className="flex"
                    style={{
                      justifyContent: "space-between",
                      borderTop: "1px dashed #E4E2E1",
                      paddingTop: "16px",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#1B1C1C" }}>
                      Order Total
                    </span>
                    <span style={{ fontWeight: 900, color: "#A43B31" }}>
                      {money(orderTotal)}
                    </span>
                  </div>

                  {/* PROMO CODE */}
                  <div
                    className="flex flex-col"
                    style={{ gap: "8px", padding: "8px 0" }}
                  >
                    <span
                      style={{
                        textTransform: "uppercase",
                        fontWeight: 700,
                        fontSize: "16px",
                        color: "#44474C",
                        letterSpacing: "0.8px",
                      }}
                    >
                      Promo Code
                    </span>
                    <div className="relative" style={{ height: "40px" }}>
                      <input
                        value={promoCode}
                        onChange={(e) => setPromoCode(e.target.value)}
                        placeholder="Enter code"
                        style={{
                          width: "100%",
                          height: "40px",
                          background: "#F6F3F2",
                          border: "1px solid #E4E2E1",
                          borderRadius: "8px",
                          padding: "10px 88px 10px 12px",
                          color: "#1B1C1C",
                          fontSize: "14px",
                          outline: "none",
                        }}
                      />
                      <button
                        onClick={handleApplyPromo}
                        className="absolute"
                        style={{
                          right: 0,
                          top: 0,
                          width: "78px",
                          height: "40px",
                          background: "#44474C",
                          borderRadius: "8px",
                          fontWeight: 700,
                          fontSize: "16px",
                          color: "#fff",
                        }}
                      >
                        Apply
                      </button>
                    </div>
                  </div>

                  {/* CHECKOUT */}
                  {isCheckoutDisabled ? (
                    <div className="text-center p-4 border border-red-200 bg-red-50 rounded-xl text-xs font-bold text-red-700 leading-normal">
                      No payment methods available. Please contact administrator.
                    </div>
                  ) : (
                    <button
                      onClick={handleCheckoutClick}
                      disabled={isProcessing}
                      className="flex items-center justify-center"
                      style={{
                        width: "100%",
                        height: "56px",
                        background: "#A43B31",
                        borderRadius: "12px",
                        boxShadow: "0px 10px 15px -3px rgba(0,0,0,0.1)",
                        gap: "8px",
                        opacity: isProcessing ? 0.7 : 1,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "16px",
                          color: "#fff",
                        }}
                      >
                        {isProcessing ? "Processing…" : "Proceed to Checkout"}
                      </span>
                      {!isProcessing && (
                        <ArrowRight size={16} style={{ color: "#fff" }} />
                      )}
                    </button>
                  )}

                  <div
                    className="flex items-center justify-center"
                    style={{ gap: "8px" }}
                  >
                    <Lock size={13} style={{ color: "#44474C" }} />
                    <span
                      style={{
                        fontWeight: 500,
                        fontSize: "16px",
                        color: "#44474C",
                      }}
                    >
                      Secure SSL Encrypted Checkout
                    </span>
                  </div>
                </div>

                {/* Help card */}
                <div
                  className="flex flex-col"
                  style={{
                    background: "#F6F3F2",
                    border: "1px solid rgba(199,196,216,0.2)",
                    borderRadius: "12px",
                    padding: "24px",
                    gap: "16px",
                  }}
                >
                  <div className="flex items-center" style={{ gap: "8px" }}>
                    <Headphones size={15} style={{ color: "#74777D" }} />
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "16px",
                        color: "#74777D",
                      }}
                    >
                      Need help with your order?
                    </span>
                  </div>
                  <p
                    style={{
                      fontWeight: 400,
                      fontSize: "16px",
                      lineHeight: "26px",
                      color: "#74777D",
                      opacity: 0.8,
                    }}
                  >
                    Our support team is available 24/7 to assist with your
                    shopping experience.
                  </p>
                  <button
                    onClick={() => navigate("/contact")}
                    className="flex items-center"
                    style={{ gap: "8px" }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "16px",
                        color: "#A43B31",
                      }}
                    >
                      Chat with an expert
                    </span>
                    <ExternalLink size={11} style={{ color: "#A43B31" }} />
                  </button>
                </div>
              </div>
            </div>

            {/* SECTION 3 — FREQUENTLY BOUGHT TOGETHER */}
            <div
              className="flex flex-col"
              style={{
                borderTop: "1px solid #E4E2E1",
                paddingTop: "40px",
                gap: "24px",
              }}
            >
              <h2
                style={{ fontWeight: 400, fontSize: "16px", color: "#1B1C1C" }}
              >
                Frequently Bought Together
              </h2>
              <div className="grid grid-cols-4" style={{ gap: "24px" }}>
                {loadingSuggestions ? (
                  [...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center animate-pulse"
                      style={{ gap: "16px", padding: "4px 0" }}
                    >
                      <div
                        style={{
                          width: "64px",
                          height: "64px",
                          borderRadius: "8px",
                          background: "#F6F3F2",
                          flexShrink: 0,
                        }}
                      />
                      <div
                        className="flex flex-col"
                        style={{ gap: "8px", flex: 1 }}
                      >
                        <div
                          style={{
                            height: "14px",
                            width: "70%",
                            borderRadius: "4px",
                            background: "#F6F3F2",
                          }}
                        />
                        <div
                          style={{
                            height: "12px",
                            width: "40%",
                            borderRadius: "4px",
                            background: "#F6F3F2",
                          }}
                        />
                      </div>
                    </div>
                  ))
                ) : suggestionList.length === 0 ? (
                  <p style={{ fontSize: "14px", color: "#44474C" }}>
                    No suggestions available right now.
                  </p>
                ) : (
                  suggestionList.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/product/${p.id}`)}
                      className="flex items-center text-left"
                      style={{ gap: "16px", padding: "4px 0" }}
                    >
                      {p.thumbnail || p.image ? (
                        <img
                          src={p.thumbnail || p.image}
                          alt={p.title || p.name}
                          style={{
                            width: "64px",
                            height: "64px",
                            border: "1px solid #E4E2E1",
                            borderRadius: "8px",
                            objectFit: "cover",
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "64px",
                            height: "64px",
                            border: "1px solid #E4E2E1",
                            borderRadius: "8px",
                            background: "#F6F3F2",
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <div className="flex flex-col" style={{ minWidth: 0 }}>
                        <span
                          className="truncate"
                          style={{
                            fontWeight: 700,
                            fontSize: "16px",
                            color: "#1B1C1C",
                          }}
                        >
                          {p.title || p.name}
                        </span>
                        <span
                          style={{
                            fontWeight: 400,
                            fontSize: "16px",
                            color: "#44474C",
                          }}
                        >
                          {money(p.price)}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* PROCESSING OVERLAY */}
      {isProcessing && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          style={{
            background: "rgba(11,28,48,0.6)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div
            className="text-center"
            style={{
              background: "#fff",
              borderRadius: "24px",
              padding: "48px",
              maxWidth: "360px",
            }}
          >
            <div
              className="flex items-center justify-center"
              style={{ marginBottom: "20px" }}
            >
              <Package
                size={56}
                style={{ color: "#A43B31" }}
                className="animate-bounce"
              />
            </div>
            <h2 style={{ fontWeight: 800, fontSize: "20px", color: "#1B1C1C" }}>
              Placing your order…
            </h2>
            <p style={{ fontSize: "14px", color: "#44474C", marginTop: "8px" }}>
              Please wait for confirmation
            </p>
          </div>
        </div>
      )}
      {paymentModal}
    </div>
  );
};

export default CartPage;
