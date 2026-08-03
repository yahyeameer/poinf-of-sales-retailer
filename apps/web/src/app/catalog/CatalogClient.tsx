"use client";

import { useState } from "react";
import { formatMoney } from "@ai-pos/shared";

interface Product {
  id: string;
  name: string;
  barcode: string | null;
  price_cents: number;
  stock_on_hand: number;
  reorder_point: number;
  is_archived: boolean;
}

export function CatalogClient({
  initialProducts,
  currency,
}: {
  initialProducts: Product[];
  currency: string;
}) {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "low" | "archived">("all");
  const [showAddModal, setShowAddModal] = useState(false);

  // New Product Form State
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("10");
  const [reorder, setReorder] = useState("5");

  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode && p.barcode.includes(search));

    if (!matchesSearch) return false;
    if (filter === "active") return !p.is_archived;
    if (filter === "archived") return p.is_archived;
    if (filter === "low") return p.stock_on_hand <= p.reorder_point;
    return true;
  });

  function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !price) return;

    const priceCents = Math.round(parseFloat(price) * 100);
    const newProd: Product = {
      id: crypto.randomUUID(),
      name,
      barcode: barcode.trim() || null,
      price_cents: priceCents,
      stock_on_hand: parseInt(stock, 10) || 0,
      reorder_point: parseInt(reorder, 10) || 5,
      is_archived: false,
    };

    setProducts([newProd, ...products]);
    setName("");
    setBarcode("");
    setPrice("");
    setShowAddModal(false);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Product Catalog</h1>
          <p className="subtitle">Manage products, prices, barcodes, and inventory thresholds.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          style={{ width: "auto", marginTop: 0 }}
        >
          + Add Product
        </button>
      </div>

      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search by product name or barcode..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: "320px" }}
        />
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {(["all", "active", "low", "archived"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className="chip-button"
              style={{
                borderColor: filter === f ? "var(--accent)" : "var(--border)",
                color: filter === f ? "var(--accent)" : "var(--muted)",
                fontWeight: filter === f ? "600" : "400",
              }}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <section className="panel">
        <header>
          <span>
            {filter.toUpperCase()} Products ({filteredProducts.length})
          </span>
        </header>

        {filteredProducts.length === 0 ? (
          <p className="empty">No matching products found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Barcode</th>
                <th className="num">Price</th>
                <th className="num">Stock on Hand</th>
                <th className="num">Reorder Point</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 550 }}>{p.name}</td>
                  <td>
                    <code>{p.barcode ?? "—"}</code>
                  </td>
                  <td className="num">{formatMoney(p.price_cents, currency)}</td>
                  <td className="num">{p.stock_on_hand}</td>
                  <td className="num">{p.reorder_point}</td>
                  <td>
                    {p.is_archived ? (
                      <span className="pill danger">Archived</span>
                    ) : p.stock_on_hand <= p.reorder_point ? (
                      <span className="pill warn">Low Stock</span>
                    ) : (
                      <span className="pill">Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showAddModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "grid",
            placeItems: "center",
            zIndex: 100,
          }}
        >
          <form
            onSubmit={handleAddProduct}
            style={{
              background: "var(--surface)",
              padding: "24px",
              borderRadius: "var(--radius)",
              width: "100%",
              maxWidth: "400px",
              border: "1px solid var(--border)",
            }}
          >
            <h2 style={{ fontSize: "18px", marginTop: 0 }}>Add New Product</h2>
            <label>Product Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Fresh Milk 1L"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <label>Barcode (Optional)</label>
            <input
              type="text"
              placeholder="e.g. 600123456789"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />

            <label>Selling Price ({currency})</label>
            <input
              type="number"
              step="0.01"
              required
              placeholder="2.50"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label>Stock on Hand</label>
                <input
                  type="number"
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                />
              </div>
              <div>
                <label>Reorder Point</label>
                <input
                  type="number"
                  value={reorder}
                  onChange={(e) => setReorder(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button type="submit">Save Product</button>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
