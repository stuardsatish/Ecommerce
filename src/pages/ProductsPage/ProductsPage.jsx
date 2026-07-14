import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  memo,
  useRef,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { addProduct } from "../../context/ProductSlice";
import { addCart, removeCart } from "../../context/CartSlice";
import { addWishlist, removeWishlist } from "../../context/WishlistSlice";
import { ProductCard } from "../../features/products/ProductCard";
import { ProductCardSkeleton } from "../../features/products/ProductCardSkeleton";
import FiltersSidebar from "../../features/products/FiltersSidebar";
import useIsMobile from "../../hooks/useIsMobile";
import {
  ArrowLeft,
  Search as SearchIcon,
  ShoppingCart,
  Home as HomeIcon,
  Heart as HeartIcon,
  User as UserIcon,
  SlidersHorizontal,
  Star,
  Heart,
  X,
  Store,
  ChevronRight,
  RefreshCw,
  LayoutGrid,
  Filter,
} from "lucide-react";

import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
} from "firebase/firestore";
import { auth, fireDB } from "../../context/FirebaseConfig";

/* ============================================================
   DESKTOP DESIGN HELPERS
============================================================ */
const PAGE_SIZE = 8;

const SORT_OPTIONS = [
  { value: "rating", label: "Top Rated" },
  { value: "priceLow", label: "Price: Low to High" },
  { value: "priceHigh", label: "Price: High to Low" },
  { value: "newest", label: "Newest" },
];

// Resolve the design's expected fields against the project's actual product shape.
const getName = (p) => p.title || p.name || "Untitled Product";
const getImage = (p) =>
  p.imageUrl ||
  p.thumbnail ||
  p.image ||
  "https://picsum.photos/seed/" + (p.id || "x") + "/400/400";
const getMrp = (p) => Number(p.price || 0); // Firebase price = MRP
const getDiscount = (p) => {
  if (p.discountExpiry) {
    const expiry = new Date(p.discountExpiry).getTime();
    if (Date.now() > expiry) return 0;
  }
  return Number(p.discount || 0);
};

const getPrice = (p) => {
  const mrp = getMrp(p);
  const discount = getDiscount(p);

  return mrp - (mrp * discount) / 100;
};
const getStock = (p) => Number(p.stock || 0);
const getMaxStock = (p) =>
  Number(p.maxStock || 0) || Math.max(getStock(p), 100);

const Stars = ({ rating = 0, size = 12 }) => (
  <span className="flex items-center" style={{ gap: "1px" }}>
    {[0, 1, 2, 3, 4].map((i) => (
      <Star
        key={i}
        size={size}
        style={{ color: "#A43B31" }}
        fill={i < Math.round(rating) ? "#A43B31" : "none"}
        strokeWidth={1.5}
      />
    ))}
  </span>
);

