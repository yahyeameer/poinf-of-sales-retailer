"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { submitTransfer } from "@/app/warehouse-actions";
import type { ShopLocation } from "@/lib/tenant";

export interface StockAtLocation {
  location_id: string;
  product_id: string;
  product_name: string;
  on_hand: number;
}

export interface TransferDoc {
  reference_id: string;
  moved_at: string;
  from_location: string | null;
  to_location: string | null;
  lines: number;
  units: number;
  net_delta: number;
}

interface Draft {
  key: number;
  productId: string;
  quantity: string;
}

let nextKey = 1;

export function TransfersClient({
  locations,
  stock,
  recent,
}: {
  locations: ShopLocation[];
  stock: StockAtLocation[];
  recent: TransferDoc[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [fromId, setFromId] = useState(locations[0]?.id ?? "");
  const [toId, setToId] = useState(locations[1]?.id ?? "");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Draft[]>([{ key: 0, productId: "", quantity: "" }]);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  // Only products that actually have stock at the source can be moved, so the
  // dropdown is built from the source's shelf rather than the whole catalog.
  const available = useMemo(
    () => stock.filter((s) => s.location_id === fromId && Number(s.on_hand) > 0),
    [stock, fromId],
  );

  const onHandFor = (productId: string) =>
    Number(available.find((s) => s.product_id === productId)?.on_hand ?? 0);

  const overCommitted = lines.some((l) => {
    const qty = parseFloat(l.quantity);
    return l.productId && Number.isFinite(qty) && qty > onHandFor(l.productId);
  });

  const filledLines = lines.filter((l) => l.productId && parseFloat(l.quantity) > 0);

  function updateLine(key: number, patch: Partial<Draft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    startTransition(async () => {
      const result = await submitTransfer({
        fromLocationId: fromId,
        toLocationId: toId,
        lines: filledLines.map((l) => ({
          productId: l.productId,
          quantity: parseFloat(l.quantity),
        })),
        note: note.trim() || null,
      });
      setNotice(result);
      if (result.ok) {
        setLines([{ key: nextKey++, productId: "", quantity: "" }]);
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <div>
      <h1>Stock Transfers</h1>
      <p className="subtitle">
        Move goods between your locations. Recorded as paired ledger entries, so the
        business total never changes — only where the stock sits.
      </p>

      {notice && <div className={notice.ok ? "notice success" : "notice"}>{notice.message}</div>}

      <form onSubmit={handleSubmit}>
        <section className="panel" style={{ padding: "20px" }}>
          <h2 style={{ fontSize: "16px", marginTop: 0 }}>New transfer</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label htmlFor="t-from">From</label>
              <select
                id="t-from"
                value={fromId}
                onChange={(e) => {
                  setFromId(e.target.value);
                  // Lines reference the old shelf; clearing avoids submitting a
                  // product the new source may not stock at all.
                  setLines([{ key: nextKey++, productId: "", quantity: "" }]);
                }}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="t-to">To</label>
              <select id="t-to" value={toId} onChange={(e) => setToId(e.target.value)}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          </div>

          {fromId === toId && (
            <div className="notice" style={{ marginTop: 12 }}>
              Source and destination are the same. Pick two different locations.
            </div>
          )}

          <h3 style={{ fontSize: "14px", marginTop: 20, marginBottom: 8 }}>Products</h3>

          {available.length === 0 ? (
            <p className="empty">Nothing in stock at that location to move.</p>
          ) : (
            <>
              {lines.map((line) => {
                const onHand = onHandFor(line.productId);
                const qty = parseFloat(line.quantity);
                const tooMany = line.productId && Number.isFinite(qty) && qty > onHand;
                return (
                  <div
                    key={line.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 130px auto",
                      gap: "8px",
                      alignItems: "start",
                      marginBottom: "8px",
                    }}
                  >
                    <div>
                      <select
                        aria-label="Product"
                        value={line.productId}
                        onChange={(e) => updateLine(line.key, { productId: e.target.value })}
                      >
                        <option value="">Choose a product…</option>
                        {available.map((s) => (
                          <option key={s.product_id} value={s.product_id}>
                            {s.product_name} ({Number(s.on_hand)} here)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        aria-label="Quantity"
                        placeholder="Qty"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                        style={tooMany ? { borderColor: "var(--danger)" } : undefined}
                      />
                      {tooMany && (
                        <div className="hint" style={{ color: "var(--danger)" }}>
                          only {onHand} there
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="chip-button"
                      onClick={() => setLines((p) => p.filter((l) => l.key !== line.key))}
                      disabled={lines.length === 1}
                      aria-label="Remove line"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                className="chip-button"
                onClick={() => setLines((p) => [...p, { key: nextKey++, productId: "", quantity: "" }])}
              >
                + Add another product
              </button>
            </>
          )}

          <label htmlFor="t-note" style={{ marginTop: 16 }}>Note (optional)</label>
          <input
            id="t-note"
            type="text"
            placeholder="e.g. weekly shelf replenishment"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div style={{ marginTop: 18 }}>
            <button
              type="submit"
              disabled={pending || filledLines.length === 0 || fromId === toId || overCommitted}
              style={{ width: "auto" }}
            >
              {pending
                ? "Moving…"
                : `Transfer ${filledLines.length} line${filledLines.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>
      </form>

      <section className="panel">
        <header>
          <span>Recent transfers</span>
          <span className="hint">reassembled from the ledger</span>
        </header>
        {recent.length === 0 ? (
          <p className="empty">No transfers recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>From</th>
                <th>To</th>
                <th className="num">Lines</th>
                <th className="num">Units</th>
                <th>Balanced</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((t) => (
                <tr key={t.reference_id}>
                  <td>{new Date(t.moved_at).toLocaleString()}</td>
                  <td>{t.from_location ?? "—"}</td>
                  <td>{t.to_location ?? "—"}</td>
                  <td className="num">{t.lines}</td>
                  <td className="num">{Number(t.units)}</td>
                  <td>
                    {/* A transfer must net to zero. Anything else is a broken
                        pair and worth showing rather than quietly hiding. */}
                    {Number(t.net_delta) === 0 ? (
                      <span className="pill">Yes</span>
                    ) : (
                      <span className="pill danger">Off by {Number(t.net_delta)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
