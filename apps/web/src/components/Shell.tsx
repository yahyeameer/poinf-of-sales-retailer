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
          <Link href="/">Dashboard</Link>
          <Link href="/catalog">Catalog</Link>
          <Link href="/stock">Stock</Link>
          <Link href="/staff">Staff</Link>
          <Link href="/settings">Settings</Link>
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
