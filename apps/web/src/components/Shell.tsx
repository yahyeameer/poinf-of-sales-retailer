import Link from "next/link";

export function Shell({
  shopName,
  children,
}: {
  shopName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">AI POS</div>
        <div className="shop-name">{shopName}</div>

        <nav>
          <div className="nav-group-title">MAIN</div>
          <Link href="/">Dashboard</Link>
          <Link href="/catalog">Catalog</Link>
          <Link href="/stock">Stock Ledger</Link>
          <Link href="/analytics">Analytics</Link>

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
