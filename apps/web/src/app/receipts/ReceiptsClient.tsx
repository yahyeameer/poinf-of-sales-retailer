"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@ai-pos/shared";

import { DemoBanner } from "@/components/DemoBanner";
import { refundSale } from "@/app/till/actions";

interface ReceiptItem {
  saleItemId: string;
  name: string;
  qty: number;
  price_cents: number;
}

interface Receipt {
  saleId: string;
  id: string;
  created_at: string;
  payment_method: string;
  total_cents: number;
  items: ReceiptItem[];
  voided?: boolean;
  isRefund?: boolean;
  refundedUnits?: number;
}

export function ReceiptsClient({
  initialReceipts,
  currency,
  shopName,
  canRefund,
  demoReason,
}: {
  initialReceipts: Receipt[];
  currency: string;
  shopName: string;
  canRefund: boolean;
  demoReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [receipts] = useState<Receipt[]>(initialReceipts);
  const [activeReceipt, setActiveReceipt] = useState<Receipt | null>(null);

  const [refunding, setRefunding] = useState<Receipt | null>(null);
  const [refundQty, setRefundQty] = useState<Record<string, number>>({});
  const [refundReason, setRefundReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  function beginRefund(r: Receipt) {
    setNotice(null);
    setRefundReason("");
    setRestock(true);
    // Default to refunding the whole sale — the common case is the customer
    // handing everything back.
    setRefundQty(Object.fromEntries(r.items.map((i) => [i.saleItemId, i.qty])));
    setRefunding(r);
  }

  const refundTotal = refunding
    ? refunding.items.reduce(
        (sum, i) => sum + (refundQty[i.saleItemId] ?? 0) * i.price_cents,
        0,
      )
    : 0;

  function submitRefund() {
    if (!refunding) return;
    const lines = Object.entries(refundQty)
      .filter(([, q]) => q > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));

    if (lines.length === 0) {
      setNotice({ ok: false, message: "Pick at least one item to refund." });
      return;
    }

    startTransition(async () => {
      const result = await refundSale({
        originalSaleId: refunding.saleId,
        clientId: crypto.randomUUID(),
        lines,
        reason: refundReason.trim() || null,
        method: null,
        restock,
      });

      setNotice(result);
      if (result.ok) {
        setRefunding(null);
        router.refresh();
      }
    });
  }

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
      {demoReason && <DemoBanner reason={demoReason} />}

      <h1>Sales History &amp; Receipts</h1>
      <p className="subtitle">View past customer receipts, refund a sale, or share a copy.</p>

      {notice && <div className={notice.ok ? "notice success" : "notice"}>{notice.message}</div>}

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
                  <td>
                    <code>{r.id}</code>
                    {r.isRefund && <span className="pill danger" style={{ marginLeft: 6 }}>Refund</span>}
                  </td>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>
                    <span className="pill">{r.payment_method}</span>
                  </td>
                  <td className="num" style={{ fontWeight: 600, color: r.total_cents < 0 ? "var(--danger)" : undefined }}>
                    {formatMoney(r.total_cents, currency)}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="chip-button"
                        onClick={() => setActiveReceipt(r)}
                      >
                        View Receipt
                      </button>
                      {canRefund && !r.isRefund && !r.voided && (
                        <button
                          type="button"
                          className="chip-button"
                          style={{ color: "var(--danger)" }}
                          onClick={() => beginRefund(r)}
                        >
                          Refund
                        </button>
                      )}
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

      {refunding && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Refund {refunding.id}</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              Choose how many of each item are coming back. The original sale stays
              on the record — this writes a separate refund against it.
            </p>

            {refunding.refundedUnits ? (
              <div className="notice">
                {refunding.refundedUnits} item(s) from this sale have already been
                refunded. Anything beyond what is left will be rejected.
              </div>
            ) : null}

            <ul className="refund-lines">
              {refunding.items.map((item) => (
                <li key={item.saleItemId}>
                  <div>
                    <strong>{item.name}</strong>
                    <div className="hint">
                      {item.qty} sold at {formatMoney(item.price_cents, currency)}
                    </div>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max={item.qty}
                    step="1"
                    aria-label={`Quantity of ${item.name} to refund`}
                    value={refundQty[item.saleItemId] ?? 0}
                    onChange={(e) =>
                      setRefundQty((prev) => ({
                        ...prev,
                        [item.saleItemId]: Math.max(
                          0,
                          Math.min(item.qty, parseFloat(e.target.value) || 0),
                        ),
                      }))
                    }
                  />
                </li>
              ))}
            </ul>

            <label htmlFor="rr">Reason</label>
            <input
              id="rr"
              type="text"
              placeholder="e.g. wrong size, faulty"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
            />

            {/* Damaged goods come back as a refund but must not go back on the
                shelf, so this is a decision rather than an automatic consequence. */}
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
              <input
                type="checkbox"
                checked={restock}
                onChange={(e) => setRestock(e.target.checked)}
                style={{ width: "auto" }}
              />
              <span>Put these back on the shelf</span>
            </label>

            <div className="due" style={{ marginTop: 16 }}>
              <span>Refunding</span>
              <strong>{formatMoney(refundTotal, currency)}</strong>
            </div>

            {notice && !notice.ok && <div className="notice">{notice.message}</div>}

            <div className="modal-actions">
              <button type="button" disabled={pending || refundTotal === 0} onClick={submitRefund}>
                {pending ? "Refunding…" : `Refund ${formatMoney(refundTotal, currency)}`}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={pending}
                onClick={() => setRefunding(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
