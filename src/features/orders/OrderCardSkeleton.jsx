import Skeleton from "../../components/Common/Skeleton";

const OrderCardSkeleton = () => {
  return (
    <div className="order-card bg-white rounded-[2rem] p-6 lg:p-8 border border-neutral-100 shadow-[0_15px_30px_-10px_rgba(0,0,0,0.03)] mb-6">
      {/* Header Skeleton */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b border-neutral-50 pb-6">
        <div>
          <Skeleton className="h-3 w-20 mb-2" />
          <Skeleton className="h-6 w-32" />
        </div>
       
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col md:items-end">
            <Skeleton className="h-3 w-12 mb-2" />
            <Skeleton className="h-6 w-24" />
          </div>
          <Skeleton className="h-10 w-28 rounded-full" />
        </div>
      </div>

      {/* Items Skeleton */}
      <div className="space-y-4">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-neutral-50 border border-neutral-100/50">
            <div className="flex items-center gap-4">
              <Skeleton className="w-12 h-12 rounded-xl" />
              <div>
                <Skeleton className="h-4 w-40 mb-2" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            {/* Conditional button skeleton for past orders could go here, but general skeleton is fine */}
          </div>
        ))}
      </div>
    </div>
  );
};

export default OrderCardSkeleton;