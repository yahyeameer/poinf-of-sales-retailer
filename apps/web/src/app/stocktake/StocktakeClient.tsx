"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@ai-pos/shared";

import { submitStocktake } from "@/app/warehouse-actions";

export interface CountLine {
  product_id: string;
  product_name: string;
  barcode: string | null;
  on_hand: number;
  cost_cents: number;
}

export interface StocktakeDoc {
  reference_id: string;
  counted_at: string;
  location_name: string;
  lines_adjusted: number;
  units_missing: number | null;
  units_surplus: number | null;
}

export function StocktakeClient({
  locationName,
  locationId,
  lines,
  recent,
  currency,
}: {
  locationName: string;
  locationId: string;
  lines: CountLine[];
  recent: StocktakeDoc[];
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) => l.product_name.toLowerCase().includes(q) || (l.barcode && l.barcode.includes(q)),
    );
  }, [lines, search]);

  // Only lines someone actually typed a number into count. A blank row means
  // "not counted", which is different from counting zero — and conflating the
  // two would write off every product the counter hasn't reached yet.
  const entered = useMemo(
    () =>
      lines
        .map((l) => ({ line: l, raw: counts[l.product_id] }))
        .filter((x) => x.raw !== undefined && x.raw !== "")
        .map((x) => ({ line: x.line, counted: parseFloat(x.raw as string) }))
        .filter((x) => Number.isFinite(x.counted) && x.counted >= 0),
    [lines, counts],
  );

  const summary = useMemo(() => {
    let missing = 0;
    let surplus = 0;
    let valueCents = 0;
    let changed = 0;
    for (const { line, counted } of entered) {
      const delta = counted - Number(line.on_hand);
      if (delta === 0) continue;
      changed += 1;
      if (delta < 0) missing += -delta;
      else surplus += delta;
      valueCents += delta * Number(line.cost_cents);
    }
    return { missing, surplus, valueCents, changed };
  }, [entered]);

  function handleSubmit() {
    setNotice(null);
    startTransition(async () => {
      const result = await submitStocktake({
        locationId,
        counts: entered.map((x) => ({ productId: x.line.product_id, counted: x.counted })),
        note: note.trim() || null,
      });
      setNotice(result);
      if (result.ok) {
        setCounts({});
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <div>
      <h1>Stocktake</h1>
      <p className="subtitle">
        Counting <strong>{locationName}</strong>. Type what you actually find; leave a row
        blank if you haven&apos;t counted it. Only the difference is written to the ledger.
      </p>

      {notice && <div className={notice.ok ? "notice success" : "notice"}>{notice.message}</div>}

      <div className="tiles">
        <div className="tile">
          <div className="label">Counted</div>
          <div className="value">{entered.length}</div>
          <div className="delta">of {lines.length} products</div>
        </div>
        <div className="tile">
          <div className="label">Missing</div>
          <div className="value" style={{ color: summary.missing > 0 ? "var(--danger)" : undefined }}>
            {Math.round(summary.missing * 1000) / 1000}
          </div>
          <div className="delta">units short of the ledger</div>
        </div>
        <div className="tile">
          <div className="label">Extra</div>
          <div className="value">{Math.round(summary.surplus * 1000) / 1000}</div>
          <div className="delta">units more than expected</div>
        </div>
        <div className="tile">
          <div className="label">Value impact</div>
          <div className="value" style={{ color: summary.valueCents < 0 ? "var(--danger)" : undefined }}>
            {formatMoney(Math.round(summary.valueCents), currency)}
          </div>
          <div className="delta">at cost</div>
        </div>
      </div>

      <section className="panel">
        <header>
          <span>Count sheet</span>
          <span className="hint">{summary.changed} line(s) would change</span>
        </header>

        <div style={{ padding: "0 16px 12px" }}>
          <input
            type="text"
            placeholder="Search or scan a barcode to jump to a product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: "360px" }}
          />
        </div>

        {visible.length === 0 ? (
          <p className="empty">No products match.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Ledger says</th>
                <th className="num">Counted</th>
                <th className="num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => {
                const raw = counts[l.product_id];
                const counted = raw === undefined || raw === "" ? null : parseFloat(raw);
                const delta =
                  counted !== null && Number.isFinite(counted)
                    ? counted - Number(l.on_hand)
                    : null;
                return (
                  <tr key={l.product_id}>
                    <td style={{ fontWeight: 550 }}>
                      {l.product_name}
                      {l.barcode && <div className="hint"><code>{l.barcode}</code></div>}
                    </td>
                    <td className="num">{Number(l.on_hand)}</td>
                    <td className="num">
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        aria-label={`Counted quantity for ${l.product_name}`}
                        value={raw ?? ""}
                        onChange={(e) =>
                          setCounts((prev) => ({ ...prev, [l.product_id]: e.target.value }))
                        }
                        style={{ width: "110px", marginTop: 0, textAlign: "right" }}
                      />
                    </td>
                    <td
                      className="num"
                      style={{
                        fontWeight: 600,
                        color:
                          delta === null || delta === 0
                            ? "var(--muted)"
                            : delta < 0
                              ? "var(--danger)"
                              : "var(--accent)",
                      }}
                    >
                      {delta === null ? "—" : delta > 0 ? `+${delta}` : delta}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel" style={{ padding: "20px" }}>
        <label htmlFor="st-note">Note (optional)</label>
        <input
          id="st-note"
          type="text"
          placeholder="e.g. month-end count, back shelves"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending || entered.length === 0}
            style={{ width: "auto" }}
          >
            {pending ? "Committing…" : `Commit count (${entered.length} line${entered.length === 1 ? "" : "s"})`}
          </button>
          {summary.changed > 0 && (
            <p className="hint" style={{ marginTop: 8 }}>
              This writes {summary.changed} correction{summary.changed === 1 ? "" : "s"} to the
              ledger. Existing entries are never edited — corrections are new rows.
            </p>
          )}
        </div>
      </section>

      <section className="panel">
        <header>
          <span>Previous counts</span>
        </header>
        {recent.length === 0 ? (
          <p className="empty">No stocktakes recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Location</th>
                <th className="num">Lines corrected</th>
                <th className="num">Missing</th>
                <th className="num">Extra</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.reference_id}>
                  <td>{new Date(s.counted_at).toLocaleString()}</td>
                  <td>{s.location_name}</td>
                  <td className="num">{s.lines_adjusted}</td>
                  <td className="num" style={{ color: Number(s.units_missing) > 0 ? "var(--danger)" : undefined }}>
                    {Number(s.units_missing ?? 0)}
                  </td>
                  <td className="num">{Number(s.units_surplus ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
