import clsx from "clsx";
import gsap from "gsap";
import { useWindowScroll } from "react-use";
import { useEffect, useRef, useState } from "react";
import { TiLocationArrow } from "react-icons/ti";

import Button from "./Button";

import { NavLink, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";

import { clearUser } from "../../context/UserSlice";

import { signOut } from "firebase/auth";
import { auth, fireDB } from "../../context/FirebaseConfig";

import { doc, getDoc } from "firebase/firestore";

import { FaUserCircle } from "react-icons/fa";

const navItems = [
  { name: "Home", link: "/" },
  { name: "Services", link: "/services" },
  { name: "Contact", link: "/contact" }
];

const NavBar = () => {

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const cartItems = useSelector((state) => state.cart.cartItems);
  const wishlistItems = useSelector((state) => state.wishlist.wishlistItems);
  const user = useSelector((state) => state.user.user);

  const totalCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);
  const wishlistCount = wishlistItems.length;

  const [menuOpen, setMenuOpen] = useState(false);
  const [userData, setUserData] = useState(null);

  // ===== ORIGINAL NAVBAR STATES =====
  const audioElementRef = useRef(null);
  const navContainerRef = useRef(null);

  const { y: currentScrollY } = useWindowScroll();
  const [isNavVisible, setIsNavVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  // ===== FETCH USER =====
  useEffect(() => {

    const fetchUser = async () => {

      if (user?.uid) {

        const docRef = doc(fireDB, "users", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          setUserData(docSnap.data());
        }

      }

    };

    fetchUser();

  }, [user]);

  // ===== LOGOUT =====
  const handleLogout = async () => {

    try {

      await signOut(auth);
      dispatch(clearUser());
      navigate("/login");

    } catch (error) {

      console.error(error);

    }

  };

  // Audio Logic Removed

  // ===== SCROLL NAVBAR =====
  useEffect(() => {

    if (currentScrollY === 0) {

      setIsNavVisible(true);
      navContainerRef.current.classList.remove("floating-nav");

    } else if (currentScrollY > lastScrollY) {

      setIsNavVisible(false);
      navContainerRef.current.classList.add("floating-nav");

    } else if (currentScrollY < lastScrollY) {

      setIsNavVisible(true);
      navContainerRef.current.classList.add("floating-nav");

    }

    setLastScrollY(currentScrollY);

  }, [currentScrollY, lastScrollY]);

  useEffect(() => {

    gsap.to(navContainerRef.current, {
      y: isNavVisible ? 0 : -100,
      opacity: isNavVisible ? 1 : 0,
      duration: 0.2
    });

  }, [isNavVisible]);

  return (

    <div
      ref={navContainerRef}
      className="fixed inset-x-0 top-4 z-50 h-16 border-none transition-all duration-700 sm:inset-x-6"
    >

      <header className="absolute top-1/2 w-full -translate-y-1/2">

        <nav className="flex size-full items-center justify-between p-4">

          {/* LEFT SECTION */}
          <div className="flex items-center gap-7">

            <img
              src="/img/logo.png"
              alt="logo"
              className="w-10 cursor-pointer"
              onClick={() => navigate("/")}
            />

            <Button
              id="product-button"
              title="Products"
              rightIcon={<TiLocationArrow />}
              containerClass="bg-blue-50 md:flex hidden items-center justify-center gap-1"
              onClick={() => navigate("/products")}
            />

          </div>


          {/* CENTER NAV LINKS */}
          <div className="flex h-full items-center">

            <div className="hidden md:flex items-center gap-6">

              {navItems.map((item, index) => (

                <NavLink
                  key={index}
                  to={item.link}
                  className="nav-hover-btn"
                >
                  {item.name}
                </NavLink>

              ))}

            </div>


            {/* CART + WISHLIST */}
            {user?.role === "user" && (

              <div className="flex items-center ml-8 gap-6">

                <NavLink to="/wishlist" className="relative nav-hover-btn">

                  Wishlist

                  {wishlistCount > 0 && (
                    <span className="ml-1 text-xs">
                      ({wishlistCount})
                    </span>
                  )}

                </NavLink>

                <NavLink to="/cart" className="relative nav-hover-btn">

                  Cart

                  {totalCount > 0 && (
                    <span className="ml-1 text-xs">
                      ({totalCount})
                    </span>
                  )}

                </NavLink>

              </div>

            )}


            {/* USER ICON */}
            <div className="relative ml-8">

              <FaUserCircle
                size={24}
                className="cursor-pointer"
                onClick={() => setMenuOpen(!menuOpen)}
              />

              {menuOpen && (

                <div className="absolute right-0 mt-2 w-44 bg-white shadow-md rounded p-3 flex flex-col gap-2">

                  {userData && (
                    <span className="text-sm">
                      Hi, {userData.name}
                    </span>
                  )}

                  {user?.role === "user" && (
                    <NavLink to="/userorders">My Orders</NavLink>
                  )}

                  {user?.role === "user" && (
                    <NavLink to="/userpastorders">Past Orders</NavLink>
                  )}

                  {user?.role === "admin" && (
                    <>
                      <NavLink to="/admin/myorders">Admin Orders</NavLink>
                      <NavLink to="/admin/add-product">Add Product</NavLink>
                    </>
                  )}

                  {user ? (

                    <button
                      onClick={handleLogout}
                      className="text-left"
                    >
                      Logout
                    </button>

                  ) : (

                    <NavLink to="/login">
                      Login
                    </NavLink>

                  )}

                </div>

              )}

            </div>


            {/* Audio Indicator Removed */}

          </div>

        </nav>

      </header>

    </div>

  );

};

export default NavBar;