import { FaInstagram, FaFacebookF, FaYoutube, FaWhatsapp } from "react-icons/fa"

const SocialConnect = () => {
  return (
    <section className="relative bg-white pt-14 pb-24">

      {/* Soft pastel background glow */}
      <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
        <div className="w-[80%] h-[250px] bg-gradient-to-r from-rose-100 via-amber-100 to-pink-100 rounded-3xl blur-3xl opacity-40"></div>
      </div>

      <div className="relative text-center mb-16">
        <p className="text-rose-400 tracking-widest uppercase text-sm mb-3">
          Let’s Stay Connected
        </p>

        <h2 className="text-5xl font-bold text-gray-800">
          Find Us On Social Media
        </h2>

        <p className="text-gray-500 mt-4 max-w-2xl mx-auto">
          Follow us for sweet updates, festive collections, special offers,
          and delicious moments shared every day.
        </p>
      </div>

      {/* Social Cards */}
      <div className="relative flex justify-center gap-8 flex-wrap px-6">

        {/* Instagram */}
        <a href="#" className="group">
          <div className="w-64 bg-white rounded-3xl shadow-xl p-8 text-center
                          transform transition duration-500
                          hover:-translate-y-3 hover:shadow-2xl">
            <FaInstagram className="text-4xl mx-auto text-pink-500 mb-4 group-hover:scale-110 transition" />
            <h4 className="text-xl font-semibold text-gray-800">Instagram</h4>
            <p className="text-gray-500 text-sm mt-2">@yoursweetbrand</p>
          </div>
        </a>

        {/* Facebook */}
        <a href="#" className="group">
          <div className="w-64 bg-white rounded-3xl shadow-xl p-8 text-center
                          transform transition duration-500
                          hover:-translate-y-3 hover:shadow-2xl">
            <FaFacebookF className="text-4xl mx-auto text-blue-500 mb-4 group-hover:scale-110 transition" />
            <h4 className="text-xl font-semibold text-gray-800">Facebook</h4>
            <p className="text-gray-500 text-sm mt-2">Sweet Delights</p>
          </div>
        </a>

        {/* YouTube */}
        <a href="#" className="group">
          <div className="w-64 bg-white rounded-3xl shadow-xl p-8 text-center
                          transform transition duration-500
                          hover:-translate-y-3 hover:shadow-2xl">
            <FaYoutube className="text-4xl mx-auto text-red-500 mb-4 group-hover:scale-110 transition" />
            <h4 className="text-xl font-semibold text-gray-800">YouTube</h4>
            <p className="text-gray-500 text-sm mt-2">Sweet Recipes & Vlogs</p>
          </div>
        </a>

        {/* WhatsApp */}
        <a href="#" className="group">
          <div className="w-64 bg-white rounded-3xl shadow-xl p-8 text-center
                          transform transition duration-500
                          hover:-translate-y-3 hover:shadow-2xl">
            <FaWhatsapp className="text-4xl mx-auto text-green-500 mb-4 group-hover:scale-110 transition" />
            <h4 className="text-xl font-semibold text-gray-800">WhatsApp</h4>
            <p className="text-gray-500 text-sm mt-2">Chat & Order Directly</p>
          </div>
        </a>

      </div>
    </section>
  )
}

export default SocialConnect