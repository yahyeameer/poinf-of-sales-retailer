"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_GROUPS, isRouteActive } from "@/components/nav-items";
import { cn } from "@/lib/utils";

/**
 * Client-side purely so it can read the current path. Nothing else here needs
 * to be, and Shell stays a server component that fetches the tenant once.
 *
 * Shared by the desktop sidebar and the phone "More" sheet — `onNavigate` is
 * how the sheet closes itself once a route is picked.
 */
export function SidebarNav({
  isManager,
  onNavigate,
}: {
  isManager: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => !i.managerOnly || isManager);
        if (items.length === 0) return null;

        return (
          <div key={group.title} className="flex flex-col gap-1">
            <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              {group.title}
            </div>

            {items.map((item) => {
              const active = isRouteActive(pathname, item.href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href as never}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-lg py-2 pl-4 pr-3 text-sm",
                    "transition-[background-color,color,box-shadow] duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    // The lit rail. A flat tint reads as "hovered"; a glowing
                    // edge reads as "you are here", which is the question a
                    // cashier is actually asking mid-shift.
                    "before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px]",
                    "before:-translate-y-1/2 before:rounded-r-full before:transition-all before:duration-200",
                    active
                      ? [
                          "bg-primary-soft font-semibold text-primary",
                          "before:bg-primary before:shadow-[0_0_10px_2px_rgb(var(--glow-rgb)/0.65)]",
                        ]
                      : [
                          "text-muted-foreground hover:bg-muted hover:text-foreground",
                          "before:bg-transparent",
                        ],
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground",
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
