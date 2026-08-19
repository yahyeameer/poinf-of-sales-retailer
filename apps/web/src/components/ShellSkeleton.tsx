import { Skeleton } from "@/components/ui/skeleton";

/**
 * The app frame, without the data.
 *
 * Shell is rendered inside each page and fetches the tenant, so a route-level
 * `loading.tsx` replaces the whole viewport — sidebar included — while the page
 * resolves. If the fallback drew only a bare content skeleton, the chrome would
 * blink out on every navigation. This mirrors Shell's frame exactly (same
 * classes, same 16rem sidebar, same `lg:pl-64` content inset) and is fully
 * synchronous, so it paints instantly and the swap to the real Shell is
 * seamless — only the body changes from skeleton to content.
 *
 * The nav rows are placeholders on purpose: which items show depends on the
 * caller's role, which the fallback cannot know without the fetch it exists to
 * cover.
 */
export function ShellSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar — matches Shell.tsx's aside. */}
      <aside className="hidden border-r border-border glass lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col">
        <div className="border-b border-border px-5 py-5">
          <div className="text-sm font-bold tracking-tight text-gradient">AI POS</div>
          <Skeleton className="mt-1.5 h-3 w-28" />
        </div>

        {/* Location switcher */}
        <div className="px-3 pt-3">
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <nav className="flex flex-col gap-5">
            {[5, 4].map((count, g) => (
              <div key={g} className="flex flex-col gap-1.5">
                <Skeleton className="mx-3 h-2.5 w-14" />
                {Array.from({ length: count }, (_, i) => (
                  <Skeleton key={i} className="h-9 w-full rounded-lg" />
                ))}
              </div>
            ))}
          </nav>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2.5 w-12" />
          </div>
          <Skeleton className="size-8 rounded-lg" />
        </div>
      </aside>

      {/* Phone top bar — matches Shell.tsx's header. */}
      <header className="sticky top-0 z-30 border-b border-border glass lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-gradient">AI POS</div>
            <Skeleton className="mt-1 h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="size-8 rounded-lg" />
        </div>
      </header>

      <main className="lg:pl-64">
        <div className="px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:py-8 lg:pb-8">{children}</div>
      </main>
    </div>
  );
}
