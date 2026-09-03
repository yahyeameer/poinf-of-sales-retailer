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
  Warehouse,
} from "lucide-react";

// This build of lucide-react exports LucideIcon as a namespace, not a type, so
// importing it as one fails. The component type is what we actually need.
export type IconComponent = React.ComponentType<{ className?: string }>;

export type ShopRole = "owner" | "manager" | "cashier";
export type LocationKind = "shop" | "warehouse" | "van";

/**
 * Everything a route decision needs, and nothing a route decision doesn't.
 *
 * Deliberately not the whole `TenantContext`: this module is imported by client
 * components, and `TenantContext` reaches into `next/headers`. `navAccess()` in
 * `@/lib/tenant` is the one place that narrows one to the other.
 */
export interface NavAccess {
  role: ShopRole;
  /** Kind of the location the user is currently acting at. Null when unset. */
  locationKind: LocationKind | null;
  /** True when staff are tied to one location and cannot switch away from it. */
  pinnedToLocation: boolean;
}

export interface NavItem {
  href: string;
  label: string;
  icon: IconComponent;
  /** Hidden from cashiers. */
  managerOnly?: boolean;
  /**
   * A selling-floor screen. Hidden from someone standing in a warehouse, where
   * there is no drawer, no customer and — because sales are location-scoped by
   * RLS — no rows either. Without this they render as blank pages that look
   * broken rather than as screens that don't apply.
   */
  sellingFloor?: boolean;
  /** The warehouse dashboard. Only meaningful when you are in a warehouse. */
  warehouseOnly?: boolean;
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
    items: [{ href: "/till", label: "Till", icon: ScanLine, sellingFloor: true }],
  },
  {
    title: "Main",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, sellingFloor: true },
      { href: "/warehouse", label: "Warehouse", icon: Warehouse, warehouseOnly: true },
      { href: "/catalog", label: "Catalog", icon: Package },
      { href: "/stock", label: "Stock Ledger", icon: ClipboardList },
      { href: "/analytics", label: "Analytics", icon: BarChart3, sellingFloor: true },
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
      { href: "/receipts", label: "Receipts", icon: ReceiptText, sellingFloor: true },
      { href: "/reports/weekly", label: "Weekly Report", icon: CalendarRange, sellingFloor: true },
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

/**
 * The warehouse counterpart of the two above. A picker in a warehouse has no
 * drawer to open, so the raised centre slot — the one built to be hit without
 * looking — goes to the thing they do all day instead.
 */
export const WAREHOUSE_TAB_BAR_ITEMS: NavItem[] = [
  { href: "/warehouse", label: "Home", icon: Warehouse },
  { href: "/catalog", label: "Catalog", icon: Package },
  { href: "/stock", label: "Stock", icon: ClipboardList },
];

export const WAREHOUSE_PRIMARY_ITEM: NavItem = {
  href: "/transfers",
  label: "Move",
  icon: ArrowLeftRight,
};

/** "/" would otherwise prefix-match every route and light up permanently. */
export function isRouteActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * Where "home" is for this user.
 *
 * Only a *pinned* warehouse user is sent to `/warehouse`. An owner who has
 * flipped the location switcher to the warehouse is still an owner looking at
 * the shop's numbers, and bouncing them off `/` would leave them no way back to
 * the retail dashboard without switching the location again.
 */
export function dashboardHref(access: NavAccess | null): "/" | "/warehouse" {
  if (access?.pinnedToLocation && access.locationKind === "warehouse") return "/warehouse";
  return "/";
}

const ITEM_BY_HREF: ReadonlyMap<string, NavItem> = new Map(
  [
    ...NAV_GROUPS.flatMap((g) => g.items),
    ...TAB_BAR_ITEMS,
    ...WAREHOUSE_TAB_BAR_ITEMS,
    TILL_ITEM,
    WAREHOUSE_PRIMARY_ITEM,
  ].map((item) => [item.href, item]),
);

/**
 * Whether this user should be offered this route.
 *
 * This is presentation, not enforcement: RLS and the RPCs' role checks are what
 * actually stop a cashier reading another shop's takings, and they run whether
 * or not this function is consulted. What it buys is that the app never links
 * somewhere that will refuse the person following the link.
 *
 * A route with no entry here is open. Gating something requires saying so in
 * `NAV_GROUPS`, so a new page can't be quietly hidden from everyone by
 * forgetting to list it.
 */
export function canAccessRoute(href: string, access: NavAccess | null): boolean {
  const item = ITEM_BY_HREF.get(href);
  if (!item) return true;

  // Signed out, on one of the preview pages. Show the least-privileged shape
  // rather than nothing: an empty sidebar makes the demo look broken, and the
  // preview has no real rows behind any of these links anyway.
  const { role, locationKind, pinnedToLocation } = access ?? {
    role: "cashier" as const,
    locationKind: null,
    pinnedToLocation: false,
  };

  if (item.managerOnly && role === "cashier") return false;

  const inWarehouse = locationKind === "warehouse";
  if (item.sellingFloor && inWarehouse && pinnedToLocation) return false;
  if (item.warehouseOnly && !inWarehouse) return false;

  return true;
}

/** The nav tree with everything this user can't reach removed. */
export function accessibleGroups(access: NavAccess | null): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccessRoute(item.href, access)),
  })).filter((group) => group.items.length > 0);
}
