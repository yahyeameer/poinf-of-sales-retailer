"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, parseMoneyToCents } from "@ai-pos/shared";
import { importProducts } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { FileSpreadsheet, Upload, ArrowRight, Table as TableIcon } from "lucide-react";

interface ParsedRow {
  name: string;
  barcode: string;
  price: string;
  /** What the price parsed to. Shown back, so a misread is caught before import. */
  priceCents: number | null;
  stock: string;
  valid: boolean;
  error?: string;
}

/**
 * One CSV line into fields, respecting quotes.
 *
 * `line.split(",")` — which this was — shifts every column after the first
 * product whose name contains a comma, and "Rice, Basmati 5kg" is not an
 * unusual way to write a product name. The row does not fail; it imports with
 * the name truncated and the barcode holding the rest of the name, which is
 * worse than an error.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (quoted) {
      // "" inside a quoted field is a literal quote.
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }

  fields.push(field.trim());
  return fields;
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
  const toast = useToast();
  const [done, setDone] = useState(false);

  function parseCSV() {
    const lines = csvText.trim().split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length <= 1) return;

    // Real exports put the columns in whatever order the previous system used,
    // so the header is read rather than assumed. Anything unrecognised falls
    // back to the documented order, which is what the sample uses.
    const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
    const columnFor = (aliases: string[], fallback: number) => {
      const found = header.findIndex((h) => aliases.some((a) => h.includes(a)));
      return found === -1 ? fallback : found;
    };

    const nameCol = columnFor(["name", "product", "item", "description"], 0);
    const barcodeCol = columnFor(["barcode", "ean", "upc", "sku", "code"], 1);
    const priceCol = columnFor(["price", "rate", "amount", "cost"], 2);
    const stockCol = columnFor(["qty", "quantity", "stock", "on hand", "count"], 3);

    const rows: ParsedRow[] = lines.slice(1).map((line) => {
      const parts = splitCsvLine(line);
      const name = parts[nameCol] || "";
      const barcode = parts[barcodeCol] || "";
      const priceStr = parts[priceCol] || "";
      const stockStr = parts[stockCol] || "0";

      // parseMoneyToCents, not parseFloat times a hundred. Two things were
      // wrong with the old line. It assumed every currency has two decimal
      // places, so a shop pricing in UGX or KRW — zero minor units, and
      // squarely this product's market — had every price inflated a
      // hundredfold on import. And parseFloat("1,500") is 1, so a price
      // written with a thousands separator imported as one cent, silently and
      // as a "valid" row.
      const priceCents = parseMoneyToCents(priceStr, currency);
      const isValidPrice = priceCents !== null && priceCents > 0;
      const isValidName = name.trim().length > 0;

      let error = "";
      if (!isValidName) error = "Missing product name";
      else if (!isValidPrice) error = "Invalid price format";

      return {
        name,
        barcode,
        price: priceStr,
        priceCents: isValidPrice ? priceCents : null,
        stock: stockStr,
        valid: isValidName && isValidPrice,
        error,
      };
    });

    setParsedRows(rows);
    setDone(false);
  }

  function handleImport() {
    const valid = parsedRows.filter((r) => r.valid);
    if (valid.length === 0) return;

    startTransition(async () => {
      const result = await importProducts(
        valid.map((r) => ({
          name: r.name,
          barcode: r.barcode || null,
          // Already parsed and shown back in the preview, so what gets imported
          // is exactly the figure the owner checked.
          priceCents: r.priceCents ?? 0,
          stock: parseInt(r.stock, 10) || 0,
        })),
      );

      toast(result);
      if (result.ok) {
        setDone(true);
        router.refresh();
      }
    });
  }

  const validCount = parsedRows.filter((r) => r.valid).length;

  return (
    <div className="max-w-7xl mx-auto space-y-6 font-sans">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
          <FileSpreadsheet className="size-6 text-primary" />
          CSV Catalog Bulk Import
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Import product inventory in bulk from standard CSV spreadsheet files.
        </p>
      </div>

      {/* Step 1 Card */}
      <Card>
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Step 1 — Paste your CSV Data</CardTitle>
            <Badge variant="outline" className="font-mono text-xs">Name, Barcode, Price, Quantity</Badge>
          </div>
          <CardDescription>
            The first line is the header, and its column names are read — so any order
            works. Quoted fields containing commas are handled. Prices are read in{" "}
            {currency}.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <textarea
            rows={6}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            className="w-full rounded-lg border border-border bg-muted p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button onClick={parseCSV}>
            <TableIcon />
            <span>Validate & Parse CSV</span>
          </Button>
        </CardContent>
      </Card>

      {/* Step 2 Card */}
      {parsedRows.length > 0 && (
        <Card className="animate-rise">
          <CardHeader className="border-b border-border pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Step 2 — Preview Parsed Rows</CardTitle>
              <Badge variant={validCount > 0 ? "default" : "destructive"}>
                {validCount} valid / {parsedRows.length} total
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/60 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Product Name</th>
                    <th className="px-5 py-3">Barcode</th>
                    <th className="px-5 py-3 text-right">Price ({currency})</th>
                    <th className="px-5 py-3 text-right">Quantity</th>
                    <th className="px-5 py-3">Validation Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {parsedRows.map((r, i) => (
                    <tr key={i} className="transition-colors hover:bg-muted/50">
                      <td className="px-5 py-3 font-semibold text-foreground">{r.name || "—"}</td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{r.barcode || "—"}</td>
                      {/* The parsed figure, not the raw text. A price the
                          importer read differently from how the owner wrote it
                          is exactly what this preview exists to catch, and
                          echoing the input back cannot show that. */}
                      <td className="px-5 py-3 text-right font-medium tabular-nums">
                        {r.priceCents === null ? (
                          <span className="text-muted-foreground">{r.price || "—"}</span>
                        ) : (
                          formatMoney(r.priceCents, currency)
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-medium">{r.stock || "—"}</td>
                      <td className="px-5 py-3">
                        {r.valid ? (
                          <Badge variant="default">Valid</Badge>
                        ) : (
                          <Badge variant="destructive">{r.error || "Invalid"}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end border-t border-border p-5">
              <Button onClick={handleImport} disabled={validCount === 0 || pending || done}>
                <Upload />
                <span>{pending ? "Importing..." : `Import ${validCount} Products`}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
