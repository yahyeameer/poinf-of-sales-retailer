"use client";

import { useState } from "react";
import { formatMoney } from "@ai-pos/shared";

interface Product {
  id: string;
  name: string;
  barcode: string | null;
  price_cents: number;
}

export function BarcodeClient({
  initialProducts,
  currency,
}: {
  initialProducts: Product[];
  currency: string;
}) {
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(
    initialProducts.map((p) => p.id)
  );

  function toggleProduct(id: string) {
    if (selectedProductIds.includes(id)) {
      setSelectedProductIds(selectedProductIds.filter((pId) => pId !== id));
    } else {
      setSelectedProductIds([...selectedProductIds, id]);
    }
  }

  const selectedProducts = initialProducts.filter((p) => selectedProductIds.includes(p.id));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Barcode Label Studio</h1>
          <p className="subtitle">Generate standard barcode labels for thermal printers (58mm / 80mm roll).</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          style={{ width: "auto", marginTop: 0 }}
        >
          🖨️ Print Selected Labels
        </button>
      </div>

      <section className="panel" style={{ padding: "16px" }}>
        <h2 style={{ fontSize: "15px", marginTop: 0 }}>Select Products to Print</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {initialProducts.map((p) => {
            const isSelected = selectedProductIds.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className="chip-button"
                style={{
                  borderColor: isSelected ? "var(--accent)" : "var(--border)",
                  color: isSelected ? "var(--accent)" : "var(--muted)",
                  fontWeight: isSelected ? "600" : "400",
                }}
                onClick={() => toggleProduct(p.id)}
              >
                {isSelected ? "✓ " : ""}{p.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel" style={{ padding: "20px" }}>
        <header style={{ marginBottom: "16px", padding: 0, border: "none" }}>
          <span>Print Preview Grid ({selectedProducts.length} Labels)</span>
        </header>

        {selectedProducts.length === 0 ? (
          <p className="empty">No products selected for barcode printing.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "16px",
            }}
          >
            {selectedProducts.map((p) => (
              <div
                key={p.id}
                style={{
                  border: "2px dashed var(--border)",
                  borderRadius: "8px",
                  padding: "16px",
                  textAlign: "center",
                  background: "#ffffff",
                  color: "#000000",
                }}
              >
                <div style={{ fontSize: "14px", fontWeight: "700" }}>{p.name}</div>
                <div style={{ fontSize: "16px", fontWeight: "800", margin: "4px 0", color: "var(--accent)" }}>
                  {formatMoney(p.price_cents, currency)}
                </div>

                {/* Visual Barcode Pattern Representation */}
                <div
                  style={{
                    height: "36px",
                    margin: "10px 0 6px",
                    background:
                      "repeating-linear-gradient(90deg, #000 0, #000 3px, #fff 3px, #fff 6px, #000 6px, #000 8px, #fff 8px, #fff 12px)",
                    borderRadius: "2px",
                  }}
                />
                <code style={{ fontSize: "11px", letterSpacing: "1px", color: "#333" }}>
                  {p.barcode || "NO-BARCODE"}
                </code>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
