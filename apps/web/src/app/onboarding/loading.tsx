import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-border p-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}
