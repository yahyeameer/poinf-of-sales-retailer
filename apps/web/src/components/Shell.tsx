import { LocationSwitcher } from "@/components/LocationSwitcher";
import { MobileTabBar } from "@/components/MobileTabBar";
import { SidebarNav } from "@/components/SidebarNav";
import { ThemeToggle } from "@/components/ThemeToggle";
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
    <div className="min-h-screen bg-background">
      {/* Fixed rather than sticky: the till's cart scrolls independently and a
          sticky sidebar would drift with it. Hidden below lg, where navigation
          moves to the bottom tab bar. */}
      <aside className="hidden border-r border-border glass lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col">
        <div className="border-b border-border px-5 py-5">
          <div className="text-sm font-bold tracking-tight text-gradient">AI POS</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{shopName}</div>
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

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          {ctx ? (
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground/85">{ctx.userName}</div>
              <div className="text-[11px] capitalize text-muted-foreground">{ctx.role}</div>
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground">Signed out</span>
          )}
          <ThemeToggle />
        </div>
      </aside>

      {/* Phone top bar. Identity and the two controls that change what the
          whole app is showing; everything navigational is at the bottom, in
          reach of a thumb. */}
      <header className="sticky top-0 z-30 border-b border-border glass lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-gradient">AI POS</div>
            <div className="truncate text-xs text-muted-foreground">{shopName}</div>
          </div>
          {ctx && (
            <div className="min-w-0 max-w-[45%] shrink">
              <LocationSwitcher
                locations={ctx.locations}
                activeId={ctx.locationId}
                pinned={ctx.pinnedToLocation}
              />
            </div>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="lg:pl-64">
        {/* pb-24 clears the fixed tab bar, which would otherwise sit on top of
            the last row of any list. */}
        <div className="px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:py-8 lg:pb-8">{children}</div>
      </main>

      <MobileTabBar isManager={isManager} />
    </div>
  );
}
