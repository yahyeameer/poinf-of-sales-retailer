import { Skeleton } from "@/components/ui/skeleton";

/** Title + one-line description — the header every screen opens with. */
function HeaderSkeleton() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

/** A card holding a table: header strip plus rows. Mirrors the list screens. */
function TableCardSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between border-b border-border p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-28 sm:block" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The default for a list/table screen — catalog, stock, receipts, staff, and
 * the rest. A search/action row over a table card.
 */
export function ListPageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <HeaderSkeleton />
        <Skeleton className="h-10 w-full rounded-lg sm:w-40" />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <Skeleton className="h-8 w-56 rounded-lg" />
      </div>
      <TableCardSkeleton />
    </div>
  );
}

/** The dashboard: KPI tiles, the charts row, then the two panels. */
export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <HeaderSkeleton />
        <Skeleton className="h-8 w-44 rounded-lg" />
      </div>

      <Skeleton className="h-28 w-full rounded-xl" />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}
