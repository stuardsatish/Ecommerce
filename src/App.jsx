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

import { onAuthStateChanged } from "firebase/auth"
import { auth, fireDB } from "./context/FirebaseConfig"
import { serverTimestamp } from "firebase/firestore"

import { setUser, clearUser } from "./context/UserSlice"
import { setCart } from "./context/CartSlice"
import { setWishlist } from "./context/WishlistSlice"

import { startLoading, stopLoading } from "./context/LoadingSlice"

import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  collection,
  getDocs,
  query,
  where
} from "firebase/firestore"

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

    let unsubCart = null  // will hold the onSnapshot unsubscribe for cart

    const unsubscribe = onAuthStateChanged(auth, async (user) => {

      // Clean up any previous cart listener when auth state changes
      if (unsubCart) { unsubCart(); unsubCart = null }

      if (user) {

        try {

          // USER DATA
          const userRef = doc(fireDB, "users", user.uid)
          const userSnap = await getDoc(userRef)

          if (userSnap.exists()) {

            const userData = userSnap.data()

            dispatch(setUser({
              ...userData,
              uid: user.uid,
              role: userData.role,
              createdAt: userData.createdAt
                ? userData.createdAt.toDate().toISOString()
                : null,
              lastOrderDate: userData.lastOrderDate
                ? userData.lastOrderDate.toDate().toISOString()
                : null,
              lastLoginAt: userData.lastLoginAt?.toDate
                ? userData.lastLoginAt.toDate().toISOString()
                : (userData.lastLoginAt || null)
            }))

          }

          // LOAD CART — real-time listener so Firestore changes (e.g. admin
          // clearing the cart after creating an order) are reflected instantly
          // across all tabs without needing BroadcastChannel or page reloads.
          const cartRef = doc(fireDB, "carts", user.uid)
          unsubCart = onSnapshot(cartRef, (cartSnap) => {
            if (cartSnap.exists()) {
              const items = cartSnap.data().items || []
              const formattedItems = items.map(item => ({
                id: item.productId,
                title: item.title,
                price: item.price,
                quantity: item.quantity,
                image: item.image,
                stock: item.stock,
                category: item.category || "general",
                discount: Number(item.discount || 0),
              }))
              
              if (!areCartItemsEqual(formattedItems, cartItemsRef.current)) {
                dispatch(setCart(formattedItems))
              }
            } else {
              if (cartItemsRef.current.length > 0) {
                dispatch(setCart([]))
              }
            }
          })

          // LOAD WISHLIST
          const wishlistRef = collection(fireDB, "wishlists")
          const q = query(wishlistRef, where("userId", "==", user.uid))
          const wishlistSnap = await getDocs(q)

          const wishlistData = wishlistSnap.docs.map((doc) => {

            const data = doc.data()

            return {
              docId: doc.id,
              ...data,
              addedAt: data.addedAt
                ? data.addedAt.toDate().toISOString()
                : null
            }

          })

          dispatch(setWishlist(wishlistData))

        } catch (error) {

          console.error("Error loading user data:", error)

        }

      } else {

        dispatch(clearUser())
        dispatch(setCart([]))
        dispatch(setWishlist([]))

      }

      dispatch(stopLoading())
      setAuthChecked(true)

    })

    return () => {
      unsubscribe()
      if (unsubCart) unsubCart()
    }

  }, [dispatch])

  // AUTO SAVE CART TO FIRESTORE
  useEffect(() => {

    const user = auth.currentUser
    if (!user) return

    const saveCart = async () => {

      try {

        await setDoc(
          doc(fireDB, "carts", user.uid),
          {
            items: cartItems.map(item => ({
              productId: item.id,
              title: item.title,
              price: item.price,
              quantity: item.quantity,
              image: item.thumbnail || item.image,
              stock: item.stock || 0,
              category: item.category || "general",
              discount: Number(item.discount || 0),
            })),
            updatedAt: serverTimestamp()
          },
          { merge: true }
        )

      } catch (error) {

        console.error("Error saving cart:", error)

      }

    }

    saveCart()

  }, [cartItems])

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