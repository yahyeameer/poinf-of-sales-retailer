import Link from "next/link";

import { LocationSwitcher } from "@/components/LocationSwitcher";
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
  const isOwner = ctx?.role === "owner";
  const isManager = isOwner || ctx?.role === "manager";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">AI POS</div>
        <div className="shop-name">{shopName}</div>

        {ctx && (
          <LocationSwitcher
            locations={ctx.locations}
            activeId={ctx.locationId}
            pinned={ctx.pinnedToLocation}
          />
        )}

        <nav>
          <div className="nav-group-title">SELL</div>
          <Link href="/till" className="nav-primary">Till</Link>

          <div className="nav-group-title" style={{ marginTop: "14px" }}>MAIN</div>
          <Link href="/">Dashboard</Link>
          <Link href="/catalog">Catalog</Link>
          <Link href="/stock">Stock Ledger</Link>
          <Link href="/analytics">Analytics</Link>

          <div className="nav-group-title" style={{ marginTop: "14px" }}>WAREHOUSE</div>
          <Link href="/locations">Locations</Link>
          {isManager && <Link href="/transfers">Transfers</Link>}
          {isManager && <Link href="/stocktake">Stocktake</Link>}

          <div className="nav-group-title" style={{ marginTop: "14px" }}>TOOLS</div>
          <Link href="/inventory/import">CSV Import</Link>
          <Link href="/barcode">Barcode Studio</Link>
          <Link href="/receipts">Receipts</Link>
          <Link href="/reports/weekly">Weekly Report</Link>

          <div className="nav-group-title" style={{ marginTop: "14px" }}>ADMIN</div>
          <Link href="/staff">Staff</Link>
          <Link href="/settings">Settings</Link>
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
