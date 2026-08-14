import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Loading placeholder. `aria-hidden` plus a live-region-free wrapper is
 * deliberate — a screen reader should hear "loading" once from the container
 * that owns the fetch, not a stream of empty boxes.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("shimmer rounded-md", className)} {...props} />;
}

/** The common case: n lines of text, the last one short like real prose. */
function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/5" : "w-full")} />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonText };
