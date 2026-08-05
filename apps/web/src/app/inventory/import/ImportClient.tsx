"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { importProducts } from "@/app/actions";

interface ParsedRow {
  name: string;
  barcode: string;
  price: string;
  stock: string;
  valid: boolean;
  error?: string;
}

const SAMPLE_CSV = `Product Name,Barcode,Price,Quantity
Mineral Water 500ml,600111223344,0.95,50
Sparkling Water 1L,600555443322,1.80,30
Orange Juice 250ml,600888999000,1.20,25
Invalid Item,,abc,10`;

export function ImportClient({ currency }: { currency: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [done, setDone] = useState(false);

  function parseCSV() {
    const lines = csvText.trim().split("\n");
    if (lines.length <= 1) return;

    const rows: ParsedRow[] = lines.slice(1).map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      const name = parts[0] || "";
      const barcode = parts[1] || "";
      const priceStr = parts[2] || "";
      const stockStr = parts[3] || "0";

      const numPrice = parseFloat(priceStr);
      const isValidPrice = !isNaN(numPrice) && numPrice > 0;
      const isValidName = name.length > 0;

      let error = "";
      if (!isValidName) error = "Missing product name";
      else if (!isValidPrice) error = "Invalid price format";

      return { name, barcode, price: priceStr, stock: stockStr, valid: isValidName && isValidPrice, error };
    });

    setParsedRows(rows);
    setNotice(null);
    setDone(false);
  }

  function handleImport() {
    const valid = parsedRows.filter((r) => r.valid);
    if (valid.length === 0) return;

    setNotice(null);
    startTransition(async () => {
      // Previously this fired an alert claiming success and wrote nothing at
      // all. Now the message reports what the database actually accepted.
      const result = await importProducts(
        valid.map((r) => ({
          name: r.name,
          barcode: r.barcode || null,
          priceCents: Math.round(parseFloat(r.price) * 100),
          stock: parseInt(r.stock, 10) || 0,
        })),
      );

      setNotice(result);
      if (result.ok) {
        setDone(true);
        router.refresh();
      }
    });
  }

  const validCount = parsedRows.filter((r) => r.valid).length;

  return (
    <div>
      <h1>CSV Catalog Bulk Import</h1>
      <p className="subtitle">Import product inventory in bulk from a standard CSV spreadsheet.</p>

      {notice && (
        <div className={notice.ok ? "notice success" : "notice"}>{notice.message}</div>
      )}

      <section className="panel" style={{ padding: "20px" }}>
        <h2 style={{ fontSize: "16px", marginTop: 0 }}>Step 1 — Paste your CSV</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Columns: name, barcode, price, quantity. The first row is treated as a header.
        </p>
        <textarea
          rows={6}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          aria-label="CSV data"
          style={{
            width: "100%",
            fontFamily: "var(--mono, monospace)",
            fontSize: "13px",
            padding: "10px",
            borderRadius: "7px",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
          }}
        />

        <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
          <button type="button" onClick={parseCSV} style={{ width: "auto", marginTop: 0 }}>
            Check rows
          </button>
          <button
            type="button"
            onClick={() => { setCsvText(SAMPLE_CSV); setParsedRows([]); setNotice(null); setDone(false); }}
            style={{ width: "auto", marginTop: 0, background: "transparent", border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            Reset to sample
          </button>
        </div>
      </section>

      {parsedRows.length > 0 && (
        <section className="panel">
          <header>
            <span>Step 2 — Review ({parsedRows.length} rows, {validCount} ready)</span>
            <button
              type="button"
              onClick={handleImport}
              disabled={pending || done || validCount === 0}
              style={{ width: "auto", marginTop: 0, padding: "4px 14px" }}
            >
              {done ? "Imported ✓" : pending ? "Importing…" : `Import ${validCount} products`}
            </button>
          </header>

          <table>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Barcode</th>
                <th className="num">Price ({currency})</th>
                <th className="num">Quantity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {parsedRows.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 550 }}>{row.name || "—"}</td>
                  <td><code>{row.barcode || "—"}</code></td>
                  <td className="num">{row.price}</td>
                  <td className="num">{row.stock}</td>
                  <td>
                    {row.valid ? (
                      <span className="pill" style={{ color: "var(--accent)" }}>Ready</span>
                    ) : (
                      <span className="pill danger">{row.error}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
