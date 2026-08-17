import type * as React from "react";
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

// This build of lucide-react exports LucideIcon as a namespace, not a type, so
// importing it as one fails. The component type is what we actually need.
export type IconComponent = React.ComponentType<{ className?: string }>;

export interface NavItem {
  href: string;
  label: string;
  icon: IconComponent;
  /** Hidden from cashiers. */
  managerOnly?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Single source of truth for navigation. The sidebar, the mobile "More" sheet
 * and the bottom tab bar all read this, so a new route cannot appear in one
 * surface and go missing from another.
 */
export const NAV_GROUPS: NavGroup[] = [
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
 * The four routes on the phone tab bar besides Till, which is handled
 * separately because it is raised and is the reason staff open the app.
 */
export const TAB_BAR_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/catalog", label: "Catalog", icon: Package },
  { href: "/stock", label: "Stock", icon: ClipboardList },
];

export const TILL_ITEM: NavItem = { href: "/till", label: "Till", icon: ScanLine };

/** "/" would otherwise prefix-match every route and light up permanently. */
export function isRouteActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
