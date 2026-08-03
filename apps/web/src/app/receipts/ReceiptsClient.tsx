"use client";

import { useState } from "react";
import { formatMoney } from "@ai-pos/shared";

interface ReceiptItem {
  name: string;
  qty: number;
  price_cents: number;
}

interface Receipt {
  id: string;
  created_at: string;
  payment_method: string;
  total_cents: number;
  items: ReceiptItem[];
}

export function ReceiptsClient({
  initialReceipts,
  currency,
  shopName,
}: {
  initialReceipts: Receipt[];
  currency: string;
  shopName: string;
}) {
  const [receipts] = useState<Receipt[]>(initialReceipts);
  const [activeReceipt, setActiveReceipt] = useState<Receipt | null>(null);

  function getWhatsAppShareLink(r: Receipt) {
    const text = `Receipt from ${shopName}\nRef: ${r.id}\nDate: ${new Date(
      r.created_at
    ).toLocaleString()}\nTotal: ${formatMoney(
      r.total_cents,
      currency
    )}\nPayment: ${r.payment_method}\nThank you for shopping with us!`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  return (
    <div>
      <h1>Sales History & Receipts</h1>
      <p className="subtitle">View past customer receipts, generate digital copies, or share via WhatsApp.</p>

      <section className="panel">
        <header>
          <span>Recent Receipts ({receipts.length})</span>
        </header>

        {receipts.length === 0 ? (
          <p className="empty">No sales receipts recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Receipt ID</th>
                <th>Date / Time</th>
                <th>Payment Method</th>
                <th className="num">Total Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.id}</code></td>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>
                    <span className="pill">{r.payment_method}</span>
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {formatMoney(r.total_cents, currency)}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        className="chip-button"
                        onClick={() => setActiveReceipt(r)}
                      >
                        View Receipt
                      </button>
                      <a
                        href={getWhatsAppShareLink(r)}
                        target="_blank"
                        rel="noreferrer"
                        className="chip-button"
                        style={{ textDecoration: "none", color: "#25D366" }}
                      >
                        WhatsApp
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {activeReceipt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "grid",
            placeItems: "center",
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              color: "#000000",
              padding: "24px",
              borderRadius: "var(--radius)",
              width: "100%",
              maxWidth: "340px",
              fontFamily: "monospace",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ textAlign: "center", fontWeight: "700", fontSize: "16px" }}>
              {shopName}
            </div>
            <div style={{ textAlign: "center", fontSize: "12px", color: "#666", marginBottom: "14px" }}>
              Official Sales Receipt
            </div>

            <div style={{ borderTop: "1px dashed #ccc", borderBottom: "1px dashed #ccc", padding: "10px 0", margin: "10px 0" }}>
              {activeReceipt.items.map((item, idx) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                  <span>
                    {item.qty}x {item.name}
                  </span>
                  <span>{formatMoney(item.price_cents * item.qty, currency)}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "700", fontSize: "15px" }}>
              <span>TOTAL</span>
              <span>{formatMoney(activeReceipt.total_cents, currency)}</span>
            </div>

            <div style={{ fontSize: "11px", color: "#666", marginTop: "10px" }}>
              Payment: {activeReceipt.payment_method.toUpperCase()}
              <br />
              Ref: {activeReceipt.id}
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button type="button" onClick={() => window.print()} style={{ flex: 1 }}>
                Print
              </button>
              <button
                type="button"
                onClick={() => setActiveReceipt(null)}
                style={{ flex: 1, background: "#e5e7eb", color: "#374151" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
