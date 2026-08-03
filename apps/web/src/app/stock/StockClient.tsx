"use client";

import { useState } from "react";

interface Movement {
  id: string;
  product_id: string;
  change: number;
  reason: string;
  created_at: string;
  products?: { name?: string } | { name?: string }[] | null;
}

interface LowStockItem {
  product_id: string;
  name: string;
  stock_on_hand: number;
  reorder_point: number;
}

interface ProductOption {
  id: string;
  name: string;
  stock_on_hand: number;
}

export function StockClient({
  initialMovements,
  lowStock,
  products,
}: {
  initialMovements: Movement[];
  lowStock: LowStockItem[];
  products: ProductOption[];
}) {
  const [movements, setMovements] = useState<Movement[]>(initialMovements);
  const [showModal, setShowModal] = useState(false);

  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id ?? "");
  const [change, setChange] = useState("10");
  const [reason, setReason] = useState("Restock");

  function handleAdjustStock(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProductId || !change) return;

    const prod = products.find((p) => p.id === selectedProductId);
    const newMov: Movement = {
      id: crypto.randomUUID(),
      product_id: selectedProductId,
      change: parseInt(change, 10) || 0,
      reason,
      created_at: new Date().toISOString(),
      products: { name: prod?.name ?? "Selected Product" },
    };

    setMovements([newMov, ...movements]);
    setShowModal(false);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Stock & Inventory Ledger</h1>
          <p className="subtitle">Track real-time inventory balances and append-only movement logs.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          style={{ width: "auto", marginTop: 0 }}
        >
          + Record Stock Adjustment
        </button>
      </div>

      <section className="panel">
        <header>
          <span>Stock Alerts & Low Balances</span>
          <span className="hint">{lowStock.length} item(s) require attention</span>
        </header>

        {lowStock.length === 0 ? (
          <p className="empty">All products have healthy stock levels above reorder points.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Stock on Hand</th>
                <th className="num">Reorder Point</th>
                <th>Alert Status</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((item) => (
                <tr key={item.product_id}>
                  <td style={{ fontWeight: 550 }}>{item.name}</td>
                  <td className="num">{Number(item.stock_on_hand)}</td>
                  <td className="num">{Number(item.reorder_point)}</td>
                  <td>
                    {Number(item.stock_on_hand) <= 0 ? (
                      <span className="pill danger">Out of Stock</span>
                    ) : (
                      <span className="pill warn">Reorder Recommended</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <header>
          <span>Recent Stock Movements (Ledger Log)</span>
        </header>

        {movements.length === 0 ? (
          <p className="empty">No stock movements recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Product</th>
                <th className="num">Change</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const prodName = Array.isArray(m.products)
                  ? m.products[0]?.name
                  : (m.products as { name?: string } | null)?.name ?? "Unknown product";
                const changeNum = Number(m.change);
                return (
                  <tr key={m.id}>
                    <td>{new Date(m.created_at).toLocaleString()}</td>
                    <td>{prodName}</td>
                    <td
                      className="num"
                      style={{
                        color: changeNum > 0 ? "var(--accent)" : "var(--danger)",
                        fontWeight: 600,
                      }}
                    >
                      {changeNum > 0 ? `+${changeNum}` : changeNum}
                    </td>
                    <td>
                      <span className="pill">{m.reason}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {showModal && (
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
            onSubmit={handleAdjustStock}
            style={{
              background: "var(--surface)",
              padding: "24px",
              borderRadius: "var(--radius)",
              width: "100%",
              maxWidth: "400px",
              border: "1px solid var(--border)",
            }}
          >
            <h2 style={{ fontSize: "18px", marginTop: 0 }}>Record Stock Adjustment</h2>

            <label>Select Product</label>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: "7px",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
              }}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (Current: {p.stock_on_hand})
                </option>
              ))}
            </select>

            <label>Quantity Change (+ for add, - for remove)</label>
            <input
              type="number"
              required
              value={change}
              onChange={(e) => setChange(e.target.value)}
            />

            <label>Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: "7px",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
              }}
            >
              <option value="Restock">Restock / Supplier Delivery</option>
              <option value="Inventory Count">Inventory Audit Count</option>
              <option value="Damaged / Expired">Damaged / Expired Stock</option>
              <option value="Return">Customer Return</option>
            </select>

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button type="submit">Submit Adjustment</button>
              <button
                type="button"
                onClick={() => setShowModal(false)}
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
