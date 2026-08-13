"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importProducts } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FileSpreadsheet, CheckCircle2, AlertCircle, Upload, ArrowRight, Table as TableIcon } from "lucide-react";

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
    <div className="max-w-7xl mx-auto space-y-6 font-sans">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 flex items-center gap-2.5">
          <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
          CSV Catalog Bulk Import
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Import product inventory in bulk from standard CSV spreadsheet files.
        </p>
      </div>

      {notice && (
        <div className={`p-4 rounded-xl text-sm flex items-center gap-3 ${notice.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-rose-50 text-rose-800 border border-rose-200"}`}>
          {notice.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertCircle className="h-5 w-5 text-rose-600" />}
          <span>{notice.message}</span>
        </div>
      )}

      {/* Step 1 Card */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Step 1 — Paste your CSV Data</CardTitle>
            <Badge variant="outline" className="font-mono text-xs">Columns: Name, Barcode, Price, Quantity</Badge>
          </div>
          <CardDescription>First line is treated as CSV header</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <textarea
            rows={6}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            className="w-full font-mono text-xs p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <Button onClick={parseCSV} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-2">
            <TableIcon className="h-4 w-4" />
            <span>Validate & Parse CSV</span>
          </Button>
        </CardContent>
      </Card>

      {/* Step 2 Card */}
      {parsedRows.length > 0 && (
        <Card className="animate-in fade-in slide-in-from-bottom-2">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
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
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                  <tr>
                    <th className="px-5 py-3">Product Name</th>
                    <th className="px-5 py-3">Barcode</th>
                    <th className="px-5 py-3 text-right">Price ({currency})</th>
                    <th className="px-5 py-3 text-right">Quantity</th>
                    <th className="px-5 py-3">Validation Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {parsedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100">{r.name || "—"}</td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{r.barcode || "—"}</td>
                      <td className="px-5 py-3 text-right font-medium">{r.price || "—"}</td>
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

            <div className="p-5 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <Button
                onClick={handleImport}
                disabled={validCount === 0 || pending || done}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-2 shadow-md shadow-emerald-600/20"
              >
                <Upload className="h-4 w-4" />
                <span>{pending ? "Importing..." : `Import ${validCount} Products`}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
