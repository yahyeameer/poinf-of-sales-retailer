"use client";

import { useState } from "react";
import { formatMoney } from "@ai-pos/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { QrCode, Printer, Check } from "lucide-react";

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
    <div className="max-w-7xl mx-auto space-y-6 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 flex items-center gap-2.5">
            <QrCode className="h-6 w-6 text-emerald-600" />
            Barcode Label Studio
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Generate printable thermal barcode labels (58mm / 80mm roll format).
          </p>
        </div>
        <Button
          onClick={() => window.print()}
          className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-md shadow-emerald-600/20"
        >
          <Printer className="h-4 w-4" />
          <span>Print Selected Labels</span>
        </Button>
      </div>

      {/* Product Selector Card */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="text-base font-semibold">Select Products to Print</CardTitle>
          <CardDescription>Click product chips to toggle label inclusion</CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <div className="flex flex-wrap gap-2">
            {initialProducts.map((p) => {
              const isSelected = selectedProductIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProduct(p.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    isSelected
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                  }`}
                >
                  {isSelected && <Check className="h-3.5 w-3.5" />}
                  <span>{p.name}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Print Preview Card */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Print Preview Grid</CardTitle>
            <Badge variant="outline" className="font-mono text-xs">{selectedProducts.length} Labels</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {selectedProducts.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-8">No products selected for barcode printing.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {selectedProducts.map((p) => (
                <div
                  key={p.id}
                  className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center bg-white text-slate-900 shadow-sm"
                >
                  <div className="font-bold text-sm truncate">{p.name}</div>
                  <div className="text-lg font-black text-emerald-600 my-1">
                    {formatMoney(p.price_cents, currency)}
                  </div>

                  {/* Thermal Barcode Mock Pattern */}
                  <div className="h-10 my-2 bg-[repeating-linear-gradient(90deg,#000_0,#000_3px,#fff_3px,#fff_6px,#000_6px,#000_8px,#fff_8px,#fff_12px)] rounded" />

                  <code className="text-[11px] font-mono tracking-widest text-slate-700">
                    {p.barcode || "NO-BARCODE"}
                  </code>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
