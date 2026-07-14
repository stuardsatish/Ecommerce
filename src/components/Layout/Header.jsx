import { NavLink, useNavigate, useLocation } from "react-router-dom"
import { assets } from "../../assets/assets"
import { useDispatch, useSelector } from "react-redux"
import { toggleTheme } from "../../context/ThemeSlice"

import { signOut } from "firebase/auth"
import { auth, fireDB } from "../../context/FirebaseConfig"

import { clearUser } from "../../context/UserSlice"

import { doc, getDoc } from "firebase/firestore"
import { useEffect, useState } from "react"

import { FaUserCircle } from "react-icons/fa"


const Header = () => {

  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()

  const cartItems = useSelector((state) => state.cart.cartItems)
  const darkMode = useSelector((state)=>state.theme.darkMode)
  const user = useSelector((state)=>state.user.user)
  const wishlistItems = useSelector((state) => state.wishlist.wishlistItems)

  const wishlistCount = wishlistItems.length

  const [userData, setUserData] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const totalCount = cartItems.reduce(
    (acc, item) => acc + item.quantity,
    0
  )

  // Fetch user name from Firestore
  useEffect(() => {
    const fetchUser = async () => {
      if(user?.uid){
        const docRef = doc(fireDB, "users", user.uid)
        const docSnap = await getDoc(docRef)
        if(docSnap.exists()){
          setUserData(docSnap.data())
        }
      }
    }
    fetchUser()
  }, [user])

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
    setMenuOpen(false)
  }, [location.pathname])

  // Lock body when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  const handleLogout = async () => {
    try {
      await signOut(auth)
      dispatch(clearUser())
      setDrawerOpen(false)
      navigate("/login")
    } catch (error) {
      console.error("Logout Error:", error)
    }
  }

  return (
    <>
      {/* Top Bar */}
      <div className="bg-gray-600 text-white text-xs md:text-sm px-4 md:px-10 py-2 flex flex-col md:flex-row justify-between gap-1">
        <div className="space-x-4">
          <span> +91 99666 33322</span>
          <span className="hidden sm:inline"> contact@cognizant.com</span>
        </div>
      </div>

      {/* Navbar */}
      <header className="flex justify-between items-center px-4 md:px-10 py-3 md:py-4 shadow-md">

        <img src={assets.logo} alt="Logo" className="h-10 md:h-12 w-auto" />

        {/* Desktop Nav */}
        <nav className="hidden md:flex space-x-8 font-medium items-center">

          <NavLink
            to="/"
            className={({ isActive }) =>
              isActive ? "text-orange-500" : "hover:text-orange-500"
            }
          >
            Home
          </NavLink>

          <NavLink
            to="/products"
            className={({ isActive }) =>
              isActive ? "text-orange-500" : "hover:text-orange-500"
            }
          >
            Products
          </NavLink>

          <NavLink
            to="/services"
            className={({ isActive }) =>
              isActive ? "text-orange-500" : "hover:text-orange-500"
            }
          >
            Services
          </NavLink>

          <NavLink
            to="/contact"
            className={({ isActive }) =>
              isActive ? "text-orange-500" : "hover:text-orange-500"
            }
          >
            Contact Us
          </NavLink>

          {/* Theme Toggle */}
          <button onClick={()=>dispatch(toggleTheme())} className="min-w-[44px] min-h-[44px] flex items-center justify-center">
            {darkMode ? " " : " "}
          </button>

          {/* Show Name */}
          {userData && (
            <span className="text-sm font-medium">
              Hi, {userData.name}
            </span>
          )}

          {/* Login / Logout */}
          {user ? (
            <button
              onClick={handleLogout}
              className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
            >
              Logout
            </button>
          ) : (
            <NavLink
              to="/login"
              className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
            >
              Login
            </NavLink>
          )}

          <div className="relative">
            <FaUserCircle
              size={28}
              className="cursor-pointer"
              onClick={() => setMenuOpen(!menuOpen)}
            />

            {menuOpen && (
              <div className="absolute right-0 bg-white shadow-md rounded p-3 w-40 flex flex-col space-y-2 z-50">
                {user?.role === "user" && (
                <NavLink to="/wishlist" className="block hover:text-orange-500">
                  Wishlist
                  {wishlistCount > 0 && (
                    <span className="ml-2 bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                      {wishlistCount}
                    </span>
                  )}
                </NavLink>
                )}
                
                {user?.role === "user" && (
                <NavLink to="/cart" className="block hover:text-orange-500">
                  Cart
                  {totalCount > 0 && (
                    <span className="ml-2 bg-orange-500 text-white text-xs px-2 py-1 rounded-full">
                      {totalCount}
                    </span>
                  )}
                </NavLink>
                )}

                {user?.role === "user" && (
                  <NavLink to="/userorders" className={({ isActive }) => isActive ? "text-orange-500" : "hover:text-orange-500"}>
                    My Orders
                  </NavLink>
                )}

                {user?.role === "admin" && (
                  <NavLink to="/admin/myorders" className={({ isActive }) => isActive ? "text-orange-500" : "hover:text-orange-500"}>
                    Admin Orders
                  </NavLink>
                )}

                {user?.role === "admin" && (
                  <NavLink to="/admin/add-product" className={({ isActive }) => isActive ? "text-orange-500" : "hover:text-orange-500"}>
                    Add Products
                  </NavLink>
                )}

                {user?.role === "admin" && (
                  <NavLink to="/admin/allUsersOrdersAnalytics" className={({ isActive }) => isActive ? "text-orange-500" : "hover:text-orange-500"}>
                    User Analytics
                  </NavLink>
                )}

                {user?.role === "admin" && (
                  <NavLink to="/admin/allProductsOrdersAnalytics" className={({ isActive }) => isActive ? "text-orange-500" : "hover:text-orange-500"}>
                    Product Analytics
                  </NavLink>
                )}

                {user?.role === "admin" && (
                  <NavLink to="/admin/adminUploadOrders" className={({ isActive }) => isActive ? "text-orange-500" : "hover:text-orange-500"}>
                    Upload fake orders
                  </NavLink>
                )}

                {user?.role === "user" && (
                  <NavLink to="/userpastorders" className={({ isActive }) => isActive ? "text-orange-500" : "hover:text-orange-500"}>
                    My Past Orders
                  </NavLink>
                )}
              </div>
            )}
          </div>

        </nav>

        {/* Mobile: hamburger + cart badge */}
        <div className="flex md:hidden items-center gap-2">
          {user && totalCount > 0 && (
            <button
              onClick={() => navigate("/cart")}
              className="relative min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-700"
            >
              
              <span className="absolute top-1 right-1 bg-orange-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center">
                {totalCount}
              </span>
            </button>
          )}
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className={`hamburger-btn text-gray-800 ${drawerOpen ? 'active' : ''}`}
            aria-label="Toggle menu"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </header>

      {/* Mobile Drawer */}
      <div
        className={`mobile-drawer-backdrop md:hidden ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />
      <div className={`mobile-drawer md:hidden ${drawerOpen ? 'open' : ''}`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <img src={assets.logo} alt="Logo" className="h-8 w-auto" />
            <button
              onClick={() => dispatch(toggleTheme())}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              {darkMode ? " " : " "}
            </button>
          </div>

          {/* User greeting */}
          {userData && (
            <div className="px-6 py-3 bg-gray-50">
              <p className="text-xs text-gray-400 uppercase tracking-widest">Hello,</p>
              <p className="text-sm font-bold text-gray-800">{userData.name}</p>
            </div>
          )}

          {/* Nav Links */}
          <div className="flex-1 py-2">
            {[
              { to: "/", label: "Home" },
              { to: "/products", label: "Products" },
              { to: "/services", label: "Services" },
              { to: "/contact", label: "Contact Us" },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  `flex items-center px-6 min-h-[48px] text-sm font-medium transition-all ${
                    isActive ? "text-orange-500 bg-orange-50 border-l-2 border-orange-500" : "text-gray-700 hover:bg-gray-50"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}

            {/* User-specific links */}
            {user && (
              <div className="mt-2 pt-2 border-t border-gray-100">
                {user.role === "user" && (
                  <>
                    <NavLink to="/wishlist" onClick={() => setDrawerOpen(false)} className="flex items-center justify-between px-6 min-h-[48px] text-sm text-gray-700 hover:bg-gray-50">
                      <span>Wishlist</span>
                      {wishlistCount > 0 && <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{wishlistCount}</span>}
                    </NavLink>
                    <NavLink to="/cart" onClick={() => setDrawerOpen(false)} className="flex items-center justify-between px-6 min-h-[48px] text-sm text-gray-700 hover:bg-gray-50">
                      <span>Cart</span>
                      {totalCount > 0 && <span className="bg-orange-500 text-white text-xs px-2 py-0.5 rounded-full">{totalCount}</span>}
                    </NavLink>
                    <NavLink to="/userorders" onClick={() => setDrawerOpen(false)} className="flex items-center px-6 min-h-[48px] text-sm text-gray-700 hover:bg-gray-50">My Orders</NavLink>
                    <NavLink to="/userpastorders" onClick={() => setDrawerOpen(false)} className="flex items-center px-6 min-h-[48px] text-sm text-gray-700 hover:bg-gray-50">Past Orders</NavLink>
                  </>
                )}
                {user.role === "admin" && (
                  <>
                    <NavLink to="/admin/myorders" onClick={() => setDrawerOpen(false)} className="flex items-center px-6 min-h-[48px] text-sm text-blue-600 hover:bg-blue-50">Admin Orders</NavLink>
                    <NavLink to="/admin/add-product" onClick={() => setDrawerOpen(false)} className="flex items-center px-6 min-h-[48px] text-sm text-blue-600 hover:bg-blue-50">Add Products</NavLink>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Bottom actions */}
          <div className="p-6 border-t border-gray-100">
            {user ? (
              <button
                onClick={handleLogout}
                className="w-full py-3 bg-red-500 text-white rounded-xl text-sm font-bold hover:bg-red-600 transition-colors"
              >
                Logout
              </button>
            ) : (
              <NavLink
                to="/login"
                onClick={() => setDrawerOpen(false)}
                className="block w-full py-3 bg-green-500 text-white rounded-xl text-sm font-bold text-center hover:bg-green-600 transition-colors"
              >
                Login
              </NavLink>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default Header