import { FaInstagram, FaFacebookF, FaYoutube, FaWhatsapp } from "react-icons/fa"

const Footer = () => {
  return (
    <footer className="bg-white mt-20 border-t border-rose-100">

      <div className="max-w-7xl mx-auto px-6 md:px-8 py-10 md:py-16 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">

        {/* Brand Section */}
        <div className="text-center md:text-left sm:col-span-2 md:col-span-1">
          <h3 className="text-2xl font-bold text-gray-800 mb-4">
            Sweet Delights
          </h3>
          <p className="text-gray-500 leading-relaxed">
            Crafted with love and the finest ingredients, bringing
            sweetness to your celebrations and everyday moments.
          </p>
        </div>

        {/* Quick Links */}
        <div className="text-center md:text-left">
          <h4 className="text-lg font-semibold text-gray-800 mb-4">
            Quick Links
          </h4>
          <ul className="space-y-3 text-gray-500">
            <li className="hover:text-rose-400 cursor-pointer transition min-h-[44px] flex items-center justify-center md:justify-start">Home</li>
            <li className="hover:text-rose-400 cursor-pointer transition min-h-[44px] flex items-center justify-center md:justify-start">Products</li>
            <li className="hover:text-rose-400 cursor-pointer transition min-h-[44px] flex items-center justify-center md:justify-start">Custom Cakes</li>
            <li className="hover:text-rose-400 cursor-pointer transition min-h-[44px] flex items-center justify-center md:justify-start">Contact Us</li>
          </ul>
        </div>

        {/* Policies */}
        <div className="text-center md:text-left">
          <h4 className="text-lg font-semibold text-gray-800 mb-4">
            Policies
          </h4>
          <ul className="space-y-3 text-gray-500">
            <li className="hover:text-rose-400 cursor-pointer transition min-h-[44px] flex items-center justify-center md:justify-start">
              Privacy Policy
            </li>
            <li className="hover:text-rose-400 cursor-pointer transition min-h-[44px] flex items-center justify-center md:justify-start">
              Refund Policy
            </li>
            <li className="hover:text-rose-400 cursor-pointer transition min-h-[44px] flex items-center justify-center md:justify-start">
              Terms & Conditions
            </li>
            <li className="hover:text-rose-400 cursor-pointer transition min-h-[44px] flex items-center justify-center md:justify-start">
              Shipping Policy
            </li>
          </ul>
        </div>

        {/* Contact & Social */}
        <div className="text-center md:text-left">
          <h4 className="text-lg font-semibold text-gray-800 mb-4">
            Get In Touch
          </h4>

          <p className="text-gray-500 mb-4">
            Chennai, India  
            <br />
            +91 98765 43210  
            <br />
            sweets@example.com
          </p>

          <div className="flex gap-4 text-gray-500 justify-center md:justify-start">
            <FaInstagram className="cursor-pointer hover:text-pink-500 transition text-xl" />
            <FaFacebookF className="cursor-pointer hover:text-blue-500 transition text-xl" />
            <FaYoutube className="cursor-pointer hover:text-red-500 transition text-xl" />
            <FaWhatsapp className="cursor-pointer hover:text-green-500 transition text-xl" />
          </div>
        </div>

      </div>

      {/* Bottom Bar */}
      <div className="border-t border-rose-100 py-6 text-center text-gray-400 text-sm px-6">
        © {new Date().getFullYear()} Sweet Delights. All rights reserved.
      </div>

    </footer>
  )
}

export default Footer