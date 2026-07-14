import { assets } from "../../assets/assets"

const Services = () => {
  const sweets = [
    {
      title: "Traditional Sweets",
      desc: "Authentic laddus and festive delights made with pure ghee.",
      image: assets.laddu,
    },
    {
      title: "Custom Cakes",
      desc: "Designer cakes crafted for birthdays and celebrations.",
      image: assets.cake,
    },
    {
      title: "Premium Chocolates",
      desc: "Handcrafted luxury chocolates perfect for gifting.",
      image: assets.chocolates,
    },
  ]

  return (
    <section className="relative bg-white py-24">

      {/* Soft aesthetic background shadow */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-50 to-white -z-10"></div>

      <h2 className="text-4xl font-bold text-center text-gray-800 mb-16">
        Our Sweet Collections
      </h2>

      <div className="grid md:grid-cols-3 gap-12 px-16 -mt-8">
        {sweets.map((sweet, index) => (
          <div
            key={index}
            className="bg-white rounded-3xl shadow-xl overflow-hidden
                       transform transition duration-500
                       hover:scale-105 hover:shadow-2xl"
          >
            {/* Image */}
            <div className="h-64 w-full overflow-hidden">
              <img
                src={sweet.image}
                alt={sweet.title}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Content */}
            <div className="p-8">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">
                {sweet.title}
              </h3>
              <p className="text-gray-600 leading-relaxed">
                {sweet.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default Services