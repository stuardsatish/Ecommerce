import { useState } from "react"
import { FiChevronDown } from "react-icons/fi"

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState(null)

  const faqs = [
    {
      question: "Do you offer custom cakes for special occasions?",
      answer:
        "Yes! We create fully customized cakes for birthdays, weddings, and festivals. You can share your design idea and we’ll craft it beautifully."
    },
    {
      question: "How fresh are your sweets?",
      answer:
        "All our sweets are prepared fresh daily using premium quality ingredients to ensure the best taste and hygiene."
    },
    {
      question: "Do you provide home delivery?",
      answer:
        "Yes, we offer home delivery within the city. Same-day delivery is available for selected items."
    },
    {
      question: "Can I place bulk orders for festivals?",
      answer:
        "Absolutely! We accept bulk and corporate gifting orders with special festive packaging options."
    }
  ]

  const toggleFAQ = (index) => {
    setOpenIndex(openIndex === index ? null : index)
  }

  return (
    <section className="bg-white pt-16 pb-20 mx-12">

      {/* Heading */}
      <div className="text-center mb-12">
        <p className="text-rose-400 text-base font-medium mb-3">
            Have Questions?
        </p>

        <h2 className="text-4xl font-bold text-gray-800">
          Frequently Asked Questions
        </h2>

        <p className="text-gray-500 mt-4 max-w-2xl mx-auto">
          Everything you need to know about our sweets, cakes, delivery,
          and custom orders.
        </p>
      </div>

      {/* FAQ Items */}
      <div className="max-w-3xl mx-auto space-y-5 px-6">

        {faqs.map((faq, index) => (
          <div
            key={index}
            className="bg-white border border-gray-200 rounded-2xl shadow-sm transition duration-300"
          >
            <button
              onClick={() => toggleFAQ(index)}
              className="w-full flex justify-between items-center p-5 text-left"
            >
              <span className="text-lg font-medium text-gray-800">
                {faq.question}
              </span>

              <FiChevronDown
                className={`text-2xl text-rose-400 transition-transform duration-300 ${
                  openIndex === index ? "rotate-180" : ""
                }`}
              />
            </button>

            {openIndex === index && (
              <div className="px-5 pb-5 text-gray-600 leading-relaxed">
                {faq.answer}
              </div>
            )}
          </div>
        ))}

      </div>
    </section>
  )
}

export default FAQ