/* PRODUCT CARD (desktop, scaled to match the reference) */
const NewProductCard = ({
  product,
  onAddToCart,
  onToggleWishlist,
  isWishlisted,
  quantity,
  onDecrement,
}) => {
  const navigate = useNavigate();
  const name = getName(product);
  console.log(product);
  const mrp = getMrp(product);
  const discount = getDiscount(product);
  const discountedPrice = getPrice(product);
  const stock = getStock(product);
  const maxStock = getMaxStock(product);
  const pct = Math.max(0, Math.min(100, Math.round((stock / maxStock) * 100)));
  const isLow = pct <= 20;
  const isOut = stock <= 0;

  return (
    <div className="product-card flex flex-col bg-white border border-[#C3C7C8] rounded-xl overflow-hidden shadow-[0px_4px_12px_rgba(0,0,0,0.05)]">
      {/* Image area */}
      <div
        className="relative cursor-pointer"
        style={{ height: "160px", background: "#F6F3F2" }}
        onClick={() =>
          navigate(`/product/${product.id}`, { state: { product } })
        }
      >
        <img
          src={getImage(product)}
          alt={name}
          loading="lazy"
          className="w-full h-full object-cover"
        />
        <span className="absolute top-2.5 left-2.5 bg-[#1B1C1C] text-white uppercase font-bold rounded px-2 py-0.5 text-[9px] tracking-wide">
          {product.badge || product.category || "Product"}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleWishlist(product);
          }}
          aria-label="Toggle wishlist"
          className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center bg-white/70"
          style={{
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
          }}
        >
          <Heart
            size={15}
            style={{ color: isWishlisted ? "#A43B31" : "#44474C" }}
            fill={isWishlisted ? "#A43B31" : "none"}
          />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Stars rating={product.rating} />
          <span className="text-[12px] font-medium text-[#44474C]">
            {Number(product.rating || 0).toFixed(1)}
          </span>
        </div>

        <h3
          className="font-semibold text-[#1B1C1C]"
          style={{
            fontSize: "14px",
            lineHeight: "19px",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: "38px",
          }}
        >
          {name}
        </h3>

        <div className="mt-2">
          {discount > 0 ? (
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[16px] font-bold text-[#A43B31]">
                  ₹{discountedPrice.toFixed(2)}
                </span>

                <span className="text-[13px] text-gray-400 line-through">
                  ₹{mrp.toFixed(2)}
                </span>

                <span className="text-[11px] font-semibold text-green-600">
                  {discount}% OFF
                </span>
              </div>
              {product.discountExpiry && (
                <div className="text-[10px] text-amber-700 font-medium mt-1">
                  Ends: {new Date(product.discountExpiry).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                </div>
              )}
            </div>
          ) : (
            <span className="text-[16px] font-bold text-[#A43B31]">
              ₹{mrp.toFixed(2)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2 mb-3">
          <span
            className="rounded px-2 py-0.5 text-[11px] font-bold"
            style={
              isOut || isLow
                ? { background: "#FFDAD6", color: "#BA1A1A" }
                : { background: "#DCFCE7", color: "#166534" }
            }
          >
            {isOut ? "Out of Stock" : `Available: ${stock}`}
          </span>
          <div
            className="rounded-full overflow-hidden"
            style={{ width: "70px", height: "5px", background: "#EAE7E7" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: isLow ? "#BA1A1A" : "#22C55E",
              }}
            />
          </div>
        </div>

        <div className="mt-auto">
          {isOut ? (
            <button
              disabled
              className="w-full flex items-center justify-center gap-2 rounded-lg font-bold text-[13px] cursor-not-allowed"
              style={{
                height: "40px",
                background: "#EAE7E7",
                color: "#74777D",
              }}
            >
              Out of Stock
            </button>
          ) : quantity > 0 ? (
            <div
              className="w-full flex items-center justify-between rounded-lg overflow-hidden border border-[#A43B31]"
              style={{ height: "40px" }}
            >
              <button
                onClick={() => onDecrement(product)}
                className="h-full flex-1 font-bold text-[18px] text-[#694000]"
              >
                −
              </button>
              <span className="font-bold text-[14px] text-[#1B1C1C] min-w-[24px] text-center">
                {quantity}
              </span>
              <button
                onClick={() => onAddToCart(product)}
                disabled={quantity >= stock}
                className="h-full flex-1 font-bold text-[18px]"
                style={{ color: quantity >= stock ? "#E0C9A0" : "#694000" }}
              >
                +
              </button>
            </div>
          ) : (
            <button
              onClick={() => onAddToCart(product)}
              className="w-full flex items-center justify-center gap-2 rounded-lg font-bold text-[13px]"
              style={{
                height: "40px",
                background: "#A43B31",
                color: "#FFFFFF",
              }}
            >
              <ShoppingCart size={15} />
              Add to Cart
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const SectionLabel = ({ children }) => (
  <p
    className="uppercase font-bold text-[#1B1C1C] mb-2"
    style={{ letterSpacing: "0.7px", fontSize: "11px" }}
  >
    {children}
  </p>
);

const CheckRow = ({ checked, onChange, children, count }) => (
  <label className="flex items-center gap-2 py-1 cursor-pointer select-none">
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="w-4 h-4 rounded-[4px] border border-[#C3C7C8] bg-white accent-[#1B1C1C] cursor-pointer"
    />
    <span className="flex-1 text-[13px] text-[#44474C]">{children}</span>
    {count !== undefined && (
      <span className="text-[12px] text-[#44474C] opacity-60">{count}</span>
    )}
  </label>
);

/* ============================================================
   PRODUCTS PAGE
============================================================ */
const ProductsPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const products = useSelector((state) => state.products.product);
  const cartItems = useSelector((state) => state.cart.cartItems);
  const wishlistItems = useSelector((state) => state.wishlist.wishlistItems);
  const [loading, setLoading] = useState(false);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  // Mobile layout (≤640px) — desktop layout is rendered untouched above this breakpoint
  const isMobile = useIsMobile(640);
  const searchInputRef = useRef(null);

  // FILTER STATES (shared by mobile layout / FiltersSidebar)
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [minPrice, setMinPrice] = useState(0);
  const [minRating, setMinRating] = useState(0);
  const [sort, setSort] = useState("");
  const [search, setSearch] = useState("");

  // DESKTOP-ONLY FILTER STATE (richer sidebar from the new design)
  const [filterSearch, setFilterSearch] = useState("");
  const [selectedDepartments, setSelectedDepartments] = useState([]);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [ratingThresholds, setRatingThresholds] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [activeChip, setActiveChip] = useState("all");
  const [deskSearch, setDeskSearch] = useState("");
  const [deskSort, setDeskSort] = useState("rating");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [applyTick, setApplyTick] = useState(0);

  const sidebarRef = useRef(null);
  const chipsRef = useRef(null);
  const gridRef = useRef(null);

  // CLEAR FILTERS (mobile)
  const clearFilters = useCallback(() => {
    setSelectedCategories([]);
    setMinPrice(0);
    setMinRating(0);
    setSort("");
    setSearch("");
  }, []);

  // FETCH PRODUCTS
  const fetchProducts = async () => {
    try {
      setLoading(true);

      const productSnapshot = await getDocs(collection(fireDB, "products"));
      const reviewsSnapshot = await getDocs(collection(fireDB, "reviews"));
      const reviewsData = reviewsSnapshot.docs.map((doc) => doc.data());

      const ratingsMap = {};
      reviewsData.forEach((review) => {
        const pid = String(review.productId);
        if (!ratingsMap[pid]) ratingsMap[pid] = { total: 0, count: 0 };
        ratingsMap[pid].total += Number(review.rating || 0);
        ratingsMap[pid].count += 1;
      });

      const productArray = productSnapshot.docs.map((doc) => {
        const data = doc.data();
        const pid = doc.id;
        const ratingInfo = ratingsMap[pid];
        const avgRating = ratingInfo ? ratingInfo.total / ratingInfo.count : 0;

        return {
          id: pid,
          ...data,
          rating: avgRating,
          reviewCount: ratingInfo ? ratingInfo.count : 0,
          createdAt: data.createdAt
            ? data.createdAt.toDate().toISOString()
            : null,
        };
      });

      dispatch(addProduct(productArray));
    } catch (error) {
      console.log("Error fetching products:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!products.length) {
      fetchProducts();
    }
  }, []);

  // Lock body when mobile filter is open
  useEffect(() => {
    if (mobileFilterOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileFilterOpen]);

  // FILTER & SORT & GROUP PRODUCTS (mobile layout)
  const { filteredProducts, groupedProducts } = useMemo(() => {
    let filtered = products.filter((product) => {
      return (
        (selectedCategories.length
          ? selectedCategories.includes(product.category)
          : true) &&
        product.price >= minPrice &&
        Number(product.rating || 0) >= minRating &&
        product.title?.toLowerCase().includes(search.toLowerCase())
      );
    });

    if (sort === "priceLow") filtered.sort((a, b) => a.price - b.price);
    else if (sort === "priceHigh") filtered.sort((a, b) => b.price - a.price);
    else if (sort === "rating")
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));

    const grouped = filtered.reduce((acc, product) => {
      if (!acc[product.category]) {
        acc[product.category] = [];
      }
      acc[product.category].push(product);
      return acc;
    }, {});

    return { filteredProducts: filtered, groupedProducts: grouped };
  }, [products, selectedCategories, minPrice, minRating, sort, search]);

  // UNIQUE CATEGORIES
  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category))],
    [products],
  );

  // MAX PRICE FOR FILTER
  const maxPriceValue = useMemo(() => {
    if (products.length === 0) return 2000;
    return Math.max(...products.map((p) => Number(p.price || 0)));
  }, [products]);

  // MOBILE: total cart count (drives the app-bar badge + bottom-nav dot)
  const cartCount = useMemo(
    () => cartItems.reduce((acc, item) => acc + (item.quantity || 0), 0),
    [cartItems],
  );

  // Count active filters
  const activeFilterCount =
    selectedCategories.length +
    (minPrice > 0 ? 1 : 0) +
    (minRating > 0 ? 1 : 0) +
    (sort ? 1 : 0) +
    (search ? 1 : 0);

  /* ============================================================
       DESKTOP DERIVED DATA (new design, independent of mobile state)
    ============================================================ */
  const categoryCounts = useMemo(() => {
    const map = {};
    products.forEach((p) => {
      if (!p.category) return;
      map[p.category] = (map[p.category] || 0) + 1;
    });
    return map;
  }, [products]);

  const displayedDepartments = useMemo(
    () =>
      categories
        .filter(Boolean)
        .filter((c) => c.toLowerCase().includes(filterSearch.toLowerCase())),
    [categories, filterSearch],
  );

  const minRatingDesk = useMemo(
    () => (ratingThresholds.length ? Math.min(...ratingThresholds) : 0),
    [ratingThresholds],
  );

  const desktopFiltered = useMemo(() => {
    const minP = priceMin === "" ? 0 : Number(priceMin);
    const maxP = priceMax === "" ? Infinity : Number(priceMax);

    let filtered = products.filter((p) => {
      const stock = getStock(p);
      const maxStock = getMaxStock(p);
      const pctv = (stock / maxStock) * 100;

      if (
        selectedDepartments.length &&
        !selectedDepartments.includes(p.category)
      )
        return false;
      if (activeChip !== "all" && p.category !== activeChip) return false;
      if (getPrice(p) < minP || getPrice(p) > maxP) return false;
      if (Number(p.rating || 0) < minRatingDesk) return false;
      if (availability.length) {
        const isInStock = stock > 0;
        const isLowStock = stock > 0 && pctv <= 20;
        const matches =
          (availability.includes("inStock") && isInStock) ||
          (availability.includes("lowStock") && isLowStock);
        if (!matches) return false;
      }
      if (
        deskSearch &&
        !getName(p).toLowerCase().includes(deskSearch.toLowerCase())
      )
        return false;
      return true;
    });

    if (deskSort === "priceLow")
      filtered = [...filtered].sort((a, b) => getPrice(a) - getPrice(b));
    else if (deskSort === "priceHigh")
      filtered = [...filtered].sort((a, b) => getPrice(b) - getPrice(a));
    else if (deskSort === "rating")
      filtered = [...filtered].sort(
        (a, b) => (b.rating || 0) - (a.rating || 0),
      );
    else if (deskSort === "newest")
      filtered = [...filtered].sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      );

    return filtered;
  }, [
    products,
    selectedDepartments,
    activeChip,
    priceMin,
    priceMax,
    minRatingDesk,
    availability,
    deskSearch,
    deskSort,
  ]);

  const desktopVisible = useMemo(
    () => desktopFiltered.slice(0, visibleCount),
    [desktopFiltered, visibleCount],
  );

  const desktopGrouped = useMemo(() => {
    return desktopVisible.reduce((acc, p) => {
      const c = p.category || "Other";
      if (!acc[c]) acc[c] = [];
      acc[c].push(p);
      return acc;
    }, {});
  }, [desktopVisible]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [
    selectedDepartments,
    activeChip,
    priceMin,
    priceMax,
    minRatingDesk,
    availability,
    deskSearch,
    deskSort,
  ]);

  /* ---------- DESKTOP CART / WISHLIST HELPERS ---------- */
  const cartQty = useCallback(
    (id) => {
      const item = cartItems.find((x) => String(x.id) === String(id));
      return item ? item.quantity : 0;
    },
    [cartItems],
  );

  const handleAddToCart = useCallback(
    (product) => {
      if (!auth.currentUser) {
        navigate("/login");
        return;
      }
      dispatch(addCart(product));
    },
    [dispatch, navigate],
  );

  const handleDecrement = useCallback(
    (product) => dispatch(removeCart(String(product.id))),
    [dispatch],
  );

  const isWishlisted = useCallback(
    (id) => wishlistItems.some((item) => String(item.id) === String(id)),
    [wishlistItems],
  );

  const handleToggleWishlist = useCallback(
    async (product) => {
      const user = auth.currentUser;
      if (!user) {
        navigate("/login");
        return;
      }
      const productId = String(product.id);
      try {
        const wishlistRef = collection(fireDB, "wishlists");
        const snapshot = await getDocs(
          query(wishlistRef, where("userId", "==", user.uid)),
        );
        const existing = snapshot.docs.find(
          (d) =>
            d.data().userId === user.uid && d.data().productId === productId,
        );

        if (existing) {
          dispatch(removeWishlist(productId));
          await deleteDoc(doc(fireDB, "wishlists", existing.id));
        } else {
          const reduxItem = {
            userId: user.uid,
            productId,
            id: productId,
            title: getName(product),
            price: getPrice(product),
            image: getImage(product),
            category: product.category,
            addedAt: new Date().toISOString(),
          };
          dispatch(addWishlist(reduxItem));
          await setDoc(doc(collection(fireDB, "wishlists")), {
            ...reduxItem,
            addedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        console.log("Wishlist error:", error);
      }
    },
    [dispatch, navigate],
  );

  const toTitleCase = (text) => {
    if (!text) return "";

    return text
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const toggleDepartment = (cat) =>
    setSelectedDepartments((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );

  const toggleRating = (threshold) =>
    setRatingThresholds((prev) =>
      prev.includes(threshold)
        ? prev.filter((t) => t !== threshold)
        : [...prev, threshold],
    );

  const toggleAvailability = (key) =>
    setAvailability((prev) =>
      prev.includes(key) ? prev.filter((a) => a !== key) : [...prev, key],
    );

  const clearAllFilters = useCallback(() => {
    setFilterSearch("");
    setSelectedDepartments([]);
    setPriceMin("");
    setPriceMax("");
    setRatingThresholds([]);
    setAvailability([]);
    setActiveChip("all");
    setDeskSearch("");
    setDeskSort("rating");
  }, []);

  const applyFilters = () => {
    setApplyTick((t) => t + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* ---------- DESKTOP ANIMATIONS ---------- */
  useGSAP(
    () => {
      if (sidebarRef.current) {
        gsap.from(sidebarRef.current, {
          x: -30,
          opacity: 0,
          duration: 0.6,
          ease: "power2.out",
        });
      }
    },
    { scope: sidebarRef },
  );

  useGSAP(
    () => {
      const chips = chipsRef.current?.querySelectorAll(".cat-chip");
      if (chips?.length) {
        gsap.from(chips, {
          y: 10,
          opacity: 0,
          duration: 0.4,
          stagger: 0.05,
          ease: "power2.out",
        });
      }
    },
    { dependencies: [categories.length], scope: chipsRef },
  );

  useGSAP(
    () => {
      const cards = gridRef.current?.querySelectorAll(".product-card");
      if (cards?.length) {
        gsap.from(cards, {
          y: 20,
          opacity: 0,
          duration: 0.5,
          stagger: 0.08,
          ease: "power2.out",
        });
      }
    },
    {
      dependencies: [visibleCount, activeChip, deskSort, deskSearch, applyTick],
      scope: gridRef,
    },
  );

  const totalProductCount = products.length;

  /* ============================================================
       MOBILE LAYOUT (≤640px) — matches the reference design.
       All Firebase/Redux logic above is shared; this is layout only.
    ============================================================ */
  if (isMobile) {
    const navIcon = (color) => ({ color });
    return (
      <div
        className="min-h-screen bg-[#FBF9F8]"
        style={{
          fontFamily: "Inter, sans-serif",
          overflowX: "hidden",
          maxWidth: "100vw",
        }}
      >
        {/* ── SEARCH SECTION (fixed flush under the global mobile header, 56px) ── */}
        <div
          className="fixed inset-x-0 z-40 flex items-center"
          style={{
            top: "56px",
            height: "76px",
            background: "#FBF9F8",
            padding: "16px 20px",
            gap: "12px",
          }}
        >
          <div className="relative flex-1">
            <SearchIcon
              size={15}
              style={{
                color: "#74777D",
                position: "absolute",
                left: "16px",
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
              }}
            />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search for items..."
              className="w-full outline-none mobile-search-input"
              style={{
                background: "#F6F3F2",
                borderRadius: "12px",
                height: "44px",
                padding: "13px 16px 14px 48px",
                fontSize: "14px",
                fontWeight: 400,
                color: "#1B1C1C",
                fontFamily: "Inter, sans-serif",
              }}
            />
          </div>
          {/* Filter trigger — opens the full filter sheet (all desktop filters) */}
          <button
            onClick={() => setMobileFilterOpen(true)}
            aria-label="Filters"
            className="relative flex items-center justify-center flex-shrink-0"
            style={{
              width: "44px",
              height: "44px",
              background: "#F6F3F2",
              borderRadius: "12px",
            }}
          >
            <SlidersHorizontal size={18} color="#74777D" />
            {activeFilterCount > 0 && (
              <span
                className="absolute flex items-center justify-center"
                style={{
                  top: "-4px",
                  right: "-4px",
                  minWidth: "16px",
                  height: "16px",
                  padding: "0 4px",
                  background: "#A43B31",
                  color: "#fff",
                  border: "1px solid #FBF9F8",
                  borderRadius: "9999px",
                  fontSize: "9px",
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* ── SCROLLABLE CONTENT (grouped by category, like desktop) ── */}
        {/* paddingTop = 56px header + 76px search bar + 8px gap. paddingBottom clears the global tab bar. */}
        <main
          className="px-5"
          style={{ paddingTop: "140px", paddingBottom: "72px" }}
        >
          {loading ? (
            <div className="grid grid-cols-2" style={{ gap: "16px" }}>
              {[...Array(6)].map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : Object.keys(groupedProducts).length === 0 ? (
            <div
              className="flex flex-col items-center justify-center text-center"
              style={{ gap: "14px", minHeight: "40vh" }}
            >
              <p
                style={{ color: "#74777D", fontSize: "13px", fontWeight: 600 }}
              >
                {activeFilterCount > 0
                  ? "No products match your filters."
                  : "No products available right now."}
              </p>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  style={{
                    color: "#A43B31",
                    fontWeight: 700,
                    fontSize: "12px",
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            Object.keys(groupedProducts).map((category) => (
              <div key={category} style={{ marginBottom: "24px" }}>
                <div
                  className="flex items-center justify-between"
                  style={{ marginBottom: "12px" }}
                >
                  <h2
                    style={{
                      fontSize: "18px",
                      fontWeight: 700,
                      color: "#1B1C1C",
                      textTransform: "capitalize",
                    }}
                  >
                    {category}
                  </h2>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      color: "#74777D",
                    }}
                  >
                    {groupedProducts[category].length} items
                  </span>
                </div>
                <div className="grid grid-cols-2" style={{ gap: "16px" }}>
                  {groupedProducts[category].map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      variant="mobile"
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </main>

        {/* ── BOTTOM NAV BAR — superseded by the global MobileNav tab bar; hidden. ── */}
        <nav
          className="fixed bottom-0 inset-x-0 z-50 flex items-center justify-around"
          style={{
            display: "none",
            height: "64px",
            background: "rgba(251,249,248,0.8)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            borderRadius: "12px 12px 0 0",
            boxShadow:
              "0px 10px 15px -3px rgba(0,0,0,0.1), 0px 4px 6px -4px rgba(0,0,0,0.1)",
          }}
        >
          {/* Home — active on this route per spec */}
          <button
            onClick={() => navigate("/")}
            className="flex flex-col items-center justify-center"
            style={{ gap: "4px", ...navIcon("#A43B31") }}
          >
            <HomeIcon size={20} />
            <span style={{ fontSize: "10px", fontWeight: 500 }}>Home</span>
          </button>
          {/* Search */}
          <button
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
              searchInputRef.current?.focus();
            }}
            className="flex flex-col items-center justify-center"
            style={{ gap: "4px", ...navIcon("#44474C") }}
          >
            <SearchIcon size={20} />
            <span style={{ fontSize: "10px", fontWeight: 500 }}>Search</span>
          </button>
          {/* Cart — with red dot badge */}
          <button
            onClick={() => navigate("/cart")}
            className="flex flex-col items-center justify-center"
            style={{ gap: "4px", ...navIcon("#44474C") }}
          >
            <span className="relative flex items-center justify-center">
              <ShoppingCart size={20} />
              {cartCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-2px",
                    right: "-3px",
                    width: "8px",
                    height: "8px",
                    background: "#A43B31",
                    borderRadius: "9999px",
                  }}
                />
              )}
            </span>
            <span style={{ fontSize: "10px", fontWeight: 500 }}>Cart</span>
          </button>
          {/* Wishlist */}
          <button
            onClick={() => navigate("/wishlist")}
            className="flex flex-col items-center justify-center"
            style={{ gap: "4px", ...navIcon("#44474C") }}
          >
            <HeartIcon size={20} />
            <span style={{ fontSize: "10px", fontWeight: 500 }}>Wishlist</span>
          </button>
          {/* Profile */}
          <button
            onClick={() => navigate("/myprofile")}
            className="flex flex-col items-center justify-center"
            style={{ gap: "4px", ...navIcon("#44474C") }}
          >
            <UserIcon size={20} />
            <span style={{ fontSize: "10px", fontWeight: 500 }}>Profile</span>
          </button>
        </nav>

        {/* ── FILTER BOTTOM SHEET (all desktop filter operations) ── */}
        <div
          className={`mobile-bottom-sheet-backdrop ${mobileFilterOpen ? "open" : ""}`}
          onClick={() => setMobileFilterOpen(false)}
        />
        <div
          className={`mobile-bottom-sheet ${mobileFilterOpen ? "open" : ""}`}
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          <div className="mobile-bottom-sheet-handle" />
          <button
            onClick={() => setMobileFilterOpen(false)}
            aria-label="Close filters"
            className="absolute flex items-center justify-center"
            style={{
              top: "12px",
              right: "16px",
              width: "32px",
              height: "32px",
              color: "#74777D",
              fontSize: "18px",
              zIndex: 2,
            }}
          >
            ✕
          </button>
          <div className="px-6 pb-8 pt-2">
            <FiltersSidebar
              categories={categories}
              selectedCategories={selectedCategories}
              setSelectedCategories={setSelectedCategories}
              setMinPrice={setMinPrice}
              minPrice={minPrice}
              maxPrice={maxPriceValue}
              setMinRating={setMinRating}
              setSort={setSort}
              clearFilters={clearFilters}
              search={search}
              setSearch={setSearch}
            />
            <button
              onClick={() => setMobileFilterOpen(false)}
              className="w-full flex items-center justify-center"
              style={{
                marginTop: "24px",
                height: "48px",
                background: "#A43B31",
                color: "#fff",
                borderRadius: "9999px",
                fontWeight: 700,
                fontSize: "15px",
              }}
            >
              Show {filteredProducts.length} Results
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ============================================================
       DESKTOP / WEB LAYOUT (new design — scaled to match html.png)
    ============================================================ */
  return (
    <div
      className="min-h-screen flex"
      style={{ background: "#FCF9F8", fontFamily: "Inter, sans-serif" }}
    >
      {/* ===================== SIDEBAR ===================== */}
      <aside
        ref={sidebarRef}
        className="hidden lg:flex flex-col flex-shrink-0 sticky top-[88px] self-start overflow-y-auto no-scrollbar"
        style={{
          width: "256px",
          height: "calc(100vh - 88px)",
          background: "#F6F3F2",
          borderRight: "1px solid #E4E2E1",
          padding: "16px",
        }}
      >
        {/* Top section */}
        <h2 className="font-black text-[#1B1C1C]" style={{ fontSize: "18px" }}>
          Categories
        </h2>
        <p
          className="font-semibold text-[#44474C] opacity-70 mb-4"
          style={{ fontSize: "13px" }}
        >
          Browse by department
        </p>

        {/* Search filter */}
        <div className="relative mb-5">
          <Filter
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "#74777D" }}
          />
          <input
            type="text"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Search Filter..."
            className="w-full outline-none bg-white border border-[#C3C7C8] rounded-lg text-[13px] text-[#1B1C1C]"
            style={{ padding: "8px 12px 9px 32px" }}
          />
        </div>

        {/* DEPARTMENT */}
        <div className="mb-5">
          <SectionLabel>Department</SectionLabel>
          {displayedDepartments.length ? (
            displayedDepartments.map((cat) => (
              <CheckRow
                key={cat}
                checked={selectedDepartments.includes(cat)}
                onChange={() => toggleDepartment(cat)}
                count={categoryCounts[cat] || 0}
              >
                {toTitleCase(cat)}
              </CheckRow>
            ))
          ) : (
            <p className="text-[12px] text-[#44474C] opacity-60">
              No departments
            </p>
          )}
        </div>

        {/* PRICE RANGE */}
        <div className="mb-5">
          <SectionLabel>Price Range</SectionLabel>
          <input
            type="range"
            min={0}
            max={5000}
            value={priceMax === "" ? 5000 : Number(priceMax)}
            onChange={(e) => setPriceMax(e.target.value)}
            className="w-full mb-3 accent-[#1B1C1C]"
            style={{ height: "4px" }}
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
              placeholder="Min"
              className="outline-none bg-white border border-[#C3C7C8] rounded text-[13px] text-[#1B1C1C] px-2 py-1.5"
              style={{ width: "103.5px" }}
            />
            <input
              type="number"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
              placeholder="Max"
              className="outline-none bg-white border border-[#C3C7C8] rounded text-[13px] text-[#1B1C1C] px-2 py-1.5"
              style={{ width: "103.5px" }}
            />
          </div>
        </div>

        {/* CUSTOMER RATING */}
        <div className="mb-5">
          <SectionLabel>Customer Rating</SectionLabel>
          {[4, 3].map((t) => (
            <CheckRow
              key={t}
              checked={ratingThresholds.includes(t)}
              onChange={() => toggleRating(t)}
            >
              <span className="flex items-center gap-1">
                {t}
                <Star
                  size={13}
                  style={{ color: "#A43B31" }}
                  fill="#A43B31"
                  strokeWidth={0}
                />
                &amp; Above
              </span>
            </CheckRow>
          ))}
        </div>

        {/* AVAILABILITY */}
        <div className="mb-5">
          <SectionLabel>Availability</SectionLabel>
          <CheckRow
            checked={availability.includes("inStock")}
            onChange={() => toggleAvailability("inStock")}
          >
            In Stock
          </CheckRow>
          <CheckRow
            checked={availability.includes("lowStock")}
            onChange={() => toggleAvailability("lowStock")}
          >
            Low Stock
          </CheckRow>
        </div>

        {/* Bottom buttons */}
        <div className="mt-auto pt-4 space-y-2">
          <button
            onClick={applyFilters}
            className="w-full rounded-lg font-semibold text-white text-[14px]"
            style={{ background: "#1B1C1C", height: "38px" }}
          >
            Apply Filters
          </button>
          <button
            onClick={clearAllFilters}
            className="w-full flex items-center justify-center gap-2 font-semibold text-[#44474C] text-[14px]"
            style={{ height: "38px" }}
          >
            <X size={15} />
            Clear All Filters
          </button>
        </div>
      </aside>

      {/* ===================== MAIN ===================== */}
      <main className="flex-1 min-w-0 px-5 lg:px-8 py-6">
        {/* Summary section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
          <div>
            <h1
              className="font-bold text-[#1B1C1C]"
              style={{ fontSize: "26px" }}
            >
              Discover Everything
            </h1>
            <p className="text-[#44474C]" style={{ fontSize: "14px" }}>
              Explore our curated collection of luxury and essentials.
            </p>
          </div>
          {/* Dark stats card */}
          <div
            className="flex items-center gap-5 rounded-xl text-white flex-shrink-0"
            style={{ background: "#1B1C1C", padding: "12px 24px" }}
          >
            <div>
              <div className="font-black" style={{ fontSize: "26px" }}>
                {totalProductCount}
              </div>
              <div
                className="uppercase opacity-80"
                style={{ fontSize: "11px", letterSpacing: "1.2px" }}
              >
                Products Available
              </div>
            </div>
            <div className="w-px self-stretch bg-white opacity-20" />
            <Store size={24} className="text-white opacity-40" />
          </div>
        </div>

        {/* Category chips */}
        <div
          ref={chipsRef}
          className="flex items-center gap-2 overflow-x-auto pb-2 mb-5 no-scrollbar"
        >
          <button
            onClick={() => setActiveChip("all")}
            className="cat-chip flex-shrink-0 rounded-full font-semibold px-3 py-1.5 text-[13px]"
            style={
              activeChip === "all"
                ? { background: "#A43B31", color: "#FFFFFF" }
                : {
                    background: "#EAE7E7",
                    border: "1px solid #C3C7C8",
                    color: "#44474C",
                  }
            }
          >
            All Categories
          </button>
          {categories.filter(Boolean).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveChip(cat)}
              className="cat-chip flex-shrink-0 rounded-full font-semibold px-3 py-1.5 text-[13px] whitespace-nowrap"
              style={
                activeChip === cat
                  ? { background: "#A43B31", color: "#FFFFFF" }
                  : {
                      background: "#EAE7E7",
                      border: "1px solid #C3C7C8",
                      color: "#44474C",
                    }
              }
            >
              {toTitleCase(cat)}{" "}
              <span className="opacity-60">{categoryCounts[cat] || 0}</span>
            </button>
          ))}
        </div>

        {/* Control bar */}
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <SearchIcon
              size={17}
              className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "#74777D" }}
            />
            <input
              type="text"
              value={deskSearch}
              onChange={(e) => setDeskSearch(e.target.value)}
              placeholder="Search products by name..."
              className="w-full outline-none bg-white border border-[#C3C7C8] rounded-xl text-[14px] text-[#1B1C1C]"
              style={{ height: "46px", padding: "12px 16px 12px 44px" }}
            />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[13px] text-[#44474C] font-medium">
              Sort By:
            </span>
            <select
              value={deskSort}
              onChange={(e) => setDeskSort(e.target.value)}
              className="outline-none bg-white border border-[#C3C7C8] rounded-xl text-[14px] text-[#1B1C1C] px-3"
              style={{ height: "46px" }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Product sections */}
        <div ref={gridRef}>
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-[#F6F3F2] animate-pulse"
                  style={{ height: "330px" }}
                />
              ))}
            </div>
          ) : Object.keys(desktopGrouped).length === 0 ? (
            <div className="h-[40vh] flex flex-col items-center justify-center gap-4">
              <p className="text-[#44474C] opacity-70 text-[14px]">
                No products match your filters.
              </p>
              <button
                onClick={clearAllFilters}
                className="text-[#865300] font-bold text-[13px]"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            Object.keys(desktopGrouped).map((category) => (
              <section key={category} className="mb-10">
                {/* Category header */}
                <div
                  className="flex items-center justify-between pb-3 mb-5"
                  style={{ borderBottom: "1px solid #E4E2E1" }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex items-center justify-center rounded-full"
                      style={{
                        width: "34px",
                        height: "34px",
                        background: "rgba(24,31,33,0.1)",
                      }}
                    >
                      <LayoutGrid size={17} style={{ color: "#1B1C1C" }} />
                    </span>
                    <h2
                      className="font-bold text-[#1B1C1C]"
                      style={{ fontSize: "19px" }}
                    >
                      {toTitleCase(category)}
                    </h2>
                    <span
                      className="text-[#44474C] opacity-60"
                      style={{ fontSize: "14px" }}
                    >
                      (
                      {categoryCounts[category] ||
                        desktopGrouped[category].length}{" "}
                      Products)
                    </span>
                  </div>
                  <button
                    onClick={() => setActiveChip(category)}
                    className="flex items-center gap-1 font-bold text-[13px]"
                    style={{ color: "#865300" }}
                  >
                    View All <ChevronRight size={15} />
                  </button>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                  {desktopGrouped[category].map((product) => (
                    <NewProductCard
                      key={product.id}
                      product={product}
                      onAddToCart={handleAddToCart}
                      onDecrement={handleDecrement}
                      onToggleWishlist={handleToggleWishlist}
                      isWishlisted={isWishlisted(product.id)}
                      quantity={cartQty(product.id)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {/* Load more */}
        {!loading && desktopVisible.length < desktopFiltered.length && (
          <div className="flex flex-col items-center gap-2 mt-6">
            <button
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="flex items-center gap-2 rounded-xl font-bold text-[14px] text-[#1B1C1C] px-5"
              style={{
                background: "#E4E2E1",
                border: "1px solid #C3C7C8",
                height: "44px",
              }}
            >
              <RefreshCw size={16} />
              Load More Products
            </button>
            <p className="text-[#44474C] opacity-60 text-[12px]">
              Showing {desktopVisible.length} of {desktopFiltered.length}{" "}
              products
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default memo(ProductsPage);
