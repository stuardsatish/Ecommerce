import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom"
import { lazy, Suspense, useState, useEffect, useRef } from "react"
import { useDispatch, useSelector } from "react-redux"

const LandingPage = lazy(() => import("./pages/LandingPage/LandingPage"))
const ProcessDetailsPage = lazy(() => import("./pages/ProcessDetailsPage/ProcessDetailsPage"))

const ServicesPage = lazy(() => import("./pages/ServicesPage/ServicesPage"))
const ContactPage = lazy(() => import("./pages/ContactPage/ContactPage"))
const ProductsPage = lazy(() => import("./pages/ProductsPage/ProductsPage"))
const ProductDetail = lazy(() => import("./pages/ProductDetail/ProductDetail"))
const CartPage = lazy(() => import("./pages/CartPage/CartPage"))
const LoginPage = lazy(() => import("./pages/LoginPage/LoginPage"))
const SignupPage = lazy(() => import("./pages/SignupPage/SignupPage"))
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage/ResetPasswordPage"))
const AdminOrdersPage = lazy(() => import("./pages/AdminOrdersPage/AdminOrdersPage"))
const WishlistPage = lazy(() => import("./pages/WishlistPage/WishlistPage"))
const UsersPage = lazy(() => import("./pages/UsersPage/UsersPage"))
const AddProductPage = lazy(() => import("./pages/AddProductPage/AddProductPage"))
const AddDiscountPage = lazy(() => import("./pages/AddDiscountPage/AddDiscountPage"))
const EditProductPage = lazy(() => import("./pages/EditProductPage/EditProductPage"))
const UserOrdersPage = lazy(() => import("./pages/UserOrdersPage/UserOrdersPage"))
const OrderDetailPage = lazy(() => import("./pages/OrderDetailPage/OrderDetailPage"))
const UserPastOrdersPage = lazy(() => import("./pages/UserPastOrdersPage/UserPastOrdersPage"))
const MyProfile = lazy(() => import("./pages/MyProfile/MyProfile"))
const AllUsersOrdersAnalytics = lazy(() => import("./pages/AllUsersOrdersAnalytics/AllUsersOrdersAnalytics"))
const AllProductsOrdersAnalytics = lazy(() => import("./pages/AllProductsOrdersAnalytics/AllProductsOrdersAnalytics"))
const AdminUploadOrders = lazy(() => import("./pages/AdminUploadOrders/AdminUploadOrders"))
const ScrollSequence = lazy(() => import("./pages/ScrollSequence/ScrollSequence"))
const CreateOrdersPage = lazy(() => import("./pages/CreateOrdersPage/CreateOrdersPage"))
const BillingPage = lazy(() => import("./pages/BillingPage/BillingPage"))
const Optimization = lazy(() => import("./pages/Optimization/Optimization"))

import Loader from "./components/Common/Loader"
import Navbar from "./components/Layout/Navbar"
import MobileNav from "./components/Layout/MobileNav"
import SessionManager from "./components/SessionManager"
import useSessionWatcher from "./hooks/useSessionWatcher"

import { ToastContainer } from "react-toastify"
import "react-toastify/dist/ReactToastify.css"

import { supabase } from "./context/SupabaseConfig"

import { setUser, clearUser } from "./context/UserSlice"
import { setCart } from "./context/CartSlice"
import { setWishlist } from "./context/WishlistSlice"

import { startLoading, stopLoading } from "./context/LoadingSlice"

import UserRoute from "./routes/UserRoute"
import AdminRoute from "./routes/AdminRoute"



// Reserves vertical space for the always-visible fixed navbar so page content
// never sits underneath it. Skipped on the full-bleed hero routes (landing /
// video) where the nav intentionally overlays the hero, and hidden on small
// screens where the floating nav retracts on shell routes (those pages render
// their own TopAppBar).
const FULL_BLEED_ROUTES = ["/", "/video"]
const NavbarSpacer = () => {
  const { pathname } = useLocation()
  if (FULL_BLEED_ROUTES.includes(pathname)) return null
  return <div aria-hidden="true" className="hidden sm:block" style={{ height: "88px" }} />
}

