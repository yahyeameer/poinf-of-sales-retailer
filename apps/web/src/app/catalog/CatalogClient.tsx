"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@ai-pos/shared";

import { createProduct } from "@/app/actions";
import { DemoBanner } from "@/components/DemoBanner";

export interface Product {
  id: string;
  name: string;
  barcode: string | null;
  price_cents: number;
  stock_on_hand: number;
  reorder_point: number;
  is_active: boolean;
}

export function CatalogClient({
  initialProducts,
  currency,
  canEdit,
  demoReason,
}: {
  initialProducts: Product[];
  currency: string;
  canEdit: boolean;
  demoReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "low" | "archived">("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("10");
  const [reorder, setReorder] = useState("5");

  const filteredProducts = initialProducts.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode && p.barcode.includes(search));

    if (!matchesSearch) return false;
    if (filter === "active") return p.is_active;
    if (filter === "archived") return !p.is_active;
    if (filter === "low") return Number(p.stock_on_hand) <= Number(p.reorder_point);
    return true;
  });

  function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    const priceValue = parseFloat(price);
    if (!name.trim() || !Number.isFinite(priceValue)) return;

    setNotice(null);
    startTransition(async () => {
      const result = await createProduct({
        name,
        barcode: barcode.trim() || null,
        priceCents: Math.round(priceValue * 100),
        openingStock: parseInt(stock, 10) || 0,
        reorderPoint: parseInt(reorder, 10) || 5,
      });

      setNotice(result);
      if (result.ok) {
        setName("");
        setBarcode("");
        setPrice("");
        setShowAddModal(false);
        // The list is server-rendered; pull it again so the new row is the one
        // the database actually holds, not an optimistic guess at it.
        router.refresh();
      }
    });
  }

  return (
    <div>
      {demoReason && <DemoBanner reason={demoReason} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Product Catalog</h1>
          <p className="subtitle">Manage products, prices, barcodes, and inventory thresholds.</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => { setNotice(null); setShowAddModal(true); }}
            style={{ width: "auto", marginTop: 0 }}
          >
            + Add Product
          </button>
        )}
      </div>

      {notice && !showAddModal && (
        <div className={notice.ok ? "notice success" : "notice"}>{notice.message}</div>
      )}

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
              aria-pressed={filter === f}
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
                  <td className="num">{Number(p.stock_on_hand)}</td>
                  <td className="num">{Number(p.reorder_point)}</td>
                  <td>
                    {!p.is_active ? (
                      <span className="pill danger">Archived</span>
                    ) : Number(p.stock_on_hand) <= Number(p.reorder_point) ? (
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
        <div className="modal-backdrop">
          <form onSubmit={handleAddProduct} className="modal">
            <h2 style={{ fontSize: "18px", marginTop: 0 }}>Add New Product</h2>

            <label htmlFor="p-name">Product Name</label>
            <input
              id="p-name"
              type="text"
              required
              placeholder="e.g. Fresh Milk 1L"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <label htmlFor="p-barcode">Barcode (Optional)</label>
            <input
              id="p-barcode"
              type="text"
              placeholder="e.g. 600123456789"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />

            <label htmlFor="p-price">Selling Price ({currency})</label>
            <input
              id="p-price"
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="2.50"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label htmlFor="p-stock">Opening Stock</label>
                <input
                  id="p-stock"
                  type="number"
                  min="0"
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="p-reorder">Reorder Point</label>
                <input
                  id="p-reorder"
                  type="number"
                  min="0"
                  value={reorder}
                  onChange={(e) => setReorder(e.target.value)}
                />
              </div>
            </div>

            {notice && !notice.ok && <div className="notice">{notice.message}</div>}

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save Product"}
              </button>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                disabled={pending}
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
