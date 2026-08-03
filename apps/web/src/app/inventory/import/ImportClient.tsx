"use client";

import { useState } from "react";

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

export function ImportClient() {
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [imported, setImported] = useState(false);

  function parseCSV() {
    const lines = csvText.trim().split("\n");
    if (lines.length <= 1) return;

    const dataLines = lines.slice(1);
    const rows: ParsedRow[] = dataLines.map((line) => {
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

      return {
        name,
        barcode,
        price: priceStr,
        stock: stockStr,
        valid: isValidName && isValidPrice,
        error,
      };
    });

    setParsedRows(rows);
    setImported(false);
  }

  function handleImport() {
    const validCount = parsedRows.filter((r) => r.valid).length;
    setImported(true);
    alert(`Successfully imported ${validCount} valid products into store catalog!`);
  }

  return (
    <div>
      <h1>CSV Catalog Bulk Import Wizard</h1>
      <p className="subtitle">Import product inventory in bulk from standard CSV spreadsheet files.</p>

      <section className="panel" style={{ padding: "20px" }}>
        <h2 style={{ fontSize: "16px", marginTop: 0 }}>Step 1: Paste CSV Data or Load Sample</h2>
        <textarea
          rows={6}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          style={{
            width: "100%",
            fontFamily: "monospace",
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
            Parse CSV & Validate Headers
          </button>
          <button
            type="button"
            onClick={() => setCsvText(SAMPLE_CSV)}
            style={{ width: "auto", marginTop: 0, background: "transparent", border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            Reset Sample CSV
          </button>
        </div>
      </section>

      {parsedRows.length > 0 && (
        <section className="panel">
          <header>
            <span>Step 2: Pre-Import Validation Preview ({parsedRows.length} Items)</span>
            <button
              type="button"
              onClick={handleImport}
              disabled={imported || parsedRows.filter((r) => r.valid).length === 0}
              style={{ width: "auto", marginTop: 0, padding: "4px 14px" }}
            >
              {imported ? "Import Complete ✓" : `Import ${parsedRows.filter((r) => r.valid).length} Valid SKUs`}
            </button>
          </header>

          <table>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Barcode</th>
                <th>Price</th>
                <th>Stock Quantity</th>
                <th>Validation Status</th>
              </tr>
            </thead>
            <tbody>
              {parsedRows.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 550 }}>{row.name || "—"}</td>
                  <td><code>{row.barcode || "—"}</code></td>
                  <td>${row.price}</td>
                  <td>{row.stock}</td>
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
