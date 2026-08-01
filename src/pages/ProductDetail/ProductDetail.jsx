import React, { useEffect, useState, useRef, useMemo, memo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  query,
  setDoc,
  serverTimestamp,
  deleteDoc,
  collection,
  where,
  getDocs,
} from "firebase/firestore";
import { fireDB, auth } from "../../context/FirebaseConfig";
import { FaHeart, FaRegHeart } from "react-icons/fa";
import { useDispatch, useSelector } from "react-redux";
import { addWishlist, removeWishlist } from "../../context/WishlistSlice";
import { addCart, removeCart } from "../../context/CartSlice";
import {
  ShoppingBag,
  ArrowLeft,
  ArrowRight,
  Minus,
  Plus,
  ShoppingCart,
  Star,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Check,
  Shield,
  Heart,
  Truck,
} from "lucide-react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Thumbs, Pagination, Navigation, EffectCreative } from "swiper/modules";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ProductDetailSkeleton } from "../../features/products/ProductDetailSkeleton";
import useIsMobile from "../../hooks/useIsMobile";

// Import Swiper styles
import "swiper/css";
import "swiper/css/pagination";
import "swiper/css/navigation";
import "swiper/css/thumbs";
import "swiper/css/effect-creative";

/* ============================================================
   Helpers used by the mobile (≤lg) layout below.
   Pure functions — no effect on the desktop render.
============================================================ */
const getInitials = (name) => {
  if (!name) return "A";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "A";
  return parts
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

// Normalises whatever shape `specs` has in Firebase (object | array of
// objects | array of strings) into [{ label, value }] rows. Returns [] when absent.
const normalizeSpecs = (specs) => {
  if (!specs) return [];
  if (Array.isArray(specs)) {
    return specs.map((s) => {
      if (s && typeof s === "object") {
        const label = s.label ?? s.key ?? s.name ?? s.title ?? null;
        const rawVal = s.value ?? s.val ?? s.detail ?? null;
        return {
          label,
          value:
            rawVal != null ? String(rawVal) : label ? "" : JSON.stringify(s),
        };
      }
      return { label: null, value: String(s) };
    });
  }
  if (typeof specs === "object") {
    return Object.entries(specs).map(([k, v]) => ({
      label: k,
      value: v != null && typeof v === "object" ? JSON.stringify(v) : String(v),
    }));
  }
  return [{ label: null, value: String(specs) }];
};

/* ============================================================
   Desktop-only presentational helpers
============================================================ */
const formatINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// Turn a camelCase / snake_case spec key into a readable label.
const prettyLabel = (key) =>
  String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const DStars = ({ rating = 0, size = 15 }) => (
  <span className="flex items-center" style={{ gap: "2px" }}>
       {" "}
    {[0, 1, 2, 3, 4].map((i) => {
      const on = i < Math.round(rating);
      return (
        <Star
          key={i}
          size={size}
          style={{
            color: on ? "var(--color-primary)" : "var(--color-border-strong)",
          }}
          fill={on ? "var(--color-primary)" : "var(--color-border-strong)"}
          strokeWidth={0}
        />
      );
    })}
     {" "}
  </span>
);

const AVATAR_COLORS = [
  "var(--color-accent-subtle)",
  "var(--color-info-border)",
  "var(--color-error-subtle)",
  "var(--color-surface-muted)",
  "var(--color-success-border)",
  "var(--color-accent-subtle)",
];

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [product, setProduct] = useState(null);
  const [thumbsSwiper, setThumbsSwiper] = useState(null);
  const [selectedSize, setSelectedSize] = useState("M");
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [avgRating, setAvgRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [ratingStats, setRatingStats] = useState({
    5: 0,
    4: 0,
    3: 0,
    2: 0,
    1: 0,
  }); // Desktop-only UI state (lg+). Additive — mobile never reads these.

  const [relatedProducts, setRelatedProducts] = useState([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState("description");
  const [reviewSortOrder, setReviewSortOrder] = useState("recent");
  const [showAllReviews, setShowAllReviews] = useState(false); // Mobile-only UI state (≤lg). Additive — desktop never reads these.

  const isMobile = useIsMobile(1024);
  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const [descExpanded, setDescExpanded] = useState(false);
  const [specsOpen, setSpecsOpen] = useState(false);

  const wishlistItems = useSelector((state) => state.wishlist.wishlistItems);
  const isWishlisted = wishlistItems.some(
    (item) => String(item.id) === String(id),
  );

  const containerRef = useRef(null);
  const mainImgRef = useRef(null);
  const relatedScrollRef = useRef(null); // FETCH PRODUCT

  useEffect(() => {
    setError(false);
    setSelectedImageIndex(0);
    setQuantity(1);
    setShowAllReviews(false);
    setActiveTab("description");
    const fetchProduct = async () => {
      try {
        const productRef = doc(fireDB, "products", id);
        const productSnap = await getDoc(productRef);
        if (productSnap.exists()) {
          setProduct({ ...productSnap.data(), id: id });
        } else {
          setProduct(null);
          setError(true);
          console.log("Product not found");
        }
      } catch (error) {
        setError(true);
        console.log("Product fetch error:", error);
      }
    };
    fetchProduct();
  }, [id]); // FETCH REVIEWS

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        const reviewRef = collection(fireDB, "reviews");
        const q = query(reviewRef, where("productId", "==", id));
        const snapshot = await getDocs(q);
        const reviewList = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setReviews(reviewList);
      } catch (error) {
        console.log("Review fetch error:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchReviews();
  }, [id]); // FETCH RATINGS

  useEffect(() => {
    const fetchRatings = async () => {
      try {
        const reviewsRef = collection(fireDB, "reviews");
        const q = query(reviewsRef, where("productId", "==", id));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
          setAvgRating(0);
          setReviewCount(0);
          setRatingStats({ 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
          return;
        }

        let total = 0;
        let count = 0;
        let stats = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.rating) {
            const rating = Number(data.rating);
            total += rating;
            count++;
            const bucket = Math.round(rating);
            if (stats[bucket] !== undefined) stats[bucket]++;
          }
        });
        setAvgRating(count > 0 ? total / count : 0);
        setReviewCount(count);
        setRatingStats(stats);
      } catch (error) {
        console.log("Rating error:", error);
      }
    };
    fetchRatings();
  }, [id]); // FETCH RELATED PRODUCTS (same category, exclude current, max 4)

  useEffect(() => {
    if (!product?.category) return;
    const fetchRelated = async () => {
      try {
        const qy = query(
          collection(fireDB, "products"),
          where("category", "==", product.category),
        );
        const snap = await getDocs(qy);
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => String(p.id) !== String(id))
          .slice(0, 4);
        setRelatedProducts(list);
      } catch (error) {
        console.log("Related fetch error:", error);
      }
    };
    fetchRelated();
  }, [product?.category, id]); // WISHLIST FUNCTION

  const handleWishlist = async (e) => {
    if (e) e.stopPropagation();
    const user = auth.currentUser;
    if (!user) {
      alert("Please login first");
      return;
    }
    const productId = String(id);
    try {
      const wishlistRef = collection(fireDB, "wishlists");
      const snapshot = await getDocs(
        query(wishlistRef, where("userId", "==", user.uid)),
      );
      const existing = snapshot.docs.find(
        (doc) => doc.data().productId === productId,
      );

      if (existing) {
        dispatch(removeWishlist(productId));
        await deleteDoc(doc(fireDB, "wishlists", existing.id));
      } else {
        const wishlistItem = {
          userId: user.uid,
          productId: productId,
          id: productId,
          title: product.title,
          price: product.price,
          image: product.thumbnail || product.image,
          category: product.category,
          addedAt: serverTimestamp(),
        };
        dispatch(addWishlist(wishlistItem));
        await setDoc(
          doc(fireDB, "wishlists", `${user.uid}_${productId}`),
          wishlistItem,
        );
      }
    } catch (error) {
      console.log("Wishlist error:", error);
    }
  };

  const cartItems = useSelector((state) => state.cart.cartItems);
  const existingItem = cartItems.find((item) => String(item.id) === String(id)); // GSAP Animations (desktop only — lg+)

  useGSAP(
    () => {
      if (loading || !product || isMobile) return;

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(".dt-breadcrumb", { y: -10, opacity: 0, duration: 0.4 })
        .from(".dt-gallery", { x: -30, opacity: 0, duration: 0.6 }, "<")
        .from(".dt-details", { x: 30, opacity: 0, duration: 0.6 }, "<")
        .from(".dt-tabs", { y: 16, opacity: 0, duration: 0.5 }, "-=0.2");

      const cards = gsap.utils.toArray(".dt-related-card");
      if (cards.length) {
        gsap.from(cards, {
          y: 20,
          opacity: 0,
          stagger: 0.1,
          duration: 0.5,
          delay: 0.2,
        });
      }
    },
    {
      scope: containerRef,
      dependencies: [product, loading, isMobile, activeTab],
    },
  );

  const mainImage = product?.thumbnail || product?.image;
  const galleryImages =
    product?.images || product?.productImages || product?.gallery || [];
  const allImages = [mainImage, ...galleryImages].filter(Boolean);
  const isOutOfStock = (product?.stock || 0) <= 0; // --- Mobile-only derivations (null-safe; desktop ignores these) ---

  const cartCount = cartItems.reduce(
    (acc, item) => acc + (item.quantity || 0),
    0,
  );
  const stockNum = Number(product?.stock || 0);
  const stockWarning =
    stockNum <= 0
      ? "Out of stock"
      : stockNum <= 10
        ? `Only ${stockNum} left in stock - order soon`
        : null;
  const activeImage = allImages[activeImgIdx] || allImages[0];
  const specRows = normalizeSpecs(
    product?.specs,
  ); /* ============================================================
     Desktop-only derivations
  ============================================================ */

  const dName = product?.title || product?.name || "Product";
  const mrpNum = Number(product?.price || 0);
  const discountPct = (() => {
    if (product?.discountExpiry) {
      const expiry = new Date(product.discountExpiry).getTime();
      if (Date.now() > expiry) return 0;
    }
    return Number(product?.discount || 0);
  })();
  const priceNum = mrpNum - (mrpNum * discountPct) / 100;
  const desktopMainImage = allImages[selectedImageIndex] || mainImage;
  const features = Array.isArray(product?.features) ? product.features : [];
  const specRowsDetailed = normalizeSpecs(
    product?.specifications || product?.specs,
  ); // Split the description into two paragraphs when no extended copy exists.

  const descText = product?.description || "";
  let descPara1 = descText;
  let descPara2 = product?.descriptionExtended || "";
  if (!descPara2 && descText.length > 160) {
    const mid = Math.floor(descText.length / 2);
    const cut = descText.indexOf(". ", mid);
    if (cut > -1) {
      descPara1 = descText.slice(0, cut + 1);
      descPara2 = descText.slice(cut + 2);
    }
  }

  const sortedReviews = useMemo(() => {
    const arr = [...reviews];
    arr.sort((a, b) => {
      if (reviewSortOrder === "highest")
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      if (reviewSortOrder === "lowest")
        return (Number(a.rating) || 0) - (Number(b.rating) || 0);
      const ad = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const bd = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return bd - ad;
    });
    return arr;
  }, [reviews, reviewSortOrder]);

  const displayedReviews = showAllReviews
    ? sortedReviews
    : sortedReviews.slice(0, 3);

  const formatReviewDate = (ts) =>
    ts?.toDate
      ? `Reviewed on ${ts.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`
      : "";

  const handleAddToCartDesktop = () => {
    if (!auth.currentUser) {
      navigate("/login");
      return;
    }
    for (let i = 0; i < quantity; i++) dispatch(addCart(product));
  };

  const handleSelectImage = (i) => {
    setSelectedImageIndex(i);
    if (mainImgRef.current) {
      gsap.fromTo(
        mainImgRef.current,
        { scale: 0.97 },
        { scale: 1, duration: 0.2, ease: "power2.out" },
      );
    }
  };

  const scrollRelated = (dir) => {
    relatedScrollRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  };

  return (
    <div
      className="bg-background min-h-screen text-ink overflow-x-hidden selection:bg-surface-inverse selection:text-inverse"
      ref={containerRef}
    >
           {" "}
      {loading ? (
        <ProductDetailSkeleton />
      ) : error || !product ? (
        <div className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-center gap-6 px-6 text-center">
                   {" "}
          <p className="font-semibold text-[var(--color-ink)] text-2xl">
            Product not found
          </p>
                   {" "}
          <button
            onClick={() => navigate("/products")}
            className="flex items-center gap-2 rounded-xl px-6 h-12 font-bold text-inverse"
            style={{ background: "var(--color-ink)" }}
          >
                        <ArrowLeft size={18} /> Back to Products          {" "}
          </button>
                 {" "}
        </div>
      ) : (
        <>
                   {" "}
          {/* ============================================================
              MOBILE + TABLET LAYOUT (≤lg) — preserved as-is.
          ============================================================ */}
                   {" "}
          <div className="block lg:hidden">
                       {" "}
            <div
              className="min-h-screen w-full"
              style={{
                background: "var(--color-background)",
                fontFamily: "Inter, sans-serif",
                overflowX: "hidden",
                maxWidth: "100vw",
              }}
            >
                           {" "}
              {/* SCROLLABLE CONTENT (clears the global navbar) */}             {" "}
              <div style={{ paddingTop: "96px", paddingBottom: "81px" }}>
                                {/* 2 ── HERO */}               {" "}
                <section style={{ padding: "16px 20px 0" }}>
                                   {" "}
                  <div
                    className="relative w-full"
                    style={{
                      background: "var(--color-surface)",
                      borderRadius: "12px",
                      overflow: "hidden",
                    }}
                  >
                                       {" "}
                    <img
                      src={activeImage}
                      alt={product.title}
                      style={{
                        width: "100%",
                        aspectRatio: "1 / 1",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                                       {" "}
                    <button
                      onClick={handleWishlist}
                      aria-label="Toggle wishlist"
                      className="absolute flex items-center justify-center"
                      style={{
                        top: "16px",
                        right: "16px",
                        width: "36px",
                        height: "36px",
                        background:
                          "color-mix(in srgb, var(--color-surface) 80%, transparent)",
                        backdropFilter: "blur(6px)",
                        WebkitBackdropFilter: "blur(6px)",
                        borderRadius: "9999px",
                        boxShadow: "0px 1px 2px rgba(0,0,0,0.05)",
                      }}
                    >
                                           {" "}
                      {isWishlisted ? (
                        <FaHeart
                          size={20}
                          style={{ color: "var(--color-primary)" }}
                        />
                      ) : (
                        <FaRegHeart
                          size={20}
                          style={{ color: "var(--color-ink)" }}
                        />
                      )}
                                         {" "}
                    </button>
                                     {" "}
                  </div>
                                   {" "}
                  {/* Thumbnail gallery — horizontally scrollable */}           
                       {" "}
                  {allImages.length > 1 && (
                    <div
                      className="hide-scrollbar"
                      style={{
                        width: "100%",
                        height: "88px",
                        overflowX: "scroll",
                        overflowY: "hidden",
                        display: "flex",
                        gap: "16px",
                        paddingTop: "8px",
                      }}
                    >
                                           {" "}
                      {allImages.map((img, i) => (
                        <button
                          key={i}
                          onClick={() => setActiveImgIdx(i)}
                          className="flex items-center justify-center flex-shrink-0"
                          style={{
                            width: "80px",
                            height: "80px",
                            background: "var(--color-surface)",
                            borderRadius: "8px",
                            padding: "8px",
                            border:
                              i === activeImgIdx
                                ? "2px solid var(--color-ink)"
                                : "1px solid var(--color-border-strong)",
                          }}
                        >
                                                   {" "}
                          <img
                            src={img}
                            alt=""
                            style={{
                              width: "60px",
                              height: "60px",
                              objectFit: "cover",
                              borderRadius: "4px",
                            }}
                          />
                                                 {" "}
                        </button>
                      ))}
                                         {" "}
                    </div>
                  )}
                                 {" "}
                </section>
                                {/* 3 ── PRODUCT INFO */}               {" "}
                <section
                  style={{
                    padding: "16px 20px 0",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                                   {" "}
                  <div>
                                       {" "}
                    <p
                      style={{
                        fontWeight: 600,
                        fontSize: "12px",
                        letterSpacing: "0.6px",
                        textTransform: "uppercase",
                        color: "var(--color-muted)",
                      }}
                    >
                      {product.category}
                    </p>
                                       {" "}
                    <h1
                      style={{
                        fontWeight: 700,
                        fontSize: "24px",
                        lineHeight: "30px",
                        color: "var(--color-ink)",
                        marginTop: "4px",
                      }}
                    >
                      {product.title}
                    </h1>
                                     {" "}
                  </div>
                                    {/* Rating */}                 {" "}
                  <div className="flex items-center" style={{ gap: "6px" }}>
                                       {" "}
                    <div className="flex items-center" style={{ gap: "2px" }}>
                                           {" "}
                      {[0, 1, 2, 3, 4].map((s) => {
                        const on = s < Math.round(avgRating);
                        return (
                          <Star
                            key={s}
                            size={12}
                            style={{
                              fill: on
                                ? "var(--color-chart-gold)"
                                : "var(--color-border-strong)",
                              color: on
                                ? "var(--color-chart-gold)"
                                : "var(--color-border-strong)",
                            }}
                          />
                        );
                      })}
                                         {" "}
                    </div>
                                       {" "}
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "12px",
                        letterSpacing: "0.6px",
                        color: "var(--color-body)",
                      }}
                    >
                                           {" "}
                      {reviewCount > 0
                        ? `${avgRating.toFixed(1)} (${reviewCount} ${reviewCount === 1 ? "review" : "reviews"})`
                        : "No reviews yet"}
                                         {" "}
                    </span>
                                     {" "}
                  </div>
                                    {/* Price */}                 {" "}
                  <div
                    className="flex flex-wrap items-center"
                    style={{ gap: "10px", paddingTop: "8px" }}
                  >
                                       {" "}
                    {discountPct > 0 ? (
                      <>
                                               {" "}
                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: "28px",
                            letterSpacing: "-0.56px",
                            color: "var(--color-primary)",
                            lineHeight: 1,
                          }}
                        >
                                                    {formatINR(priceNum)}       
                                         {" "}
                        </span>
                                               {" "}
                        <span
                          style={{
                            fontWeight: 400,
                            fontSize: "14px",
                            color: "var(--color-muted)",
                            textDecoration: "line-through",
                          }}
                        >
                                                    {formatINR(mrpNum)}         
                                       {" "}
                        </span>
                                               {" "}
                        <span
                          style={{
                            background: "var(--color-error-subtle)",
                            borderRadius: "4px",
                            padding: "2px 8px",
                            fontWeight: 600,
                            fontSize: "12px",
                            letterSpacing: "0.6px",
                            color: "var(--color-error)",
                          }}
                        >
                                                    {discountPct}% OFF          
                                       {" "}
                        </span>
                                               {" "}
                        {product.discountExpiry && (
                          <span
                            style={{
                              width: "100%",
                              fontWeight: 500,
                              fontSize: "12px",
                              color: "var(--color-accent-strong)",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                                                        Offer ends:{" "}
                            {new Date(product.discountExpiry).toLocaleString(
                              "en-IN",
                              { dateStyle: "medium", timeStyle: "short" },
                            )}
                                                     {" "}
                          </span>
                        )}
                                             {" "}
                      </>
                    ) : (
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: "28px",
                          letterSpacing: "-0.56px",
                          color: "var(--color-primary)",
                          lineHeight: 1,
                        }}
                      >
                                                {formatINR(mrpNum)}             
                               {" "}
                      </span>
                    )}
                                     {" "}
                  </div>
                                    {/* Stock warning */}                 {" "}
                  {stockWarning && (
                    <div className="flex items-center" style={{ gap: "8px" }}>
                                           {" "}
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-error)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ flexShrink: 0 }}
                      >
                                               {" "}
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                                                <path d="M12 9v4" />
                                                <path d="M12 17h.01" />         
                                   {" "}
                      </svg>
                                           {" "}
                      <span
                        style={{
                          fontWeight: 500,
                          fontSize: "14px",
                          color: "var(--color-error)",
                        }}
                      >
                        {stockWarning}
                      </span>
                                         {" "}
                    </div>
                  )}
                                    {/* Shipping box */}                 {" "}
                  <div
                    style={{
                      background: "var(--color-surface-muted)",
                      border:
                        "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)",
                      borderRadius: "12px",
                      padding: "12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      marginTop: "8px",
                    }}
                  >
                                       {" "}
                    <div className="flex items-center" style={{ gap: "8px" }}>
                                           {" "}
                      <Truck size={18} color="var(--color-ink)" />             
                             {" "}
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "14px",
                          color: "var(--color-ink)",
                        }}
                      >
                        Free shipping
                      </span>
                                         {" "}
                    </div>
                                       {" "}
                    {product.shippingInfo ? (
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "12px",
                          letterSpacing: "0.6px",
                          color: "var(--color-body)",
                        }}
                      >
                        {String(product.shippingInfo)}
                      </span>
                    ) : null}
                                     {" "}
                  </div>
                                 {" "}
                </section>
                                {/* 4 ── DESCRIPTION */}               {" "}
                {product.description && (
                  <section
                    style={{
                      padding: "24px 20px 0",
                      borderTop:
                        "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)",
                      marginTop: "24px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "7.5px",
                    }}
                  >
                                       {" "}
                    <h2
                      style={{
                        fontWeight: 600,
                        fontSize: "18px",
                        color: "var(--color-ink)",
                      }}
                    >
                      Description
                    </h2>
                                       {" "}
                    <p
                      style={
                        descExpanded
                          ? {
                              fontWeight: 400,
                              fontSize: "14px",
                              lineHeight: "20px",
                              color: "var(--color-body)",
                            }
                          : {
                              fontWeight: 400,
                              fontSize: "14px",
                              lineHeight: "20px",
                              color: "var(--color-body)",
                              display: "-webkit-box",
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }
                      }
                    >
                                            {product.description}               
                         {" "}
                    </p>
                                       {" "}
                    {product.description.length > 120 && (
                      <button
                        onClick={() => setDescExpanded((v) => !v)}
                        style={{
                          alignSelf: "flex-start",
                          fontWeight: 700,
                          fontSize: "12px",
                          letterSpacing: "1.2px",
                          textTransform: "uppercase",
                          color: "var(--color-ink)",
                        }}
                      >
                                               {" "}
                        {descExpanded ? "Read Less" : "Read More"}             
                               {" "}
                      </button>
                    )}
                                     {" "}
                  </section>
                )}
                                {/* 5 ── TECH SPECS ACCORDION */}               {" "}
                {specRows.length > 0 && (
                  <section style={{ margin: "24px 20px 0" }}>
                                       {" "}
                    <div
                      style={{
                        border:
                          "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)",
                        borderRadius: "12px",
                        overflow: "hidden",
                      }}
                    >
                                           {" "}
                      <button
                        onClick={() => setSpecsOpen((v) => !v)}
                        className="w-full flex items-center justify-between"
                        style={{
                          padding: "16px",
                          background: "var(--color-surface)",
                        }}
                      >
                                               {" "}
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: "18px",
                            color: "var(--color-ink)",
                          }}
                        >
                          Tech Specs
                        </span>
                                               {" "}
                        <ChevronDown
                          size={16}
                          color="var(--color-ink)"
                          style={{
                            transition: "transform 0.3s ease",
                            transform: specsOpen
                              ? "rotate(180deg)"
                              : "rotate(0deg)",
                          }}
                        />
                                             {" "}
                      </button>
                                           {" "}
                      {specsOpen && (
                        <div
                          style={{
                            padding: "0 16px 16px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                                                   {" "}
                          {specRows.map((row, i) => (
                            <div
                              key={i}
                              className="flex"
                              style={{
                                justifyContent: row.label
                                  ? "space-between"
                                  : "flex-start",
                                gap: "12px",
                                fontWeight: 400,
                                fontSize: "14px",
                                color: "var(--color-body)",
                              }}
                            >
                                                           {" "}
                              {row.label ? (
                                <>
                                                                   {" "}
                                  <span style={{ color: "var(--color-muted)" }}>
                                    {row.label}
                                  </span>
                                                                   {" "}
                                  <span style={{ textAlign: "right" }}>
                                    {row.value}
                                  </span>
                                                                 {" "}
                                </>
                              ) : (
                                <span>{row.value}</span>
                              )}
                                                         {" "}
                            </div>
                          ))}
                                                 {" "}
                        </div>
                      )}
                                         {" "}
                    </div>
                                     {" "}
                  </section>
                )}
                                {/* 6 ── REVIEWS */}               {" "}
                <section
                  id="mobile-reviews"
                  style={{
                    padding: "24px 20px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                  }}
                >
                                   {" "}
                  <div className="flex items-center justify-between">
                                       {" "}
                    <h2
                      style={{
                        fontWeight: 600,
                        fontSize: "18px",
                        color: "var(--color-ink)",
                      }}
                    >
                      Reviews
                    </h2>
                                       {" "}
                    {reviews.length > 0 && (
                      <button
                        onClick={() =>
                          document
                            .getElementById("mobile-reviews")
                            ?.scrollIntoView({ behavior: "smooth" })
                        }
                        style={{
                          fontWeight: 700,
                          fontSize: "12px",
                          letterSpacing: "0.6px",
                          color: "var(--color-ink)",
                        }}
                      >
                                                View All                    
                         {" "}
                      </button>
                    )}
                                     {" "}
                  </div>
                                   {" "}
                  {reviews.length === 0 ? (
                    <p
                      style={{
                        fontWeight: 400,
                        fontSize: "14px",
                        color: "var(--color-muted)",
                      }}
                    >
                      No reviews yet.
                    </p>
                  ) : (
                    reviews.map((review, i) => {
                      const initials = getInitials(review.userName);
                      const avatarBg = [
                        "var(--color-info-subtle)",
                        "var(--color-error-subtle)",
                      ][i % 2];
                      const dateStr = review.createdAt?.toDate
                        ? review.createdAt
                            .toDate()
                            .toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                        : "";
                      return (
                        <div
                          key={review.id}
                          style={{
                            background: "var(--color-surface)",
                            borderRadius: "12px",
                            padding: "16px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                                                   {" "}
                          <div
                            className="flex items-center"
                            style={{ gap: "12px" }}
                          >
                                                       {" "}
                            <div
                              className="flex items-center justify-center flex-shrink-0"
                              style={{
                                width: "40px",
                                height: "40px",
                                borderRadius: "9999px",
                                background: avatarBg,
                                fontWeight: 700,
                                fontSize: "16px",
                                color: "var(--color-ink)",
                              }}
                            >
                                                            {initials}         
                                               {" "}
                            </div>
                                                       {" "}
                            <div className="flex-1" style={{ minWidth: 0 }}>
                                                           {" "}
                              <div
                                className="flex items-center justify-between"
                                style={{ gap: "8px" }}
                              >
                                                               {" "}
                                <span
                                  style={{
                                    fontWeight: 700,
                                    fontSize: "14px",
                                    color: "var(--color-ink)",
                                  }}
                                >
                                  {review.userName || "Anonymous"}
                                </span>
                                                               {" "}
                                <div
                                  className="flex items-center flex-shrink-0"
                                  style={{ gap: "2px" }}
                                >
                                                                   {" "}
                                  {[0, 1, 2, 3, 4].map((s) => {
                                    const on = s < (Number(review.rating) || 0);
                                    return (
                                      <Star
                                        key={s}
                                        size={12}
                                        style={{
                                          fill: on
                                            ? "var(--color-chart-gold)"
                                            : "var(--color-border-strong)",
                                          color: on
                                            ? "var(--color-chart-gold)"
                                            : "var(--color-border-strong)",
                                        }}
                                      />
                                    );
                                  })}
                                                                 {" "}
                                </div>
                                                             {" "}
                              </div>
                                                           {" "}
                              {dateStr && (
                                <span
                                  style={{
                                    fontWeight: 500,
                                    fontSize: "10px",
                                    color: "var(--color-muted)",
                                  }}
                                >
                                  {dateStr}
                                </span>
                              )}
                                                         {" "}
                            </div>
                                                     {" "}
                          </div>
                                                   {" "}
                          <p
                            style={{
                              fontWeight: 400,
                              fontSize: "14px",
                              lineHeight: "20px",
                              color: "var(--color-body)",
                            }}
                          >
                            {review.comment}
                          </p>
                                                 {" "}
                        </div>
                      );
                    })
                  )}
                                 {" "}
                </section>
                             {" "}
              </div>
                           {" "}
              {/* 7 ── BOTTOM ACTION BAR (fixed, above the global mobile tab bar) */}
                           {" "}
              <div
                className="fixed inset-x-0 z-50 flex items-center"
                style={{
                  bottom: "calc(56px + env(safe-area-inset-bottom))",
                  height: "81px",
                  padding: "16px 20px",
                  gap: "16px",
                  background:
                    "color-mix(in srgb, var(--color-surface) 92%, transparent)",
                  backdropFilter: "blur(6px)",
                  WebkitBackdropFilter: "blur(6px)",
                  borderTop:
                    "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)",
                }}
              >
                               {" "}
                {isOutOfStock ? (
                  <button
                    disabled
                    className="flex items-center justify-center flex-shrink-0"
                    style={{
                      width: "134.8px",
                      height: "48px",
                      border: "1px solid var(--color-border)",
                      borderRadius: "9999px",
                      fontWeight: 700,
                      fontSize: "14px",
                      color: "var(--color-muted)",
                      background: "transparent",
                      cursor: "not-allowed",
                    }}
                  >
                                        Out of Stock                  {" "}
                  </button>
                ) : existingItem ? (
                  <div
                    className="flex items-center justify-between flex-shrink-0"
                    style={{
                      width: "134.8px",
                      height: "48px",
                      border: "1px solid var(--color-ink)",
                      borderRadius: "9999px",
                      overflow: "hidden",
                    }}
                  >
                                       {" "}
                    <button
                      onClick={() => dispatch(removeCart(String(id)))}
                      aria-label="Decrease quantity"
                      className="flex items-center justify-center h-full"
                      style={{ width: "44px", color: "var(--color-ink)" }}
                    >
                                            <Minus size={16} />                 
                       {" "}
                    </button>
                                       {" "}
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "16px",
                        color: "var(--color-ink)",
                        minWidth: "20px",
                        textAlign: "center",
                      }}
                    >
                                            {existingItem.quantity}             
                           {" "}
                    </span>
                                       {" "}
                    <button
                      disabled={existingItem.quantity >= (product.stock || 0)}
                      onClick={() => dispatch(addCart(product))}
                      aria-label="Increase quantity"
                      className="flex items-center justify-center h-full"
                      style={{
                        width: "44px",
                        color: "var(--color-ink)",
                        opacity:
                          existingItem.quantity >= (product.stock || 0)
                            ? 0.3
                            : 1,
                      }}
                    >
                                            <Plus size={16} />                 
                       {" "}
                    </button>
                                     {" "}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      if (!auth.currentUser) {
                        navigate("/login");
                        return;
                      }
                      dispatch(addCart(product));
                    }}
                    className="flex items-center justify-center flex-shrink-0"
                    style={{
                      width: "134.8px",
                      height: "48px",
                      border: "1px solid var(--color-ink)",
                      borderRadius: "9999px",
                      fontWeight: 700,
                      fontSize: "16px",
                      color: "var(--color-ink)",
                      background: "transparent",
                    }}
                  >
                                        Add to Cart                  {" "}
                  </button>
                )}
                               {" "}
                <button
                  onClick={() => {
                    if (!auth.currentUser) {
                      navigate("/login");
                      return;
                    }
                    if (!existingItem) dispatch(addCart(product));
                    navigate("/cart");
                  }}
                  className="flex items-center justify-center flex-1"
                  style={{
                    height: "48px",
                    background: "var(--color-primary)",
                    borderRadius: "9999px",
                    fontWeight: 700,
                    fontSize: "16px",
                    color: "var(--color-inverse)",
                    boxShadow:
                      "0px 10px 15px -3px color-mix(in srgb, var(--color-primary) 20%, transparent), 0px 4px 6px -4px color-mix(in srgb, var(--color-primary) 20%, transparent)",
                  }}
                >
                                    Buy Now                {" "}
                </button>
                             {" "}
              </div>
                         {" "}
            </div>
                     {" "}
          </div>
                   {" "}
          {/* ============================================================
              DESKTOP LAYOUT (lg+) — new design, matches html.png
          ============================================================ */}
                   {" "}
          <div
            className="hidden lg:block"
            style={{
              background: "var(--color-background)",
              fontFamily: "Inter, sans-serif",
            }}
          >
                       {" "}
            <div
              className="mx-auto"
              style={{ maxWidth: "1280px", padding: "32px" }}
            >
                            {/* SECTION 1 — BREADCRUMBS */}             {" "}
              <div
                className="dt-breadcrumb flex items-center"
                style={{ gap: "8px", marginBottom: "32px" }}
              >
                               {" "}
                <button
                  onClick={() => navigate("/")}
                  className="text-[16px]"
                  style={{ color: "var(--color-body)", fontWeight: 400 }}
                >
                  Home
                </button>
                               {" "}
                <ChevronRight
                  size={14}
                  style={{ color: "var(--color-body)" }}
                />
                               {" "}
                <button
                  onClick={() => navigate("/products")}
                  className="text-[16px] capitalize"
                  style={{ color: "var(--color-body)", fontWeight: 400 }}
                >
                  {product.category}
                </button>
                               {" "}
                <ChevronRight
                  size={14}
                  style={{ color: "var(--color-body)" }}
                />
                               {" "}
                <span
                  className="text-[16px]"
                  style={{ color: "var(--color-ink)", fontWeight: 500 }}
                >
                                   {" "}
                  {dName.length > 15 ? dName.slice(0, 15) + "..." : dName}     
                           {" "}
                </span>
                             {" "}
              </div>
                            {/* SECTION 2 — PRODUCT HERO */}             {" "}
              <div className="flex items-start" style={{ gap: "40px" }}>
                                {/* LEFT — Image Gallery (~half the width) */} 
                             {" "}
                <div
                  className="dt-gallery flex flex-1 min-w-0"
                  style={{ gap: "16px" }}
                >
                                    {/* Thumbnail strip */}                 {" "}
                  <div
                    className="flex flex-col flex-shrink-0 no-scrollbar"
                    style={{
                      width: "96px",
                      gap: "12px",
                      maxHeight: "520px",
                      overflowY: "auto",
                    }}
                  >
                                       {" "}
                    {allImages.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => handleSelectImage(i)}
                        className="flex-shrink-0 overflow-hidden"
                        style={{
                          width: "96px",
                          height: "96px",
                          borderRadius: "8px",
                          border:
                            i === selectedImageIndex
                              ? "2px solid var(--color-ink)"
                              : "1px solid var(--color-border-strong)",
                          background: "var(--color-surface)",
                        }}
                      >
                                               {" "}
                        <img
                          src={img}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                                             {" "}
                      </button>
                    ))}
                                     {" "}
                  </div>
                                   {" "}
                  {/* Main image — grows to fill the gallery column (square) */}
                                   {" "}
                  <div
                    className="flex-1 min-w-0 aspect-square self-start"
                    style={{
                      borderRadius: "12px",
                      boxShadow: "0px 4px 12px rgba(0,0,0,0.05)",
                      background: "rgba(255,255,255,0.002)",
                      overflow: "hidden",
                    }}
                  >
                                       {" "}
                    <img
                      ref={mainImgRef}
                      src={desktopMainImage}
                      alt={dName}
                      className="w-full h-full object-cover"
                    />
                                     {" "}
                  </div>
                                 {" "}
                </div>
                               {" "}
                {/* RIGHT — Product Details (~half the width) */}               {" "}
                <div
                  className="dt-details flex flex-col flex-1 min-w-0"
                  style={{ gap: "24px" }}
                >
                                    {/* Top block */}                 {" "}
                  <div className="flex flex-col" style={{ gap: "8px" }}>
                                       {" "}
                    <span
                      className="self-start capitalize"
                      style={{
                        background: "var(--color-border)",
                        borderRadius: "9999px",
                        padding: "4px 16px",
                        fontWeight: 600,
                        fontSize: "14px",
                        color: "var(--color-body)",
                        letterSpacing: "0.14px",
                      }}
                    >
                                            {product.category}                 
                       {" "}
                    </span>
                                       {" "}
                    <h1
                      style={{
                        fontWeight: 600,
                        fontSize: "32px",
                        color: "var(--color-ink)",
                        letterSpacing: "-0.8px",
                        lineHeight: "40px",
                      }}
                    >
                                            {dName}                   {" "}
                    </h1>
                                       {" "}
                    <div className="flex items-center" style={{ gap: "16px" }}>
                                           {" "}
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "14px",
                          color: "var(--color-ink)",
                        }}
                      >
                        {avgRating.toFixed(1)}
                      </span>
                                           {" "}
                      <DStars rating={avgRating} size={15} />                   
                       {" "}
                      <span
                        style={{
                          fontWeight: 400,
                          fontSize: "14px",
                          color: "var(--color-body)",
                        }}
                      >
                                                (
                        {reviewCount.toLocaleString("en-IN")}{" "}
                        {reviewCount === 1 ? "Review" : "Reviews"})            
                                 {" "}
                      </span>
                                         {" "}
                    </div>
                                     {" "}
                  </div>
                                    {/* Price block */}                 {" "}
                  <div
                    style={{
                      borderTop: "1px solid var(--color-border-strong)",
                      borderBottom: "1px solid var(--color-border-strong)",
                      padding: "24px 0",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                                       {" "}
                    <div
                      className="flex items-end flex-wrap"
                      style={{ gap: "16px" }}
                    >
                                           {" "}
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "48px",
                          color: "var(--color-ink)",
                          letterSpacing: "-0.96px",
                          lineHeight: 1,
                        }}
                      >
                                                {formatINR(priceNum)}           
                                 {" "}
                      </span>
                                           {" "}
                      {mrpNum > priceNum && (
                        <span
                          style={{
                            fontWeight: 400,
                            fontSize: "18px",
                            color: "var(--color-body)",
                            textDecoration: "line-through",
                          }}
                        >
                                                    {formatINR(mrpNum)}         
                                       {" "}
                        </span>
                      )}
                                           {" "}
                      {discountPct > 0 && (
                        <span
                          style={{
                            background: "var(--color-accent-strong)",
                            borderRadius: "4px",
                            padding: "4px 8px",
                            color: "var(--color-inverse)",
                            fontWeight: 600,
                            fontSize: "14px",
                          }}
                        >
                                                    {discountPct}% OFF          
                                       {" "}
                        </span>
                      )}
                                           {" "}
                      {discountPct > 0 && product?.discountExpiry && (
                        <div className="w-full text-[14px] font-semibold text-accent-strong bg-accent-subtle border border-accent-subtle rounded-lg p-3 mt-2 flex items-center gap-2">
                                                   {" "}
                          <span>
                            {" "}
                            Offer valid till:{" "}
                            {new Date(product.discountExpiry).toLocaleString(
                              "en-IN",
                              { dateStyle: "medium", timeStyle: "short" },
                            )}
                          </span>
                                                 {" "}
                        </div>
                      )}
                                         {" "}
                    </div>
                                       {" "}
                    <div className="flex items-center" style={{ gap: "8px" }}>
                                           {" "}
                      <span
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "9999px",
                          background:
                            stockNum > 0
                              ? "var(--color-success)"
                              : "var(--color-error)",
                        }}
                      />
                                           {" "}
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "14px",
                          color: "var(--color-ink)",
                        }}
                      >
                                               {" "}
                        {stockNum > 0
                          ? `In Stock | Available Quantity: ${stockNum} units`
                          : "Out of Stock"}
                                             {" "}
                      </span>
                                         {" "}
                    </div>
                                     {" "}
                  </div>
                                    {/* Quantity + Actions */}                 {" "}
                  <div className="flex flex-col" style={{ gap: "24px" }}>
                                       {" "}
                    <div className="flex flex-col" style={{ gap: "8px" }}>
                                           {" "}
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "14px",
                          color: "var(--color-body)",
                        }}
                      >
                        Quantity
                      </span>
                                           {" "}
                      <div
                        className="flex items-center"
                        style={{
                          background: "var(--color-background)",
                          border: "1px solid var(--color-muted)",
                          borderRadius: "12px",
                          width: "146px",
                          height: "48px",
                          padding: "0 8px",
                        }}
                      >
                                               {" "}
                        <button
                          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                          className="flex items-center justify-center"
                          style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "8px",
                          }}
                          aria-label="Decrease quantity"
                        >
                                                   {" "}
                          <Minus
                            size={16}
                            style={{ color: "var(--color-ink)" }}
                          />
                                                 {" "}
                        </button>
                                               {" "}
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: "16px",
                            color: "var(--color-ink)",
                            width: "48px",
                            textAlign: "center",
                          }}
                        >
                          {quantity}
                        </span>
                                               {" "}
                        <button
                          onClick={() =>
                            setQuantity((q) =>
                              stockNum ? Math.min(stockNum, q + 1) : q + 1,
                            )
                          }
                          className="flex items-center justify-center"
                          style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "8px",
                          }}
                          aria-label="Increase quantity"
                        >
                                                   {" "}
                          <Plus
                            size={16}
                            style={{ color: "var(--color-ink)" }}
                          />
                                                 {" "}
                        </button>
                                             {" "}
                      </div>
                                         {" "}
                    </div>
                                       {" "}
                    <div className="flex items-center" style={{ gap: "16px" }}>
                                           {" "}
                      <button
                        onClick={handleAddToCartDesktop}
                        disabled={isOutOfStock}
                        className="flex items-center justify-center flex-1"
                        style={{
                          height: "56px",
                          background: isOutOfStock
                            ? "var(--color-muted)"
                            : "var(--color-ink)",
                          borderRadius: "12px",
                          gap: "8px",
                          boxShadow: "0px 4px 12px rgba(0,0,0,0.05)",
                          cursor: isOutOfStock ? "not-allowed" : "pointer",
                        }}
                      >
                                               {" "}
                        <ShoppingCart size={20} color="var(--color-inverse)" /> 
                                             {" "}
                        <span
                          style={{
                            color: "var(--color-inverse)",
                            textTransform: "uppercase",
                            letterSpacing: "0.8px",
                            fontWeight: 400,
                            fontSize: "16px",
                          }}
                        >
                                                   {" "}
                          {isOutOfStock ? "Out of Stock" : "Add to Cart"}       
                                         {" "}
                        </span>
                                             {" "}
                      </button>
                                           {" "}
                      <button
                        onClick={handleWishlist}
                        className="flex items-center justify-center flex-shrink-0"
                        style={{
                          width: "56px",
                          height: "56px",
                          border: "1px solid var(--color-muted)",
                          borderRadius: "12px",
                        }}
                        aria-label="Toggle wishlist"
                      >
                                               {" "}
                        <Heart
                          size={20}
                          style={{
                            color: isWishlisted
                              ? "var(--color-primary)"
                              : "var(--color-body)",
                          }}
                          fill={isWishlisted ? "var(--color-primary)" : "none"}
                        />
                                             {" "}
                      </button>
                                         {" "}
                    </div>
                                        {/* Delivery info */}                   {" "}
                    <div className="flex" style={{ gap: "16px" }}>
                                           {" "}
                      <div
                        className="flex items-center flex-1"
                        style={{
                          height: "62px",
                          background: "var(--color-surface-muted)",
                          borderRadius: "12px",
                          padding: "16px",
                          gap: "8px",
                        }}
                      >
                                               {" "}
                        <Truck
                          size={22}
                          style={{ color: "var(--color-ink)" }}
                        />
                                               {" "}
                        <div className="flex flex-col">
                                                   {" "}
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: "14px",
                              color: "var(--color-ink)",
                            }}
                          >
                            Free Delivery
                          </span>
                                                   {" "}
                          <span
                            style={{
                              fontWeight: 500,
                              fontSize: "12px",
                              color: "var(--color-body)",
                            }}
                          >
                            Within 3-5 days
                          </span>
                                                 {" "}
                        </div>
                                             {" "}
                      </div>
                                           {" "}
                      <div
                        className="flex items-center flex-1"
                        style={{
                          height: "62px",
                          background: "var(--color-surface-muted)",
                          borderRadius: "12px",
                          padding: "16px",
                          gap: "8px",
                        }}
                      >
                                               {" "}
                        <Shield
                          size={20}
                          style={{ color: "var(--color-ink)" }}
                        />
                                               {" "}
                        <div className="flex flex-col">
                                                   {" "}
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: "14px",
                              color: "var(--color-ink)",
                            }}
                          >
                            1 Year Warranty
                          </span>
                                                   {" "}
                          <span
                            style={{
                              fontWeight: 500,
                              fontSize: "12px",
                              color: "var(--color-body)",
                            }}
                          >
                            Brand Warranty
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
                            {/* SECTION 3 — TABS */}             {" "}
              <div className="dt-tabs" style={{ marginTop: "64px" }}>
                               {" "}
                <div
                  className="flex"
                  style={{
                    borderBottom: "1px solid var(--color-border-strong)",
                    gap: "32px",
                  }}
                >
                                   {" "}
                  {[
                    { key: "description", label: "Product Description" },
                    { key: "specifications", label: "Specifications" },
                    { key: "shipping", label: "Shipping & Returns" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      style={{
                        fontWeight: 600,
                        fontSize: "14px",
                        letterSpacing: "0.14px",
                        paddingBottom: "16px",
                        color:
                          activeTab === tab.key
                            ? "var(--color-ink)"
                            : "var(--color-body)",
                        borderBottom:
                          activeTab === tab.key
                            ? "2px solid var(--color-ink)"
                            : "2px solid transparent",
                      }}
                    >
                                            {tab.label}                   {" "}
                    </button>
                  ))}
                                 {" "}
                </div>
                                {/* TAB — Description */}               {" "}
                {activeTab === "description" && (
                  <div
                    className="flex items-start"
                    style={{ gap: "32px", marginTop: "32px" }}
                  >
                                       {" "}
                    <div
                      className="flex flex-col flex-1"
                      style={{ gap: "24px" }}
                    >
                                           {" "}
                      <h3
                        style={{
                          fontWeight: 600,
                          fontSize: "20px",
                          color: "var(--color-ink)",
                        }}
                      >
                        Overview
                      </h3>
                                           {" "}
                      {descPara1 && (
                        <p
                          style={{
                            fontWeight: 400,
                            fontSize: "16px",
                            lineHeight: "26px",
                            color: "var(--color-body)",
                          }}
                        >
                          {descPara1}
                        </p>
                      )}
                                           {" "}
                      {descPara2 && (
                        <p
                          style={{
                            fontWeight: 400,
                            fontSize: "16px",
                            lineHeight: "26px",
                            color: "var(--color-body)",
                          }}
                        >
                          {descPara2}
                        </p>
                      )}
                                           {" "}
                      {features.length > 0 && (
                        <>
                                                   {" "}
                          <h3
                            style={{
                              fontWeight: 600,
                              fontSize: "20px",
                              color: "var(--color-ink)",
                              paddingTop: "16px",
                            }}
                          >
                            Key Features
                          </h3>
                                                   {" "}
                          <div
                            className="grid grid-cols-2"
                            style={{ gap: "8px 24px" }}
                          >
                                                       {" "}
                            {features.map((f, i) => (
                              <div
                                key={i}
                                className="flex items-center"
                                style={{ gap: "8px" }}
                              >
                                                               {" "}
                                <Check
                                  size={20}
                                  style={{
                                    color: "var(--color-primary)",
                                    flexShrink: 0,
                                  }}
                                />
                                                               {" "}
                                <span
                                  style={{
                                    fontWeight: 400,
                                    fontSize: "16px",
                                    color: "var(--color-ink)",
                                  }}
                                >
                                  {f}
                                </span>
                                                             {" "}
                              </div>
                            ))}
                                                     {" "}
                          </div>
                                                 {" "}
                        </>
                      )}
                                         {" "}
                    </div>
                                       {" "}
                    {specRowsDetailed.length > 0 && (
                      <div
                        className="flex-shrink-0"
                        style={{
                          width: "373.33px",
                          background: "var(--color-border)",
                          borderRadius: "12px",
                          padding: "32px",
                        }}
                      >
                                               {" "}
                        <h3
                          style={{
                            fontWeight: 600,
                            fontSize: "20px",
                            color: "var(--color-ink)",
                            marginBottom: "16px",
                          }}
                        >
                          Specifications
                        </h3>
                                               {" "}
                        <div className="flex flex-col" style={{ gap: "16px" }}>
                                                   {" "}
                          {specRowsDetailed
                            .filter((r) => r.value)
                            .map((row, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between"
                                style={{
                                  borderBottom:
                                    "1px solid color-mix(in srgb, var(--color-border-strong) 30%, transparent)",
                                  paddingBottom: "16px",
                                }}
                              >
                                                             {" "}
                                <span
                                  style={{
                                    fontWeight: 400,
                                    fontSize: "16px",
                                    color: "var(--color-body)",
                                  }}
                                >
                                  {row.label
                                    ? prettyLabel(row.label)
                                    : "Detail"}
                                </span>
                                                             {" "}
                                <span
                                  style={{
                                    fontWeight: 700,
                                    fontSize: "16px",
                                    color: "var(--color-ink)",
                                    textAlign: "right",
                                  }}
                                >
                                  {row.value}
                                </span>
                                                           {" "}
                              </div>
                            ))}
                                                 {" "}
                        </div>
                                             {" "}
                      </div>
                    )}
                                     {" "}
                  </div>
                )}
                                {/* TAB — Specifications */}               {" "}
                {activeTab === "specifications" && (
                  <div style={{ marginTop: "32px" }}>
                                       {" "}
                    {specRowsDetailed.length > 0 ? (
                      <div
                        className="flex flex-col"
                        style={{ gap: "16px", maxWidth: "800px" }}
                      >
                                               {" "}
                        {specRowsDetailed
                          .filter((r) => r.value)
                          .map((row, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between"
                              style={{
                                borderBottom:
                                  "1px solid color-mix(in srgb, var(--color-border-strong) 30%, transparent)",
                                paddingBottom: "16px",
                              }}
                            >
                                                         {" "}
                              <span
                                style={{
                                  fontWeight: 400,
                                  fontSize: "16px",
                                  color: "var(--color-body)",
                                }}
                              >
                                {row.label ? prettyLabel(row.label) : "Detail"}
                              </span>
                                                         {" "}
                              <span
                                style={{
                                  fontWeight: 700,
                                  fontSize: "16px",
                                  color: "var(--color-ink)",
                                  textAlign: "right",
                                }}
                              >
                                {row.value}
                              </span>
                                                       {" "}
                            </div>
                          ))}
                                             {" "}
                      </div>
                    ) : (
                      <p
                        style={{
                          fontWeight: 400,
                          fontSize: "16px",
                          lineHeight: "26px",
                          color: "var(--color-body)",
                        }}
                      >
                        No specifications available.
                      </p>
                    )}
                                     {" "}
                  </div>
                )}
                                {/* TAB — Shipping & Returns */}               {" "}
                {activeTab === "shipping" && (
                  <div
                    className="flex flex-col"
                    style={{
                      marginTop: "32px",
                      gap: "16px",
                      maxWidth: "800px",
                    }}
                  >
                                       {" "}
                    <p
                      style={{
                        fontWeight: 400,
                        fontSize: "16px",
                        lineHeight: "26px",
                        color: "var(--color-body)",
                      }}
                    >
                      Standard delivery 3-5 business days.
                    </p>
                                       {" "}
                    <p
                      style={{
                        fontWeight: 400,
                        fontSize: "16px",
                        lineHeight: "26px",
                        color: "var(--color-body)",
                      }}
                    >
                      Express delivery 1-2 business days.
                    </p>
                                       {" "}
                    <p
                      style={{
                        fontWeight: 400,
                        fontSize: "16px",
                        lineHeight: "26px",
                        color: "var(--color-body)",
                      }}
                    >
                      Free returns within 30 days.
                    </p>
                                     {" "}
                  </div>
                )}
                             {" "}
              </div>
                            {/* SECTION 4 — CUSTOMER REVIEWS */}             {" "}
              <div
                style={{
                  borderTop: "1px solid var(--color-border-strong)",
                  paddingTop: "72px",
                  marginTop: "72px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "48px",
                }}
              >
                               {" "}
                <div className="flex items-center justify-between">
                                   {" "}
                  <h2
                    style={{
                      fontWeight: 600,
                      fontSize: "32px",
                      color: "var(--color-ink)",
                    }}
                  >
                    Customer Reviews
                  </h2>
                                   {" "}
                  <div className="flex items-center" style={{ gap: "8px" }}>
                                       {" "}
                    <span
                      style={{
                        fontWeight: 400,
                        fontSize: "16px",
                        color: "var(--color-body)",
                      }}
                    >
                      Sort by:
                    </span>
                                       {" "}
                    <select
                      value={reviewSortOrder}
                      onChange={(e) => setReviewSortOrder(e.target.value)}
                      style={{
                        background: "var(--color-background)",
                        border: "1px solid var(--color-muted)",
                        borderRadius: "8px",
                        padding: "8px 16px",
                        fontSize: "14px",
                        color: "var(--color-ink)",
                      }}
                    >
                                           {" "}
                      <option value="recent">Most Recent</option>               
                            <option value="highest">Highest Rated</option>     
                                     {" "}
                      <option value="lowest">Lowest Rated</option>             
                           {" "}
                    </select>
                                     {" "}
                  </div>
                                 {" "}
                </div>
                               {" "}
                <div className="flex items-start" style={{ gap: "48px" }}>
                                    {/* Rating Summary */}                 {" "}
                  <div
                    className="flex flex-col flex-shrink-0"
                    style={{
                      width: "350px",
                      background: "var(--color-surface-muted)",
                      borderRadius: "12px",
                      padding: "32px",
                      gap: "32px",
                    }}
                  >
                                       {" "}
                    <div
                      className="flex flex-col items-center"
                      style={{ gap: "8px" }}
                    >
                                           {" "}
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "56px",
                          color: "var(--color-ink)",
                          lineHeight: 1,
                        }}
                      >
                        {avgRating.toFixed(1)}
                      </span>
                                           {" "}
                      <DStars rating={avgRating} size={20} />                   
                       {" "}
                      <span
                        style={{
                          fontWeight: 400,
                          fontSize: "16px",
                          color: "var(--color-body)",
                        }}
                      >
                                                Total{" "}
                        {reviewCount.toLocaleString("en-IN")} reviews          
                                   {" "}
                      </span>
                                         {" "}
                    </div>
                                       {" "}
                    <div className="flex flex-col" style={{ gap: "8px" }}>
                                           {" "}
                      {[5, 4, 3, 2, 1].map((star) => {
                        const count = ratingStats[star] || 0;
                        const pct =
                          reviewCount > 0 ? (count / reviewCount) * 100 : 0;
                        return (
                          <div
                            key={star}
                            className="flex items-center"
                            style={{ gap: "8px" }}
                          >
                                                       {" "}
                            <span
                              style={{
                                fontSize: "16px",
                                color: "var(--color-ink)",
                                width: "12px",
                              }}
                            >
                              {star}
                            </span>
                                                       {" "}
                            <div
                              className="flex-1 overflow-hidden"
                              style={{
                                height: "8px",
                                background: "var(--color-border)",
                                borderRadius: "9999px",
                              }}
                            >
                                                           {" "}
                              <div
                                style={{
                                  height: "100%",
                                  width: `${pct}%`,
                                  background: "var(--color-primary)",
                                  borderRadius: "9999px",
                                }}
                              />
                                                         {" "}
                            </div>
                                                       {" "}
                            <span
                              style={{
                                fontWeight: 400,
                                fontSize: "16px",
                                color: "var(--color-ink)",
                                width: "24px",
                                textAlign: "right",
                              }}
                            >
                              {count}
                            </span>
                                                     {" "}
                          </div>
                        );
                      })}
                                         {" "}
                    </div>
                                     {" "}
                  </div>
                                    {/* Review cards */}                 {" "}
                  <div className="flex flex-col flex-1" style={{ gap: "32px" }}>
                                       {" "}
                    {sortedReviews.length === 0 ? (
                      <p
                        style={{
                          fontWeight: 400,
                          fontSize: "16px",
                          color: "var(--color-body)",
                        }}
                      >
                        No reviews yet. Be the first to review this product.
                      </p>
                    ) : (
                      <>
                                               {" "}
                        {displayedReviews.map((review, i) => {
                          const initials =
                            review.userInitials || getInitials(review.userName);
                          const avatarBg =
                            review.avatarColor ||
                            AVATAR_COLORS[i % AVATAR_COLORS.length];
                          return (
                            <div
                              key={review.id}
                              style={{
                                borderBottom:
                                  "1px solid var(--color-border-strong)",
                                paddingBottom: "32px",
                              }}
                            >
                                                           {" "}
                              <div
                                className="flex items-center"
                                style={{ gap: "16px" }}
                              >
                                                               {" "}
                                <div
                                  className="flex items-center justify-center flex-shrink-0"
                                  style={{
                                    width: "48px",
                                    height: "48px",
                                    borderRadius: "9999px",
                                    background: avatarBg,
                                    fontWeight: 700,
                                    fontSize: "16px",
                                    color: "var(--color-ink)",
                                  }}
                                >
                                                                    {initials} 
                                                               {" "}
                                </div>
                                                               {" "}
                                <div
                                  className="flex flex-col"
                                  style={{ gap: "4px" }}
                                >
                                                                   {" "}
                                  <span
                                    style={{
                                      fontWeight: 400,
                                      fontSize: "16px",
                                      color: "var(--color-ink)",
                                    }}
                                  >
                                    {review.userName || "Anonymous"}
                                  </span>
                                                                   {" "}
                                  <div
                                    className="flex items-center"
                                    style={{ gap: "12px" }}
                                  >
                                                                       {" "}
                                    <DStars
                                      rating={Number(review.rating) || 0}
                                      size={15}
                                    />
                                                                       {" "}
                                    <span
                                      style={{
                                        fontWeight: 400,
                                        fontSize: "16px",
                                        color: "var(--color-body)",
                                      }}
                                    >
                                      {formatReviewDate(review.createdAt)}
                                    </span>
                                                                     {" "}
                                  </div>
                                                                 {" "}
                                </div>
                                                             {" "}
                              </div>
                                                           {" "}
                              {review.title && (
                                <h4
                                  style={{
                                    fontWeight: 600,
                                    fontSize: "20px",
                                    color: "var(--color-ink)",
                                    paddingTop: "8px",
                                  }}
                                >
                                  {review.title}
                                </h4>
                              )}
                                                           {" "}
                              <p
                                style={{
                                  fontWeight: 400,
                                  fontSize: "16px",
                                  lineHeight: "24px",
                                  color: "var(--color-body)",
                                  paddingTop: review.title ? "4px" : "8px",
                                }}
                              >
                                                               {" "}
                                {review.body || review.comment}                 
                                           {" "}
                              </p>
                                                         {" "}
                            </div>
                          );
                        })}
                                               {" "}
                        {sortedReviews.length > 3 && (
                          <button
                            onClick={() => setShowAllReviews((v) => !v)}
                            className="w-full"
                            style={{
                              height: "60px",
                              border: "2px solid var(--color-ink)",
                              borderRadius: "12px",
                              fontWeight: 700,
                              fontSize: "16px",
                              color: "var(--color-ink)",
                            }}
                          >
                                                       {" "}
                            {showAllReviews ? "Show Less" : "View All Reviews"} 
                                                   {" "}
                          </button>
                        )}
                                             {" "}
                      </>
                    )}
                                     {" "}
                  </div>
                                 {" "}
                </div>
                             {" "}
              </div>
                            {/* SECTION 5 — RELATED PRODUCTS */}             {" "}
              {relatedProducts.length > 0 && (
                <div
                  style={{
                    paddingTop: "72px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "32px",
                  }}
                >
                                   {" "}
                  <div className="flex items-center justify-between">
                                       {" "}
                    <h2
                      style={{
                        fontWeight: 600,
                        fontSize: "32px",
                        color: "var(--color-ink)",
                      }}
                    >
                      You May Also Like
                    </h2>
                                       {" "}
                    <div className="flex items-center" style={{ gap: "8px" }}>
                                           {" "}
                      <button
                        onClick={() => scrollRelated(-1)}
                        className="flex items-center justify-center"
                        style={{
                          width: "40px",
                          height: "40px",
                          border: "1px solid var(--color-border-strong)",
                          borderRadius: "9999px",
                        }}
                        aria-label="Scroll left"
                      >
                                               {" "}
                        <ChevronLeft
                          size={16}
                          style={{ color: "var(--color-ink)" }}
                        />
                                             {" "}
                      </button>
                                           {" "}
                      <button
                        onClick={() => scrollRelated(1)}
                        className="flex items-center justify-center"
                        style={{
                          width: "40px",
                          height: "40px",
                          border: "1px solid var(--color-border-strong)",
                          borderRadius: "9999px",
                        }}
                        aria-label="Scroll right"
                      >
                                               {" "}
                        <ChevronRight
                          size={16}
                          style={{ color: "var(--color-ink)" }}
                        />
                                             {" "}
                      </button>
                                         {" "}
                    </div>
                                     {" "}
                  </div>
                                   {" "}
                  <div
                    ref={relatedScrollRef}
                    className="flex no-scrollbar"
                    style={{ gap: "24px", overflowX: "auto" }}
                  >
                                       {" "}
                    {relatedProducts.map((rp) => {
                      const rpName = rp.title || rp.name || "Product";
                      const rpImg = rp.thumbnail || rp.image || rp.imageUrl;
                      return (
                        <div
                          key={rp.id}
                          onClick={() =>
                            navigate(`/product/${rp.id}`, {
                              state: { product: rp },
                            })
                          }
                          className="dt-related-card flex flex-col cursor-pointer flex-shrink-0 group"
                          style={{ width: "286px", gap: "4px" }}
                        >
                                                   {" "}
                          <div
                            className="relative overflow-hidden"
                            style={{
                              width: "286px",
                              height: "357.5px",
                              background: "var(--color-surface-muted)",
                              borderRadius: "12px",
                            }}
                          >
                                                       {" "}
                            <img
                              src={rpImg}
                              alt={rpName}
                              className="w-full h-full object-cover"
                            />
                                                       {" "}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                              className="absolute flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{
                                top: "16px",
                                right: "16px",
                                width: "32px",
                                height: "32px",
                                background:
                                  "color-mix(in srgb, var(--color-surface) 80%, transparent)",
                                backdropFilter: "blur(4px)",
                                borderRadius: "9999px",
                              }}
                              aria-label="Wishlist"
                            >
                                                           {" "}
                              <Heart
                                size={16}
                                style={{ color: "var(--color-body)" }}
                              />
                                                         {" "}
                            </button>
                                                     {" "}
                          </div>
                                                   {" "}
                          <span
                            style={{
                              fontWeight: 400,
                              fontSize: "16px",
                              color: "var(--color-body)",
                              paddingTop: "12px",
                            }}
                            className="capitalize"
                          >
                            {rp.brand || rp.category}
                          </span>
                                                   {" "}
                          <span
                            style={{
                              fontWeight: 400,
                              fontSize: "16px",
                              color: "var(--color-ink)",
                            }}
                          >
                            {rpName}
                          </span>
                                                   {" "}
                          {(() => {
                            const rpMrp = Number(rp.price || 0);
                            const rpDisc = Number(rp.discount || 0);
                            const rpPrice = rpMrp - (rpMrp * rpDisc) / 100;
                            return rpDisc > 0 ? (
                              <div
                                className="flex items-center"
                                style={{ gap: "8px", flexWrap: "wrap" }}
                              >
                                                               {" "}
                                <span
                                  style={{
                                    fontWeight: 700,
                                    fontSize: "16px",
                                    color: "var(--color-primary)",
                                  }}
                                >
                                  {formatINR(rpPrice)}
                                </span>
                                                               {" "}
                                <span
                                  style={{
                                    fontWeight: 400,
                                    fontSize: "14px",
                                    color: "var(--color-muted)",
                                    textDecoration: "line-through",
                                  }}
                                >
                                  {formatINR(rpMrp)}
                                </span>
                                                               {" "}
                                <span
                                  style={{
                                    background: "var(--color-error-subtle)",
                                    borderRadius: "4px",
                                    padding: "2px 6px",
                                    fontWeight: 600,
                                    fontSize: "11px",
                                    color: "var(--color-error)",
                                  }}
                                >
                                  {rpDisc}% OFF
                                </span>
                                                             {" "}
                              </div>
                            ) : (
                              <span
                                style={{
                                  fontWeight: 700,
                                  fontSize: "16px",
                                  color: "var(--color-ink)",
                                }}
                              >
                                {formatINR(rpMrp)}
                              </span>
                            );
                          })()}
                                                 {" "}
                        </div>
                      );
                    })}
                                     {" "}
                  </div>
                                 {" "}
                </div>
              )}
                         {" "}
            </div>
                     {" "}
          </div>
                 {" "}
        </>
      )}
         {" "}
    </div>
  );
};

export default memo(ProductDetail);
