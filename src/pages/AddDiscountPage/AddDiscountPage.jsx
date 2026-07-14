import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  writeBatch,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import { fireDB } from "../../context/FirebaseConfig";
import {
  ArrowLeft,
  Check,
  Sparkles,
  AlertCircle,
  ShoppingBag,
  FolderOpen,
  Search,
  Percent,
  Ticket,
  Trash2,
  Calendar,
  Heart,
  ShoppingCart,
} from "lucide-react";

const AddDiscountPage = () => {
  const navigate = useNavigate();

  // Core Data State
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wishlistCounts, setWishlistCounts] = useState({});
  const [cartCounts, setCartCounts] = useState({});

  // Promo Codes State
  const [promoCodes, setPromoCodes] = useState([]);
  const [newPromoCode, setNewPromoCode] = useState("");
  const [newPromoDiscount, setNewPromoDiscount] = useState("");
  const [newPromoExpiry, setNewPromoExpiry] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);

  // Form State
  const [discountVal, setDiscountVal] = useState("");
  const [expiryVal, setExpiryVal] = useState("");
  const [selectionMode, setSelectionMode] = useState("all"); // 'all' | 'category' | 'individual' | 'wishlist' | 'cart'
  
  // Selection Targets
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState(new Set());
  
  // Filter/Search for Individual List
  const [searchQuery, setSearchQuery] = useState("");


  const loadPromoCodes = async () => {
    try {
      const snap = await getDocs(collection(fireDB, "promoCodes"));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPromoCodes(list);
    } catch (error) {
      console.error("Error loading promo codes:", error);
    }
  };

  // Load products, categories, wishlists, and carts
  const loadData = async () => {
    try {
      setLoading(true);
      const snap = await getDocs(collection(fireDB, "products"));
      const fetched = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setProducts(fetched);

      // Extract distinct categories
      const distinct = Array.from(
        new Set(fetched.map((p) => p.category).filter(Boolean))
      ).sort();
      setCategories(distinct);
      if (distinct.length > 0) {
        setSelectedCategory(distinct[0]);
      }

      // Fetch wishlists and aggregate
      const wishlistCountsMap = {};
      try {
        const wishlistSnap = await getDocs(collection(fireDB, "wishlists"));
        wishlistSnap.docs.forEach((doc) => {
          const data = doc.data();
          const pId = data.productId;
          const uId = data.userId;
          if (pId && uId) {
            if (!wishlistCountsMap[pId]) {
              wishlistCountsMap[pId] = new Set();
            }
            wishlistCountsMap[pId].add(uId);
          }
        });
      } catch (error) {
        console.error("Error loading wishlists:", error);
      }
      const wishlistCountsFinal = {};
      Object.keys(wishlistCountsMap).forEach((pId) => {
        wishlistCountsFinal[pId] = wishlistCountsMap[pId].size;
      });
      setWishlistCounts(wishlistCountsFinal);

      // Fetch carts and aggregate
      const cartCountsMap = {};
      try {
        const cartSnap = await getDocs(collection(fireDB, "carts"));
        cartSnap.docs.forEach((doc) => {
          const data = doc.data();
          const items = data.items || [];
          const uId = doc.id; // Cart document ID is the userId
          if (Array.isArray(items)) {
            items.forEach((item) => {
              const pId = item.productId;
              if (pId && uId) {
                if (!cartCountsMap[pId]) {
                  cartCountsMap[pId] = new Set();
                }
                cartCountsMap[pId].add(uId);
              }
            });
          }
        });
      } catch (error) {
        console.error("Error loading carts:", error);
      }
      const cartCountsFinal = {};
      Object.keys(cartCountsMap).forEach((pId) => {
        cartCountsFinal[pId] = cartCountsMap[pId].size;
      });
      setCartCounts(cartCountsFinal);

      // Load promo codes
      await loadPromoCodes();
    } catch (error) {
      console.error("Error loading products for discounts:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Compute selected products based on selection mode
  const getSelectedProducts = () => {
    if (selectionMode === "all") {
      return products;
    } else if (selectionMode === "category") {
      return products.filter((p) => p.category === selectedCategory);
    } else {
      return products.filter((p) => selectedProductIds.has(p.id));
    }
  };

  // Toggle individual product selection
  const handleToggleProduct = (id) => {
    const updated = new Set(selectedProductIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedProductIds(updated);
  };

  // Get wishlisted products ordered by user count descending
  const getWishlistedProducts = () => {
    return products
      .filter((p) => (wishlistCounts[p.id] || 0) > 0)
      .map((p) => ({ ...p, userCount: wishlistCounts[p.id] || 0 }))
      .sort((a, b) => b.userCount - a.userCount);
  };

  // Get carted products ordered by user count descending
  const getCartedProducts = () => {
    return products
      .filter((p) => (cartCounts[p.id] || 0) > 0)
      .map((p) => ({ ...p, userCount: cartCounts[p.id] || 0 }))
      .sort((a, b) => b.userCount - a.userCount);
  };

  // Filter products for the individual selection view
  const getFilteredProducts = () => {
    return products.filter(
      (p) =>
        p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  // Filter wishlisted products for the wishlist selection view
  const getFilteredWishlistedProducts = () => {
    return getWishlistedProducts().filter(
      (p) =>
        p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  // Filter carted products for the cart selection view
  const getFilteredCartedProducts = () => {
    return getCartedProducts().filter(
      (p) =>
        p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  // Select all products in the current view
  const handleSelectAll = () => {
    let targets = [];
    if (selectionMode === "individual") {
      targets = getFilteredProducts();
    } else if (selectionMode === "wishlist") {
      targets = getFilteredWishlistedProducts();
    } else if (selectionMode === "cart") {
      targets = getFilteredCartedProducts();
    }
    const updated = new Set(selectedProductIds);
    targets.forEach((p) => updated.add(p.id));
    setSelectedProductIds(updated);
  };

  // Deselect all products in the current view
  const handleDeselectAll = () => {
    let targets = [];
    if (selectionMode === "individual") {
      targets = getFilteredProducts();
    } else if (selectionMode === "wishlist") {
      targets = getFilteredWishlistedProducts();
    } else if (selectionMode === "cart") {
      targets = getFilteredCartedProducts();
    }
    const updated = new Set(selectedProductIds);
    targets.forEach((p) => updated.delete(p.id));
    setSelectedProductIds(updated);
  };

  // Submit bulk discount updates
  const handleApplyDiscount = async () => {
    const pct = Number(discountVal);
    if (isNaN(pct) || pct < 0 || pct > 100 || discountVal === "") {
      alert("Please enter a valid discount percentage between 0 and 100.");
      return;
    }

    if (!expiryVal) {
      alert("Please specify a valid expiration date and time.");
      return;
    }

    const targets = getSelectedProducts();
    if (targets.length === 0) {
      alert("No products are currently selected. Adjust selection criteria.");
      return;
    }

    if (
      !window.confirm(
        `Are you sure you want to apply a ${pct}% discount (ends: ${new Date(
          expiryVal
        ).toLocaleString()}) to ${targets.length} product(s)?`
      )
    ) {
      return;
    }

    try {
      setSaving(true);

      // Create a lookup map for targets to update carts efficiently
      const updateMap = {};
      targets.forEach((t) => {
        updateMap[t.id] = {
          discount: pct,
          discountExpiry: expiryVal,
        };
      });

      // 1. Bulk update products using Firestore batches
      const batch = writeBatch(fireDB);
      targets.forEach((p) => {
        const docRef = doc(fireDB, "products", p.id);
        batch.update(docRef, {
          discount: pct,
          discountExpiry: expiryVal,
        });
      });
      await batch.commit();

      // 2. Bulk update user carts containing the targeted products
      const cartsSnapshot = await getDocs(collection(fireDB, "carts"));
      for (const cartDoc of cartsSnapshot.docs) {
        const cartData = cartDoc.data();
        if (!cartData.items || !Array.isArray(cartData.items)) continue;

        let changed = false;
        const updatedItems = cartData.items.map((item) => {
          const update = updateMap[item.productId];
          if (update) {
            changed = true;
            return {
              ...item,
              discount: update.discount,
              discountExpiry: update.discountExpiry,
            };
          }
          return item;
        });

        if (changed) {
          await updateDoc(cartDoc.ref, { items: updatedItems });
        }
      }

      alert(`Successfully applied bulk discount to ${targets.length} product(s)!`);
      
      // Reset form fields
      setDiscountVal("");
      setExpiryVal("");
      setSelectedProductIds(new Set());
      
      // Reload product list
      await loadData();

    } catch (error) {
      console.error("Bulk discount error:", error);
      alert("An error occurred while applying bulk discount.");
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePromo = async () => {
    const code = newPromoCode.trim().toUpperCase();
    const pct = Number(newPromoDiscount);
    if (!code) {
      alert("Please enter a coupon code.");
      return;
    }
    if (isNaN(pct) || pct <= 0 || pct > 100 || newPromoDiscount === "") {
      alert("Please enter a valid discount percentage between 1 and 100.");
      return;
    }
    if (!newPromoExpiry) {
      alert("Please specify a valid expiration date and time.");
      return;
    }

    try {
      setPromoLoading(true);
      const promoRef = doc(fireDB, "promoCodes", code);
      await setDoc(promoRef, {
        code: code,
        type: "percent",
        value: pct,
        expiryDate: newPromoExpiry,
        createdAt: new Date().toISOString(),
      });
      alert(`Coupon "${code}" generated successfully!`);
      setNewPromoCode("");
      setNewPromoDiscount("");
      setNewPromoExpiry("");
      await loadPromoCodes();
    } catch (error) {
      console.error("Error creating promo code:", error);
      alert("An error occurred while creating the promo code.");
    } finally {
      setPromoLoading(false);
    }
  };

  const handleDeletePromo = async (code) => {
    if (!window.confirm(`Are you sure you want to delete the coupon "${code}"?`)) {
      return;
    }
    try {
      setPromoLoading(true);
      const promoRef = doc(fireDB, "promoCodes", code);
      await deleteDoc(promoRef);
      alert(`Coupon "${code}" deleted successfully.`);
      await loadPromoCodes();
    } catch (error) {
      console.error("Error deleting promo code:", error);
      alert("An error occurred while deleting the promo code.");
    } finally {
      setPromoLoading(false);
    }
  };

  const selectedTargetsCount = getSelectedProducts().length;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FBF9F8] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-amber-600"></div>
          <span className="text-sm font-medium text-neutral-600">Loading products & categories...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FBF9F8] py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-4xl mx-auto">
        {/* Header Navigation */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate("/admin/testing")}
            className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900 transition-colors font-medium text-sm"
          >
            <ArrowLeft size={16} /> Back to Dashboard
          </button>
          <span className="px-3 py-1 bg-amber-50 text-amber-700 text-xs font-semibold rounded-full border border-amber-200 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles size={12} /> Bulk Promotions Panel
          </span>
        </div>

        {/* Dashboard Title Card */}
        <div className="bg-gradient-to-r from-amber-600 via-amber-700 to-orange-600 rounded-3xl p-8 text-white shadow-xl mb-8 relative overflow-hidden">
          <div className="absolute -right-16 -top-16 w-48 h-48 rounded-full bg-white opacity-5 blur-xl"></div>
          <div className="absolute -left-16 -bottom-16 w-48 h-48 rounded-full bg-orange-300 opacity-10 blur-xl"></div>
          <div className="relative z-10">
            <h1 className="text-3xl font-extrabold tracking-tight">Bulk Discount Manager</h1>
            <p className="mt-2 text-amber-100 max-w-xl text-sm md:text-base">
              Apply discount promotions to products, category-wide, or to the entire inventory instantly. Set a timer and the offers revert to standard MRP upon expiration.
            </p>
          </div>
        </div>

        {/* Main Controls Card */}
        <div className="bg-white rounded-3xl border border-neutral-200/80 shadow-[0_10px_30px_rgba(0,0,0,0.02)] overflow-hidden">
          <div className="p-6 md:p-8 space-y-6">
            
            {/* Step 1: Selection Mode */}
            <div>
              <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-3">
                1. Select Products Criteria
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 p-1.5 bg-neutral-100 rounded-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setSelectionMode("all");
                    setSelectedProductIds(new Set());
                    setSearchQuery("");
                  }}
                  className={`py-3 px-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                    selectionMode === "all"
                      ? "bg-white text-amber-700 shadow-md"
                      : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50"
                  }`}
                >
                  <ShoppingBag size={15} /> All Products
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectionMode("category");
                    setSelectedProductIds(new Set());
                    setSearchQuery("");
                  }}
                  className={`py-3 px-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                    selectionMode === "category"
                      ? "bg-white text-amber-700 shadow-md"
                      : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50"
                  }`}
                >
                  <FolderOpen size={15} /> By Category
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectionMode("individual");
                    setSelectedProductIds(new Set());
                    setSearchQuery("");
                  }}
                  className={`py-3 px-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                    selectionMode === "individual"
                      ? "bg-white text-amber-700 shadow-md"
                      : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50"
                  }`}
                >
                  <Search size={15} /> Individual
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectionMode("wishlist");
                    setSelectedProductIds(new Set());
                    setSearchQuery("");
                  }}
                  className={`py-3 px-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                    selectionMode === "wishlist"
                      ? "bg-white text-amber-700 shadow-md"
                      : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50"
                  }`}
                >
                  <Heart size={15} /> Wishlist
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectionMode("cart");
                    setSelectedProductIds(new Set());
                    setSearchQuery("");
                  }}
                  className={`py-3 px-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                    selectionMode === "cart"
                      ? "bg-white text-amber-700 shadow-md"
                      : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50"
                  }`}
                >
                  <ShoppingCart size={15} /> Cart
                </button>
              </div>
            </div>

            {/* Dynamic selectors based on mode */}
            {selectionMode === "category" && (
              <div className="p-5 bg-neutral-50 rounded-2xl border border-neutral-100 animate-fadeIn">
                <label className="block text-sm font-semibold text-neutral-700 mb-2">
                  Select Product Category
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-medium text-neutral-800 bg-white"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectionMode === "individual" && (
              <div className="p-5 bg-neutral-50 rounded-2xl border border-neutral-100 space-y-4 animate-fadeIn">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-400">
                      <Search size={16} />
                    </span>
                    <input
                      type="text"
                      placeholder="Search product title or category..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-11 pl-10 pr-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm font-medium"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="px-4 py-2 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 rounded-lg transition-colors"
                    >
                      Select Page
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="px-4 py-2 text-xs font-bold text-neutral-600 bg-white hover:bg-neutral-100 border border-neutral-300 rounded-lg transition-colors"
                    >
                      Deselect Page
                    </button>
                  </div>
                </div>

                {/* Products check-list */}
                <div className="max-h-60 overflow-y-auto border border-neutral-200 rounded-xl bg-white divide-y divide-neutral-100">
                  {getFilteredProducts().length === 0 ? (
                    <div className="p-8 text-center text-sm text-neutral-500">
                      No matching products found.
                    </div>
                  ) : (
                    getFilteredProducts().map((p) => {
                      const isChecked = selectedProductIds.has(p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => handleToggleProduct(p.id)}
                          className="flex items-center px-4 py-3 hover:bg-neutral-50/50 cursor-pointer select-none transition-colors"
                        >
                          <div className="flex items-center h-5 mr-3.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              readOnly
                              className="h-4 w-4 rounded border-neutral-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                            />
                          </div>
                          {(p.thumbnail || p.image) && (
                            <img
                              src={p.thumbnail || p.image}
                              alt=""
                              className="w-8 h-8 rounded object-cover mr-3 bg-neutral-100 flex-shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-neutral-800 truncate">
                              {p.title}
                            </span>
                            <span className="block text-[11px] text-neutral-400 capitalize">
                              {p.category} • ₹{Number(p.price || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {selectionMode === "wishlist" && (
              <div className="p-5 bg-neutral-50 rounded-2xl border border-neutral-100 space-y-4 animate-fadeIn">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-400">
                      <Search size={16} />
                    </span>
                    <input
                      type="text"
                      placeholder="Search wishlisted product title or category..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-11 pl-10 pr-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm font-medium"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="px-4 py-2 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 rounded-lg transition-colors"
                    >
                      Select Page
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="px-4 py-2 text-xs font-bold text-neutral-600 bg-white hover:bg-neutral-100 border border-neutral-300 rounded-lg transition-colors"
                    >
                      Deselect Page
                    </button>
                  </div>
                </div>

                {/* Wishlisted Products check-list */}
                <div className="max-h-60 overflow-y-auto border border-neutral-200 rounded-xl bg-white divide-y divide-neutral-100">
                  {getFilteredWishlistedProducts().length === 0 ? (
                    <div className="p-8 text-center text-sm text-neutral-500">
                      No matching wishlisted products found.
                    </div>
                  ) : (
                    getFilteredWishlistedProducts().map((p) => {
                      const isChecked = selectedProductIds.has(p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => handleToggleProduct(p.id)}
                          className="flex items-center px-4 py-3 hover:bg-neutral-50/50 cursor-pointer select-none transition-colors"
                        >
                          <div className="flex items-center h-5 mr-3.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              readOnly
                              className="h-4 w-4 rounded border-neutral-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                            />
                          </div>
                          {(p.thumbnail || p.image) && (
                            <img
                              src={p.thumbnail || p.image}
                              alt=""
                              className="w-8 h-8 rounded object-cover mr-3 bg-neutral-100 flex-shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-neutral-800 truncate">
                              {p.title}
                            </span>
                            <div className="flex flex-wrap items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-neutral-400 capitalize flex-shrink-0">
                                {p.category} • ₹{Number(p.price || 0).toFixed(2)}
                              </span>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold border border-rose-100/50">
                                <Heart size={10} className="fill-rose-700" /> Wishlisted by {p.userCount} {p.userCount === 1 ? 'user' : 'users'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {selectionMode === "cart" && (
              <div className="p-5 bg-neutral-50 rounded-2xl border border-neutral-100 space-y-4 animate-fadeIn">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-400">
                      <Search size={16} />
                    </span>
                    <input
                      type="text"
                      placeholder="Search carted product title or category..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-11 pl-10 pr-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm font-medium"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="px-4 py-2 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 rounded-lg transition-colors"
                    >
                      Select Page
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="px-4 py-2 text-xs font-bold text-neutral-600 bg-white hover:bg-neutral-100 border border-neutral-300 rounded-lg transition-colors"
                    >
                      Deselect Page
                    </button>
                  </div>
                </div>

                {/* Carted Products check-list */}
                <div className="max-h-60 overflow-y-auto border border-neutral-200 rounded-xl bg-white divide-y divide-neutral-100">
                  {getFilteredCartedProducts().length === 0 ? (
                    <div className="p-8 text-center text-sm text-neutral-500">
                      No matching carted products found.
                    </div>
                  ) : (
                    getFilteredCartedProducts().map((p) => {
                      const isChecked = selectedProductIds.has(p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => handleToggleProduct(p.id)}
                          className="flex items-center px-4 py-3 hover:bg-neutral-50/50 cursor-pointer select-none transition-colors"
                        >
                          <div className="flex items-center h-5 mr-3.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              readOnly
                              className="h-4 w-4 rounded border-neutral-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                            />
                          </div>
                          {(p.thumbnail || p.image) && (
                            <img
                              src={p.thumbnail || p.image}
                              alt=""
                              className="w-8 h-8 rounded object-cover mr-3 bg-neutral-100 flex-shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-neutral-800 truncate">
                              {p.title}
                            </span>
                            <div className="flex flex-wrap items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-neutral-400 capitalize flex-shrink-0">
                                {p.category} • ₹{Number(p.price || 0).toFixed(2)}
                              </span>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100/50">
                                <ShoppingCart size={10} /> In cart for {p.userCount} {p.userCount === 1 ? 'user' : 'users'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Discount Parameters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2.5">
                  2. Discount Value (%)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-500">
                    <Percent size={16} />
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={discountVal}
                    onChange={(e) => setDiscountVal(e.target.value)}
                    placeholder="e.g. 15"
                    className="w-full h-12 pl-10 pr-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2.5">
                  3. Expiration Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={expiryVal}
                  onChange={(e) => setExpiryVal(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                />
              </div>
            </div>

            {/* Step 3: Summary / Confirmation */}
            <div className="p-5 rounded-2xl bg-amber-50 border border-amber-100 flex items-start gap-3">
              <AlertCircle className="text-amber-600 flex-shrink-0 mt-0.5" size={18} />
              <div className="text-sm">
                <h4 className="font-bold text-amber-800">Target Summary</h4>
                <p className="mt-1 text-amber-700 leading-relaxed font-medium">
                  {selectionMode === "all" && (
                    <span>Applying bulk discount to <strong>all products</strong> in the database.</span>
                  )}
                  {selectionMode === "category" && (
                    <span>
                      Applying bulk discount to all products in category: <strong>{selectedCategory || "none"}</strong>.
                    </span>
                  )}
                  {selectionMode === "individual" && (
                    <span>
                      Applying bulk discount to <strong>{selectedProductIds.size}</strong> individually selected product(s).
                    </span>
                  )}
                  {selectionMode === "wishlist" && (
                    <span>
                      Applying bulk discount to <strong>{selectedProductIds.size}</strong> selected wishlisted product(s).
                    </span>
                  )}
                  {selectionMode === "cart" && (
                    <span>
                      Applying bulk discount to <strong>{selectedProductIds.size}</strong> selected carted product(s).
                    </span>
                  )}
                  {discountVal && expiryVal ? (
                    <span> This will apply a promotion of <strong>{discountVal}%</strong> until <strong>{new Date(expiryVal).toLocaleString()}</strong>. A total of <strong>{selectedTargetsCount}</strong> product(s) will be updated.</span>
                  ) : (
                    <span> Please enter a discount percentage and expiry date to compute promotion details.</span>
                  )}
                </p>
              </div>
            </div>

            {/* Form actions */}
            <div className="flex gap-4 pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={handleApplyDiscount}
                disabled={saving || selectedTargetsCount === 0}
                className={`flex-1 h-14 rounded-2xl font-bold text-white text-base tracking-wide flex items-center justify-center gap-2 shadow-lg transition-all ${
                  saving || selectedTargetsCount === 0
                    ? "bg-neutral-300 text-neutral-500 cursor-not-allowed shadow-none"
                    : "bg-amber-600 hover:bg-amber-700 hover:shadow-amber-500/10 active:scale-[0.99] cursor-pointer"
                }`}
              >
                {saving ? "Applying Bulk Updates..." : `Apply Promotion to ${selectedTargetsCount} Product(s)`}
              </button>
              <button
                type="button"
                onClick={() => navigate("/admin/testing")}
                className="w-32 h-14 bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 rounded-2xl font-bold text-neutral-700 transition-all text-sm flex items-center justify-center"
              >
                Cancel
              </button>
            </div>

          </div>
        </div>

        {/* Coupons / Promo Codes Manager */}
        <div className="bg-white rounded-3xl border border-neutral-200/80 shadow-[0_10px_30px_rgba(0,0,0,0.02)] overflow-hidden mt-8">
          <div className="p-6 md:p-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2">
                <Ticket className="text-amber-600" size={20} /> Promo Codes & Coupons Manager
              </h2>
              <p className="text-neutral-500 text-sm mt-1">
                Create coupon codes that apply a percentage discount on the user's overall order value. Set an expiration timer; manually deleting a coupon invalidates it immediately.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2.5">
                  Coupon Code
                </label>
                <input
                  type="text"
                  value={newPromoCode}
                  onChange={(e) => setNewPromoCode(e.target.value.toUpperCase())}
                  placeholder="e.g. WELCOME"
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-semibold uppercase tracking-wider"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2.5">
                  Discount (%)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-500">
                    <Percent size={16} />
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={newPromoDiscount}
                    onChange={(e) => setNewPromoDiscount(e.target.value)}
                    placeholder="e.g. 20"
                    className="w-full h-12 pl-10 pr-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-neutral-800 uppercase tracking-wider mb-2.5">
                  Expiration Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={newPromoExpiry}
                  onChange={(e) => setNewPromoExpiry(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-base font-medium"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleGeneratePromo}
                disabled={promoLoading}
                className={`w-full md:w-auto px-8 h-12 rounded-xl font-bold text-white text-sm tracking-wide flex items-center justify-center gap-2 shadow-md transition-all ${
                  promoLoading
                    ? "bg-neutral-300 text-neutral-500 cursor-not-allowed shadow-none"
                    : "bg-amber-600 hover:bg-amber-700 active:scale-[0.99] cursor-pointer"
                }`}
              >
                {promoLoading ? "Generating..." : "Generate Coupon"}
              </button>
            </div>

            {/* Coupons List */}
            <div className="pt-6 border-t border-neutral-100">
              <h3 className="text-base font-bold text-neutral-800 mb-4 flex items-center gap-2">
                Active Coupons ({promoCodes.length})
              </h3>
              
              {promoCodes.length === 0 ? (
                <div className="p-8 text-center text-sm text-neutral-400 border border-dashed border-neutral-200 rounded-2xl bg-neutral-50/50">
                  No coupons found in the system.
                </div>
              ) : (
                <div className="overflow-x-auto border border-neutral-200 rounded-2xl bg-white">
                  <table className="w-full border-collapse text-left text-sm text-neutral-600">
                    <thead className="bg-neutral-50 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                      <tr>
                        <th className="px-6 py-4">Code</th>
                        <th className="px-6 py-4">Discount</th>
                        <th className="px-6 py-4">Expiration</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200">
                      {promoCodes.map((promo) => {
                        const isExpired = new Date(promo.expiryDate).getTime() < Date.now();
                        return (
                          <tr key={promo.id} className="hover:bg-neutral-50/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-neutral-900 tracking-wider">
                              {promo.code}
                            </td>
                            <td className="px-6 py-4 font-semibold text-neutral-800">
                              {promo.value}% OFF
                            </td>
                            <td className="px-6 py-4 text-neutral-500">
                              {new Date(promo.expiryDate).toLocaleString()}
                            </td>
                            <td className="px-6 py-4">
                              {isExpired ? (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                                  Expired
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 animate-pulse">
                                  Active
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
                                type="button"
                                onClick={() => handleDeletePromo(promo.code)}
                                disabled={promoLoading}
                                className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                title="Delete Coupon"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AddDiscountPage;