"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { recordStockAdjustment, type AdjustmentReason } from "@/app/actions";
import { DemoBanner } from "@/components/DemoBanner";

export interface Movement {
  id: string;
  product_id: string;
  delta: number;
  reason: string;
  note: string | null;
  created_at: string;
  products?: { name?: string } | { name?: string }[] | null;
}

export interface LowStockItem {
  product_id: string;
  name: string;
  stock_on_hand: number;
  reorder_point: number;
}

export interface ProductOption {
  id: string;
  name: string;
  stock_on_hand: number;
}

const REASON_OPTIONS: { value: AdjustmentReason; label: string }[] = [
  { value: "restock", label: "Restock / Supplier Delivery" },
  { value: "stocktake", label: "Inventory Audit Count" },
  { value: "damaged", label: "Damaged / Expired Stock" },
  { value: "return", label: "Customer Return" },
];

const REASON_LABELS: Record<string, string> = {
  sale: "Sale",
  restock: "Restock",
  adjustment: "Adjustment",
  void: "Voided sale",
  stocktake: "Stocktake",
};

export function StockClient({
  initialMovements,
  lowStock,
  products,
  currency,
  canEdit,
  demoReason,
}: {
  initialMovements: Movement[];
  lowStock: LowStockItem[];
  products: ProductOption[];
  currency: string;
  canEdit: boolean;
  demoReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [showModal, setShowModal] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id ?? "");
  const [change, setChange] = useState("10");
  const [reason, setReason] = useState<AdjustmentReason>("restock");
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");

  function handleAdjustStock(e: React.FormEvent) {
    e.preventDefault();
    const delta = parseFloat(change);
    if (!selectedProductId || !Number.isFinite(delta)) return;

    setNotice(null);
    startTransition(async () => {
      const cost = parseFloat(unitCost);
      const result = await recordStockAdjustment({
        productId: selectedProductId,
        delta,
        reason,
        unitCostCents: Number.isFinite(cost) ? Math.round(cost * 100) : null,
        note: note.trim() || null,
      });

      setNotice(result);
      if (result.ok) {
        setShowModal(false);
        setNote("");
        setUnitCost("");
        router.refresh();
      }
    });
  }

  return (
    <div>
      {demoReason && <DemoBanner reason={demoReason} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Stock &amp; Inventory Ledger</h1>
          <p className="subtitle">Track real-time inventory balances and append-only movement logs.</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => { setNotice(null); setShowModal(true); }}
            style={{ width: "auto", marginTop: 0 }}
          >
            + Record Stock Adjustment
          </button>
        )}
      </div>

      {notice && !showModal && (
        <div className={notice.ok ? "notice success" : "notice"}>{notice.message}</div>
      )}

      <section className="panel">
        <header>
          <span>Stock Alerts &amp; Low Balances</span>
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
          <span className="hint">append-only</span>
        </header>

        {initialMovements.length === 0 ? (
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
              {initialMovements.map((m) => {
                const prodName = Array.isArray(m.products)
                  ? m.products[0]?.name
                  : (m.products as { name?: string } | null)?.name ?? "Unknown product";
                const delta = Number(m.delta);
                return (
                  <tr key={m.id}>
                    <td>{new Date(m.created_at).toLocaleString()}</td>
                    <td>{prodName}</td>
                    <td
                      className="num"
                      style={{
                        color: delta > 0 ? "var(--accent)" : "var(--danger)",
                        fontWeight: 600,
                      }}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </td>
                    <td>
                      <span className="pill">{REASON_LABELS[m.reason] ?? m.reason}</span>
                      {m.note && <span className="hint" style={{ marginLeft: 8 }}>{m.note}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {showModal && (
        <div className="modal-backdrop">
          <form onSubmit={handleAdjustStock} className="modal">
            <h2 style={{ fontSize: "18px", marginTop: 0 }}>Record Stock Adjustment</h2>

            <label htmlFor="s-product">Select Product</label>
            <select
              id="s-product"
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (Current: {Number(p.stock_on_hand)})
                </option>
              ))}
            </select>

            <label htmlFor="s-reason">Reason</label>
            <select
              id="s-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as AdjustmentReason)}
            >
              {REASON_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>

            <label htmlFor="s-change">
              Quantity change {reason === "restock" ? "(units received)" : "(+ to add, − to remove)"}
            </label>
            <input
              id="s-change"
              type="number"
              step="0.001"
              required
              value={change}
              onChange={(e) => setChange(e.target.value)}
            />

            {reason === "restock" && (
              <>
                <label htmlFor="s-cost">Unit cost paid ({currency})</label>
                <input
                  id="s-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="1.10"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                />
                <p className="hint" style={{ marginTop: 4 }}>
                  Folded into the weighted average cost. The selling price is left alone —
                  you&apos;ll get a warning if margin drops below your minimum.
                </p>
              </>
            )}

            <label htmlFor="s-note">Note (optional)</label>
            <input
              id="s-note"
              type="text"
              placeholder="e.g. crate damaged in transit"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            {notice && !notice.ok && <div className="notice">{notice.message}</div>}

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button type="submit" disabled={pending}>
                {pending ? "Recording…" : "Submit Adjustment"}
              </button>
              <button
                type="button"
                onClick={() => setShowModal(false)}
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
