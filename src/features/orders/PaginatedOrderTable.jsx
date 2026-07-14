import { useEffect } from "react"
import useOrderFilter from "../../hooks/useOrderFilter"
import Pagination from "../../components/Pagination"
import { Search as SearchIcon } from "lucide-react"

/**
 * Renders one tab's orders: filtered by the shared search term, paginated with
 * its own independent page state, laid out via the supplied `renderItem`.
 *
 * @param {Object} props
 * @param {Object[]} props.orders                 All orders for this tab (unfiltered).
 * @param {string}   props.search                 Shared search term.
 * @param {boolean}  [props.active=true]          Whether this tab is currently visible.
 * @param {(page:number)=>void} [props.onActivePageChange]  Reports page up (for URL sync) while active.
 * @param {(order:Object)=>React.ReactNode} props.renderItem  Renders one order (must set a key).
 * @param {React.ReactNode} [props.emptyState]    Shown when the tab has no orders at all.
 */
export default function PaginatedOrderTable({ orders, search, active = true, onActivePageChange, renderItem, emptyState = null }) {
  const { pagedOrders, total, page, setPage, pageSize, setPageSize } = useOrderFilter(orders, search)

  // Keep the URL/parent in sync with the active tab's page.
  useEffect(() => {
    if (active) onActivePageChange?.(page)
  }, [active, page]) // eslint-disable-line react-hooks/exhaustive-deps

  if (total === 0) {
    // No search matches (but the tab does have orders) → search-empty message.
    if ((orders?.length || 0) > 0) {
      return (
        <div className="flex flex-col items-center justify-center text-center" style={{ border: "2px dashed rgba(204,195,216,0.5)", borderRadius: "32px", padding: "64px 32px", background: "rgba(255,255,255,0.4)", gap: "12px" }}>
          <SearchIcon size={40} style={{ color: "#44474C", opacity: 0.3 }} />
          <p style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: "22px", color: "#1B1C1C" }}>No orders found for your search</p>
          <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "14px", color: "#44474C", opacity: 0.7 }}>Try a different Order ID or customer name.</p>
        </div>
      )
    }
    // Tab genuinely empty → caller-provided empty state.
    return emptyState
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" style={{ gap: "24px" }}>
        {pagedOrders.map((o) => renderItem(o))}
      </div>
      <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </>
  )
}