const areCartItemsEqual = (arr1, arr2) => {
  if (!arr1 || !arr2) return false
  if (arr1.length !== arr2.length) return false
  for (const item1 of arr1) {
    const item2 = arr2.find((x) => x.id === item1.id)
    if (!item2) return false
    if (item1.quantity !== item2.quantity) return false
    if (item1.price !== item2.price) return false
    if (Number(item1.discount || 0) !== Number(item2.discount || 0)) return false
    if ((item1.discountExpiry || "") !== (item2.discountExpiry || "")) return false
  }
  return true
}

const App = () => {

  const dispatch = useDispatch()

  const cartItems = useSelector((state) => state.cart.cartItems)
  const wishListItems = useSelector((state) => state.wishlist.wishlistItems)
  const authUser = useSelector((state) => state.user.user)

  // Single-session enforcement: logs this device out if another device logs in.
  useSessionWatcher(authUser?.uid)

  const [authChecked, setAuthChecked] = useState(false)

  // Keep a ref to current cartItems to prevent infinite listener update loops
  const cartItemsRef = useRef(cartItems)
  useEffect(() => {
    cartItemsRef.current = cartItems
  }, [cartItems])

  // AUTH + LOAD USER + CART + WISHLIST
  useEffect(() => {

    dispatch(startLoading())

    let unsubCart = null  // will hold the Realtime channel unsubscribe for cart_items
    let cancelled = false

    // Cart is per-row in `cart_items` now (one row per user+product) instead
    // of a single jsonb doc, so every event just re-selects the full set for
    // this user — cheap, and it always re-joins `products` for live
    // price/discount/expiry (mirrors what the old onSnapshot handler did by
    // fetching the whole product catalog on every cart change).
    const loadCartAndWishlist = async (uid) => {
      if (unsubCart) { unsubCart(); unsubCart = null }

      const fetchCart = async () => {
        const { data, error } = await supabase
          .from("cart_items")
          .select("quantity, product_id, products(title, price, discount, discount_expiry, stock, thumbnail, image, category)")
          .eq("user_id", uid)

        if (error) {
          console.error("Error loading cart:", error)
          return
        }

        const formattedItems = (data || []).map((row) => {
          const p = row.products || {}
          return {
            id: row.product_id,
            title: p.title || "",
            price: Number(p.price) || 0,
            quantity: row.quantity,
            image: p.thumbnail || p.image || "",
            stock: p.stock || 0,
            category: p.category || "general",
            // Always use live product discount & expiry so expired discounts
            // don't persist in the cart when a product's discount changes.
            discount: Number(p.discount || 0),
            discountExpiry: p.discount_expiry || "",
          }
        })

        if (!areCartItemsEqual(formattedItems, cartItemsRef.current)) {
          dispatch(setCart(formattedItems))
        }
      }

      await fetchCart()

      const channel = supabase
        .channel(`cart-items-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "cart_items", filter: `user_id=eq.${uid}` },
          fetchCart
        )
        .subscribe()

      unsubCart = () => supabase.removeChannel(channel)

      const { data: wishlistRows, error: wishlistError } = await supabase
        .from("wishlist_items")
        .select("*")
        .eq("user_id", uid)

      if (wishlistError) {
        console.error("Error loading wishlist:", wishlistError)
      } else {
        const wishlistData = (wishlistRows || []).map((row) => ({
          id: row.product_id,
          userId: row.user_id,
          productId: row.product_id,
          title: row.title,
          image: row.image,
          price: row.price,
          category: row.category,
          addedAt: row.added_at,
        }))
        dispatch(setWishlist(wishlistData))
      }
    }

    // Fetch the `profiles` row (replaces the old users/{uid} Firestore doc)
    // and hydrate Redux + cart/wishlist for a signed-in Supabase session.
    const handleSession = async (session) => {
      if (cancelled) return

      if (session?.user) {
        try {
          const { data: profile, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .single()

          if (error) throw error

          dispatch(setUser({ ...profile, uid: session.user.id }))
          await loadCartAndWishlist(session.user.id)
        } catch (error) {
          console.error("Error loading user data:", error)
        }
      } else {
        if (unsubCart) { unsubCart(); unsubCart = null }
        dispatch(clearUser())
        dispatch(setCart([]))
        dispatch(setWishlist([]))
      }

      dispatch(stopLoading())
      setAuthChecked(true)
    }

    // Initial load, then react to sign-in/sign-out/token-refresh events.
    supabase.auth.getSession().then(({ data: { session } }) => handleSession(session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION is already handled by getSession().then() above; skip it
      // here to avoid double-calling handleSession (and double-subscribing the
      // cart Realtime channel) on every page load with an active session.
      if (event === 'INITIAL_SESSION') return
      handleSession(session)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
      if (unsubCart) unsubCart()
    }

  }, [dispatch])

  if (!authChecked) {
    return <Loader />
  }

  return (

    <BrowserRouter>

      <ToastContainer position="top-right" autoClose={3000} />

      <SessionManager />

      <Navbar />
      <MobileNav />
      <NavbarSpacer />

      <Suspense fallback={<Loader />}>
        <Routes>

        {/* PUBLIC */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* NEW PUBLIC ROUTES */}
        <Route path="/" element={<LandingPage />} />
       
        <Route path="/process-details" element={<ProcessDetailsPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/product/:id" element={<ProductDetail />} />



        {/* USER PROTECTED ROUTES */}
        <Route path="/cart" element={<UserRoute><CartPage /></UserRoute>} />
        <Route path="/wishlist" element={<UserRoute><WishlistPage /></UserRoute>} />
        <Route path="/services" element={<UserRoute><ServicesPage /></UserRoute>} />
        <Route path="/userorders" element={<UserRoute><UserOrdersPage /></UserRoute>} />
        <Route path="/userpastorders" element={<UserRoute><UserPastOrdersPage /></UserRoute>} />
        <Route path="/order/:id" element={<UserRoute><OrderDetailPage /></UserRoute>} />
        <Route path="/myprofile" element={<UserRoute><MyProfile /></UserRoute>} />


        <Route path="/video" element={<UserRoute><ScrollSequence /></UserRoute>} />

   

        {/* ADMIN ROUTES */}
        <Route path="/admin/users" element={<AdminRoute><UsersPage /></AdminRoute>} />

        <Route path="/admin/add-product" element={<AdminRoute><AddProductPage /></AdminRoute>} />

        <Route path="/admin/allUsersOrdersAnalytics" element={<AdminRoute><AllUsersOrdersAnalytics /></AdminRoute>} />

        <Route path="/admin/allProductsOrdersAnalytics" element={<AdminRoute><AllProductsOrdersAnalytics /></AdminRoute>} />

        <Route path="/admin/adminUploadOrders" element={<AdminRoute><AdminUploadOrders /></AdminRoute>} />

        <Route path="/admin/myorders" element={<AdminRoute><AdminOrdersPage /></AdminRoute>} />

        <Route path="/admin/add-discount" element={<AdminRoute><AddDiscountPage /></AdminRoute>} />

        <Route path="/admin/edit-product/:id" element={<AdminRoute><EditProductPage /></AdminRoute>} />

        <Route path="/admin/createOrders" element={<AdminRoute><CreateOrdersPage /></AdminRoute>} />

        <Route path="/admin/billing" element={<AdminRoute><BillingPage /></AdminRoute>} />

        <Route path="/admin/optimization" element={<AdminRoute><Optimization /></AdminRoute>} />

      </Routes>
      </Suspense>

    </BrowserRouter>

  )

}

export default App