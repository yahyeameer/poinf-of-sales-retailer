import { LocationSwitcher } from "@/components/LocationSwitcher";
import { SidebarNav } from "@/components/SidebarNav";
import { getTenantContext } from "@/lib/tenant";

/**
 * Async on purpose: the switcher needs the caller's locations, and every page
 * already renders this. Fetching the context here rather than threading it
 * through fourteen call sites keeps `<Shell shopName={...}>` working unchanged,
 * including on the signed-out preview pages where there is no context at all.
 */
export async function Shell({
  shopName,
  children,
}: {
  shopName: string;
  children: React.ReactNode;
}) {
  const ctx = await getTenantContext();
  const isManager = ctx?.role === "owner" || ctx?.role === "manager";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Fixed rather than sticky: the till's cart scrolls independently and a
          sticky sidebar would drift with it. Hidden below lg, where the nav
          moves to the scrollable strip underneath. */}
      <aside
        className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:flex-col
                   border-r border-slate-200 bg-white
                   dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="px-5 py-5 border-b border-slate-100 dark:border-slate-800">
          <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-50">
            AI POS
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {shopName}
          </div>
        </div>

        {ctx && (
          <div className="px-3 pt-3">
            <LocationSwitcher
              locations={ctx.locations}
              activeId={ctx.locationId}
              pinned={ctx.pinnedToLocation}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav isManager={isManager} />
        </div>

        {ctx && (
          <div className="border-t border-slate-100 px-5 py-3 dark:border-slate-800">
            <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">
              {ctx.userName}
            </div>
            <div className="text-[11px] capitalize text-slate-400">{ctx.role}</div>
          </div>
        )}
      </aside>

      {/* Below lg the same nav becomes a horizontally scrollable strip. A drawer
          would be tidier but needs state and a trap; on a shop phone the till is
          the only screen that matters and this keeps it one tap away. */}
      <div className="lg:hidden sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 dark:text-slate-50">AI POS</div>
            <div className="truncate text-xs text-slate-500">{shopName}</div>
          </div>
          {ctx && (
            <div className="shrink-0">
              <LocationSwitcher
                locations={ctx.locations}
                activeId={ctx.locationId}
                pinned={ctx.pinnedToLocation}
              />
            </div>
          )}
        </div>
        <div className="overflow-x-auto px-2 pb-2 [&_nav]:flex-row [&_nav]:gap-3 [&_nav>div]:flex-row [&_nav>div]:items-center [&_nav>div>div]:hidden">
          <SidebarNav isManager={isManager} />
        </div>
      </div>

      <main className="lg:pl-64">
        <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
