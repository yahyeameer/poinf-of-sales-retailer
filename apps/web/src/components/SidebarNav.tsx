"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Barcode,
  BarChart3,
  Building2,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  LayoutDashboard,
  Package,
  ReceiptText,
  ScanLine,
  Settings,
  Upload,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

// This build of lucide-react exports LucideIcon as a namespace, not a type, so
// importing it as one fails. The component type is what we actually need.
type IconComponent = React.ComponentType<{ className?: string }>;

interface NavItem {
  href: string;
  label: string;
  icon: IconComponent;
  /** Hidden from cashiers. */
  managerOnly?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: "Sell",
    items: [{ href: "/till", label: "Till", icon: ScanLine }],
  },
  {
    title: "Main",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/catalog", label: "Catalog", icon: Package },
      { href: "/stock", label: "Stock Ledger", icon: ClipboardList },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Warehouse",
    items: [
      { href: "/locations", label: "Locations", icon: Building2 },
      { href: "/transfers", label: "Transfers", icon: ArrowLeftRight, managerOnly: true },
      { href: "/stocktake", label: "Stocktake", icon: ClipboardCheck, managerOnly: true },
    ],
  },
  {
    title: "Tools",
    items: [
      { href: "/inventory/import", label: "CSV Import", icon: Upload },
      { href: "/barcode", label: "Barcode Studio", icon: Barcode },
      { href: "/receipts", label: "Receipts", icon: ReceiptText },
      { href: "/reports/weekly", label: "Weekly Report", icon: CalendarRange },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/staff", label: "Staff", icon: Users },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/**
 * Client-side purely so it can read the current path. Nothing else here needs
 * to be, and Shell stays a server component that fetches the tenant once.
 */
export function SidebarNav({ isManager }: { isManager: boolean }) {
  const pathname = usePathname();

  // "/" would otherwise prefix-match every route and light up permanently.
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="flex flex-col gap-5">
      {GROUPS.map((group) => {
        const items = group.items.filter((i) => !i.managerOnly || isManager);
        if (items.length === 0) return null;

        return (
          <div key={group.title} className="flex flex-col gap-1">
            <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
              {group.title}
            </div>

            {items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href as never}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                    active
                      ? "bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400",
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
