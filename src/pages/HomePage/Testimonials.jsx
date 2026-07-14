import { assets } from "../../assets/assets"

const Testimonials = () => {
  const reviews = [
    { name: "Ananya", img: assets.person1, review: "The sweets were absolutely fresh and delicious!" },
    { name: "Rahul", img: assets.person2, review: "Best custom cake experience ever. Highly recommended." },
    { name: "Priya", img: assets.person3, review: "Premium quality chocolates. Beautiful packaging too!" },
    { name: "Karthik", img: assets.person1, review: "Authentic taste just like homemade sweets. Authentic taste just like homemade sweets. Authentic taste just like homemade sweets." },
    { name: "Sneha", img: assets.person2, review: "Loved the presentation and delivery service." },
    { name: "Arjun", img: assets.person3, review: "Perfect for festivals and gifting." },
    { name: "Divya", img: assets.person1, review: "The kaju katli melts in your mouth!" },
    { name: "Vikram", img: assets.person2, review: "Excellent service and amazing quality." },
    { name: "Meera", img: assets.person3, review: "Beautiful cakes and wonderful taste." },
    { name: "Rohit", img: assets.person1, review: "Highly professional and delicious sweets." },
  ]

  // Duplicate array for seamless infinite scroll
  const infiniteReviews = [...reviews, ...reviews]

  return (
    <section className="bg-white pt-9 pb-16">
      <div className="text-center mb-12">
            <p className="text-rose-400 text-base font-medium mb-3">
                Sweet Words From
            </p>

            <h2 className="text-5xl font-bold text-gray-800">
                Our Happy Customers
            </h2>

            <p className="text-gray-500 mt-4 max-w-2xl mx-auto">
                Every bite tells a story. Here’s what our customers say about their
                delightful experience with our handcrafted sweets.
            </p>
        </div>

      <div className="relative w-full">
        <div className="flex animate-scroll gap-8 w-max">

          {infiniteReviews.map((review, index) => (
            <div
              key={index}
              className="min-w-[300px] max-w-[300px] bg-white rounded-3xl shadow-xl p-6
                         transform transition duration-500
                         hover:scale-105 hover:shadow-2xl"
            >
              {/* Photo */}
              <div className="flex items-center gap-4 mb-4">
                <img
                  src={review.img}
                  alt={review.name}
                  className="w-14 h-14 rounded-full object-cover"
                />
                <h4 className="text-lg font-semibold text-gray-800">
                  {review.name}
                </h4>
              </div>

              {/* Review */}
              <p className="text-gray-600 italic leading-relaxed">
                “{review.review}”
              </p>
            </div>
          ))}

        </div>
      </div>
    </section>
  )
}

export default Testimonials