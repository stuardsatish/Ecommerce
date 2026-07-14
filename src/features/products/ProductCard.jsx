import React, { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useDispatch, useSelector } from "react-redux"

import { addCart, removeCart } from "../../context/CartSlice"
import { addWishlist, removeWishlist } from "../../context/WishlistSlice"

import { auth, fireDB } from "../../context/FirebaseConfig"

import {
    doc,
    setDoc,
    deleteDoc,
    serverTimestamp,
    collection,
    getDocs,
    query,
    where
} from "firebase/firestore"

import { FaHeart, FaRegHeart } from "react-icons/fa"

export const ProductCard = ({ product, variant = "desktop" }) => {

    const navigate = useNavigate()
    const dispatch = useDispatch()

    const cartItems = useSelector((state) => state.cart.cartItems)
    const wishlistItems = useSelector((state) => state.wishlist.wishlistItems)

    const [avgRating, setAvgRating] = useState(0)
    const [reviewCount, setReviewCount] = useState(0)

    const productId = String(product.id)



    const stock = product.stock || 0

    const isOutOfStock = stock <= 0

    const isWishlisted = wishlistItems.some(
        (item) => String(item.id) === productId
    )

    const existingItem = cartItems.find(
        (item) => String(item.id) === productId
    )



    /* =========================
       FETCH PRODUCT RATINGS
    ========================= */

    useEffect(() => {

        const fetchRatings = async () => {

            try {

                const reviewsRef = collection(fireDB, "reviews")

                const q = query(
                    reviewsRef,
                    where("productId", "==", productId)
                )

                const snapshot = await getDocs(q)

                if (snapshot.empty) {
                    setAvgRating(0)
                    setReviewCount(0)
                    return
                }

                let total = 0
                let count = 0

                snapshot.forEach((doc) => {

                    const data = doc.data()

                    if (data.rating) {
                        total += Number(data.rating)
                        count++
                    }

                })

                const avg = total / count

                setAvgRating(avg)
                setReviewCount(count)

            } catch (error) {

                console.log("Rating fetch error:", error)

            }

        }

        fetchRatings()

    }, [productId])



    /* =========================
       WISHLIST TOGGLE
    ========================= */

    const handleWishlist = async (e) => {

        e.stopPropagation()

        const user = auth.currentUser

        if (!user) {
            alert("Please login first")
            return
        }

        const wishlistRef = collection(fireDB, "wishlists")

        try {

            const wishlistRef = collection(fireDB, "wishlists")

            const snapshot = await getDocs(query(wishlistRef, where("userId", "==", user.uid)))

            const existing = snapshot.docs.find(
                (doc) =>
                    doc.data().userId === user.uid &&
                    doc.data().productId === productId
            )

            if (existing) {

                dispatch(removeWishlist(productId))

                await deleteDoc(
                    doc(fireDB, "wishlists", existing.id)
                )

            } else {

                // Object for Redux (serializable)
                const reduxWishlistItem = {
                    userId: user.uid,
                    productId: productId,
                    id: productId,
                    title: product.title,
                    price: product.price,
                    image: product.thumbnail || product.image,
                    category: product.category,
                    addedAt: new Date().toISOString()
                }

                dispatch(addWishlist(reduxWishlistItem))

                // Object for Firestore
                const firestoreWishlistItem = {
                    userId: user.uid,
                    productId: productId,
                    id: productId,
                    title: product.title,
                    price: product.price,
                    image: product.thumbnail || product.image,
                    category: product.category,
                    addedAt: serverTimestamp()
                }

                await setDoc(
                    doc(collection(fireDB, "wishlists")),
                    firestoreWishlistItem
                )

            }

        } catch (error) {

            console.log("Wishlist error:", error)

        }

    }



    /* =========================
       MOBILE VARIANT (≤640px)
       Shares all hooks/handlers above; only the layout differs.
    ========================= */
    if (variant === "mobile") {
        const priceLabel = `$${Number(product.price || 0).toFixed(2)}`;

        // Stock badge derived from the existing numeric `stock` field
        let stockText, stockColor, stockItalic;
        if (isOutOfStock) {
            stockText = "Out of Stock"; stockColor = "#A43B31"; stockItalic = true;
        } else if (stock <= 5) {
            stockText = `${stock} left`; stockColor = "#A43B31"; stockItalic = false;
        } else {
            stockText = "In Stock"; stockColor = "#A43B31"; stockItalic = true;
        }

        const goToProduct = () =>
            navigate(`/product/${productId}`, { state: { product } });

        return (
            <div
                className="w-full bg-white relative flex flex-col overflow-hidden"
                style={{
                    minHeight: "347px",
                    borderRadius: "12px",
                    boxShadow: "0px 4px 20px rgba(26,43,60,0.05)",
                    fontFamily: "Inter, sans-serif",
                }}
            >
                {/* WISHLIST BUTTON */}
                <button
                    onClick={handleWishlist}
                    aria-label="Toggle wishlist"
                    className="absolute z-20 flex items-center justify-center"
                    style={{
                        top: "12px",
                        right: "12px",
                        width: "32px",
                        height: "32px",
                        background: "rgba(255,255,255,0.9)",
                        borderRadius: "9999px",
                        backdropFilter: "blur(4px)",
                        WebkitBackdropFilter: "blur(4px)",
                    }}
                >
                    {isWishlisted ? (
                        <FaHeart size={16} style={{ color: "#A43B31" }} />
                    ) : (
                        <FaRegHeart size={16} style={{ color: "#74777D" }} />
                    )}
                </button>

                {/* IMAGE AREA — square, full card width */}
                <div
                    onClick={goToProduct}
                    className="w-full cursor-pointer"
                    style={{ background: "#F6F3F2", padding: "8px" }}
                >
                    <div className="w-full aspect-square">
                        <img
                            src={product.thumbnail || product.image}
                            alt={product.title}
                            loading="lazy"
                            className="w-full h-full"
                            style={{ objectFit: "cover", borderRadius: "8px" }}
                        />
                    </div>
                </div>

                {/* CONTENT AREA */}
                <div className="flex flex-col flex-1" style={{ padding: "12px" }}>
                    {/* Top cluster */}
                    <div onClick={goToProduct} className="cursor-pointer">
                        <p
                            style={{
                                color: "#74777D",
                                fontWeight: 600,
                                fontSize: "12px",
                                textTransform: "uppercase",
                                letterSpacing: "0.6px",
                            }}
                        >
                            {product.category}
                        </p>
                        <h3
                            style={{
                                color: "#1B1C1C",
                                fontWeight: 700,
                                fontSize: "14px",
                                lineHeight: "18px",
                                marginTop: "4px",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }}
                        >
                            {product.title}
                        </h3>
                        {/* Rating row */}
                        <div className="flex items-center" style={{ marginTop: "6px", gap: "4px" }}>
                            <span style={{ color: "#D4AF37", fontSize: "11px", lineHeight: 1 }}>★</span>
                            <span style={{ color: "#74777D", fontWeight: 400, fontSize: "11px" }}>
                                {reviewCount > 0
                                    ? `${avgRating.toFixed(1)} (${reviewCount})`
                                    : "No reviews"}
                            </span>
                        </div>
                    </div>

                    {/* Bottom cluster — pinned to bottom when slack exists */}
                    <div style={{ marginTop: "auto" }}>
                        {/* Price + stock badge */}
                        <div
                            className="flex items-center justify-between"
                            style={{ marginTop: "10px", marginBottom: "8px" }}
                        >
                            <span style={{ color: "#1B1C1C", fontWeight: 600, fontSize: "18px" }}>
                                {priceLabel}
                            </span>
                            <span
                                style={{
                                    color: stockColor,
                                    fontWeight: 500,
                                    fontSize: "10px",
                                    fontStyle: stockItalic ? "italic" : "normal",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {stockText}
                            </span>
                        </div>

                        {/* CTA — keeps existing cart handlers */}
                        {isOutOfStock ? (
                            <button
                                disabled
                                className="w-full flex items-center justify-center"
                                style={{
                                    height: "36px",
                                    borderRadius: "9999px",
                                    background: "#E5E5E5",
                                    color: "#74777D",
                                    fontWeight: 700,
                                    fontSize: "12px",
                                    letterSpacing: "0.6px",
                                    textTransform: "uppercase",
                                    cursor: "not-allowed",
                                }}
                            >
                                Out of Stock
                            </button>
                        ) : existingItem ? (
                            <div
                                className="w-full flex items-center justify-between"
                                style={{
                                    height: "36px",
                                    borderRadius: "9999px",
                                    border: "1px solid #A43B31",
                                    overflow: "hidden",
                                }}
                            >
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        dispatch(removeCart(productId));
                                    }}
                                    className="h-full flex-1 flex items-center justify-center"
                                    style={{ color: "#A43B31", fontWeight: 700, fontSize: "16px" }}
                                >
                                    −
                                </button>
                                <span
                                    style={{
                                        color: "#1B1C1C",
                                        fontWeight: 700,
                                        fontSize: "13px",
                                        minWidth: "20px",
                                        textAlign: "center",
                                    }}
                                >
                                    {existingItem.quantity}
                                </span>
                                <button
                                    disabled={existingItem.quantity >= stock}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        dispatch(addCart(product));
                                    }}
                                    className="h-full flex-1 flex items-center justify-center"
                                    style={{
                                        color: existingItem.quantity >= stock ? "#D9B8B3" : "#A43B31",
                                        fontWeight: 700,
                                        fontSize: "16px",
                                    }}
                                >
                                    +
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!auth.currentUser) {
                                        navigate("/login");
                                        return;
                                    }
                                    dispatch(addCart(product));
                                }}
                                className="w-full flex items-center justify-center"
                                style={{
                                    height: "36px",
                                    borderRadius: "9999px",
                                    background: "#A43B31",
                                    color: "#fff",
                                    fontWeight: 700,
                                    fontSize: "12px",
                                    letterSpacing: "0.6px",
                                    textTransform: "uppercase",
                                }}
                            >
                                Add to Cart
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full group">
            <div className="h-[340px] w-full bg-white relative flex flex-col rounded-2xl overflow-hidden shadow-md group-hover:shadow-2xl transition duration-300 border border-gray-100">

                {/* WISHLIST BUTTON (Independent absolute layer) */}
                <button
                    onClick={handleWishlist}
                    className="absolute top-4 right-4 z-50 bg-white border border-gray-100 shadow-md p-2 rounded-full hover:bg-gray-50 transition-colors pointer-events-auto cursor-pointer"
                >
                    {isWishlisted ? (
                        <FaHeart size={20} className="text-red-500" />
                    ) : (
                        <FaRegHeart size={20} className="text-gray-400 hover:text-red-400" />
                    )}
                </button>

                {/* Clickable Navigation Wrapper */}
                <div
                    onClick={() => navigate(`/product/${productId}`, { state: { product } })}
                    className="flex flex-col flex-1 cursor-pointer"
                >
                    {/* Background Image Container */}
                    <div className="h-40 w-full p-4 flex items-center justify-center bg-gray-50">
                        <img
                            src={product.thumbnail || product.image}
                            alt={product.title}
                            loading="lazy"
                            className="h-full w-full object-contain mix-blend-multiply group-hover:scale-110 transition-transform duration-500"
                        />
                    </div>

                    {/* Text Content */}
                    <div className="p-3 flex flex-col flex-1 bg-white relative">
                        <div className="absolute right-3 -top-5 bg-black px-3 py-1.5 rounded-full shadow-lg">
                            <span className="font-bold text-white tracking-wide text-xs">₹{product.price}</span>
                        </div>

                        <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">
                            {product.category}
                        </p>

                        <h3 className="font-bold text-gray-900 text-[17px] mb-1.5 line-clamp-2 leading-tight">
                            {product.title}
                        </h3>

                        {/* RATING & STOCK */}
                        <div className="flex items-center justify-between mt-auto">
                            <div className="flex items-center text-yellow-500 text-sm">
                                {reviewCount > 0 ? (
                                    <>
                                        {"★".repeat(Math.round(avgRating))}
                                        {"☆".repeat(5 - Math.round(avgRating))}
                                        <span className="text-gray-400 ml-2 text-[11px] font-black uppercase transition-colors">
                                            {avgRating.toFixed(1)}
                                        </span>
                                    </>
                                ) : (
                                    <span className="text-gray-400 text-[11px] font-black uppercase tracking-wider">
                                        no review yet
                                    </span>
                                )}
                            </div>
                            <div className={`font-black uppercase tracking-tighter px-2 py-0.5 rounded-md text-[10px] ${isOutOfStock ? "bg-red-100 text-red-600" : stock <= 5 ? "bg-red-50 text-red-500" : "bg-neutral-50 text-neutral-400"
                                }`}>
                                {isOutOfStock ? "out of stock" : `${stock} QTY Available`}
                            </div>
                        </div>
                    </div>
                </div>

                {/* CART CONTROLS (Independent relative layer at bottom) */}
                <div className="px-3 pb-3 bg-white z-40">
                    {isOutOfStock ? (
                        <button
                            disabled
                            className="w-full bg-gray-100 text-gray-400 border border-gray-200 rounded-xl py-3 cursor-not-allowed font-medium text-sm transition-all shadow-sm min-h-[44px]"
                        >
                            Out of Stock
                        </button>
                    ) : existingItem ? (
                        <div className="flex items-center justify-between bg-white border-2 border-black rounded-xl overflow-hidden shadow-sm">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    dispatch(removeCart(productId));
                                }}
                                className="bg-transparent text-black hover:bg-gray-100 px-4 py-2.5 transition-colors flex-1 font-bold text-lg cursor-pointer min-h-[44px]"
                            >
                                -
                            </button>
                            <span className="font-bold text-black px-2">
                                {existingItem.quantity}
                            </span>
                            <button
                                disabled={existingItem.quantity >= stock}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    dispatch(addCart(product));
                                }}
                                className={`px-4 py-2.5 text-black hover:bg-gray-100 font-bold transition-colors flex-1 text-lg cursor-pointer min-h-[44px] ${existingItem.quantity >= stock ? "text-gray-300 cursor-not-allowed" : "text-black"
                                    }`}
                            >
                                +
                            </button>
                        </div>
                    ) : (
                        <button
                            disabled={isOutOfStock}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!auth.currentUser) {
                                    navigate("/login");
                                    return;
                                }
                                dispatch(addCart(product));
                            }}
                            className={`w-full rounded-xl py-3 text-white font-semibold text-sm transition-all shadow-md hover:shadow-lg cursor-pointer min-h-[44px] ${isOutOfStock ? "bg-gray-400 cursor-not-allowed" : "bg-black hover:bg-gray-800 hover:-translate-y-0.5"
                                }`}
                        >
                            Add to Cart
                        </button>
                    )}
                </div>

            </div>
        </div>
    );
};