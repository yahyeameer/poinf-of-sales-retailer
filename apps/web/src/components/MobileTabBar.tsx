"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { NavIcon } from "@/components/NavIcon";
import { SidebarNav } from "@/components/SidebarNav";
import {
  TAB_BAR_ITEMS,
  TILL_ITEM,
  WAREHOUSE_PRIMARY_ITEM,
  WAREHOUSE_TAB_BAR_ITEMS,
  isRouteActive,
  type NavAccess,
  type NavItem,
} from "@/components/nav-items";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * The phone navigation. Replaces a horizontally scrolling strip of fourteen
 * links, which put the one screen staff actually open — the till — behind a
 * sideways scroll they had to discover.
 *
 * Five slots, thumb-height, with Till raised and lit in the centre. Everything
 * else lives behind More, which is a bottom sheet rather than a drawer because
 * a shop phone is held one-handed and the top of the screen is out of reach.
 */
export function MobileTabBar({ access }: { access: NavAccess | null }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);

  // Someone pinned to a warehouse has no drawer and no customer, so the raised
  // slot goes to transfers instead of the till and "Home" points at the
  // warehouse dashboard. Everyone else gets the layout they had.
  const inWarehouse = access?.pinnedToLocation && access.locationKind === "warehouse";
  const tabs: NavItem[] = inWarehouse ? WAREHOUSE_TAB_BAR_ITEMS : TAB_BAR_ITEMS;
  const primary: NavItem = inWarehouse ? WAREHOUSE_PRIMARY_ITEM : TILL_ITEM;

  const primaryActive = isRouteActive(pathname, primary.href);
  const PrimaryIcon = primary.icon;

  return (
    <>
      <nav
        aria-label="Primary"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 lg:hidden",
          "border-t border-border glass lit-edge safe-b",
        )}
      >
        <div className="grid grid-cols-5 items-end px-1 pt-1">
          {tabs.slice(0, 2).map((item) => (
            <TabLink key={item.href} item={item} pathname={pathname} />
          ))}

          {/* Raised, glowing, and centre — the till is the reason the app is
              open at all, and it should be hittable without looking. */}
          <div className="flex justify-center">
            <Link
              href={primary.href as never}
              aria-current={primaryActive ? "page" : undefined}
              className={cn(
                "-mt-6 flex size-14 flex-col items-center justify-center gap-0.5 rounded-full",
                "bg-linear-to-b from-primary-bright to-primary text-primary-foreground",
                "shadow-[var(--glow-btn)] transition-all duration-200",
                "active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                primaryActive && "shadow-[var(--glow-btn-hover)]",
              )}
            >
              <NavIcon icon={PrimaryIcon} className="size-5" />
              <span className="text-[10px] font-bold leading-none">{primary.label}</span>
            </Link>
          </div>

          {tabs.slice(2).map((item) => (
            <TabLink key={item.href} item={item} pathname={pathname} />
          ))}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2",
              "text-muted-foreground transition-colors active:scale-95 active:bg-muted",
              "hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              moreOpen && "text-primary",
            )}
          >
            <Menu className="size-5" />
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="gap-3">
          <SheetHeader>
            <SheetTitle>All screens</SheetTitle>
            <SheetDescription>Everything not on the tab bar.</SheetDescription>
          </SheetHeader>
          {/* Closing on navigate is manual: Radix has no idea a Link inside it
              changed the route, and the sheet would otherwise stay open over
              the page it just opened. */}
          <SidebarNav access={access} onNavigate={() => setMoreOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function TabLink({
  item,
  pathname,
}: {
  item: NavItem;
  pathname: string | null;
}) {
  const active = isRouteActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href as never}
      aria-current={active ? "page" : undefined}
      className={cn(
        // 44px minimum, and the press feedback matters more here than on
        // desktop: a thumb covers the icon it just hit.
        "flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2",
        "transition-colors active:scale-95 active:bg-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <NavIcon
        icon={Icon}
        className={cn("size-5", active && "drop-shadow-[0_0_6px_rgb(var(--glow-rgb)/0.7)]")}
      />
      <span className={cn("text-[10px] leading-none", active ? "font-bold" : "font-medium")}>
        {item.label}
      </span>
    </Link>
  );
}
