"use client";

import { useState } from "react";
import { formatMoney } from "@ai-pos/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
            <QrCode className="size-6 text-primary" />
            Barcode Label Studio
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate printable thermal barcode labels (58mm / 80mm roll format).
          </p>
        </div>
        <Button onClick={() => window.print()}>
          <Printer />
          <span>Print Selected Labels</span>
        </Button>
      </div>

      {/* Product Selector Card */}
      <Card>
        <CardHeader className="border-b border-border pb-3">
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
                      ? "bg-primary text-primary-foreground glow-btn"
                      : "bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground"
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
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Print Preview Grid</CardTitle>
            <Badge variant="outline" className="font-mono text-xs">{selectedProducts.length} Labels</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {selectedProducts.length === 0 ? (
            <EmptyState icon={QrCode} title="No products selected" description="Pick the products you want labels for and they will preview here." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {selectedProducts.map((p) => (
                // Deliberately literal white and near-black, like the receipt:
                // this is a preview of ink on label stock, not a piece of the
                // app's surface. Theming it would show an owner a dark label
                // and then print a white one. Only the dashed cut line, which
                // does not print, follows the theme.
                <div
                  key={p.id}
                  className="rounded-xl border-2 border-dashed border-border bg-white p-4 text-center text-slate-900"
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
