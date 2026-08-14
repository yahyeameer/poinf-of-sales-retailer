"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@ai-pos/shared";
import { createProduct } from "@/app/actions";
import { DemoBanner } from "@/components/DemoBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Plus, Search, Package, Barcode, AlertCircle, X, CheckCircle2 } from "lucide-react";

export interface Product {
  id: string;
  name: string;
  barcode: string | null;
  price_cents: number;
  stock_on_hand: number;
  reorder_point: number;
  is_active: boolean;
}

export function CatalogClient({
  initialProducts,
  currency,
  canEdit,
  demoReason,
}: {
  initialProducts: Product[];
  currency: string;
  canEdit: boolean;
  demoReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "low" | "archived">("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("10");
  const [reorder, setReorder] = useState("5");

  const filteredProducts = initialProducts.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode && p.barcode.includes(search));

    if (!matchesSearch) return false;
    if (filter === "active") return p.is_active;
    if (filter === "archived") return !p.is_active;
    if (filter === "low") return Number(p.stock_on_hand) <= Number(p.reorder_point);
    return true;
  });

  function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    const priceValue = parseFloat(price);
    if (!name.trim() || !Number.isFinite(priceValue)) return;

    setNotice(null);
    startTransition(async () => {
      const result = await createProduct({
        name,
        barcode: barcode.trim() || null,
        priceCents: Math.round(priceValue * 100),
        openingStock: parseInt(stock, 10) || 0,
        reorderPoint: parseInt(reorder, 10) || 5,
      });

      setNotice(result);
      if (result.ok) {
        setName("");
        setBarcode("");
        setPrice("");
        setShowAddModal(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 font-sans">
      {demoReason && <DemoBanner reason={demoReason} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 flex items-center gap-2.5">
            <Package className="h-6 w-6 text-emerald-600" />
            Product Catalog
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage product prices, barcodes, stock levels, and inventory reorder points.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => { setNotice(null); setShowAddModal(true); }}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20"
          >
            <Plus className="h-4 w-4" />
            <span>Add Product</span>
          </Button>
        )}
      </div>

      {/* Notice Banner */}
      {notice && !showAddModal && (
        <div className={`p-4 rounded-xl text-sm flex items-center gap-3 ${notice.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-rose-50 text-rose-800 border border-rose-200"}`}>
          {notice.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertCircle className="h-5 w-5 text-rose-600" />}
          <span>{notice.message}</span>
        </div>
      )}

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            type="text"
            placeholder="Search by product name or barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(["all", "active", "low", "archived"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize ${
                filter === f
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Main Catalog Card & Table */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold capitalize">
              {filter} Products
            </CardTitle>
            <Badge variant="outline" className="font-mono">
              {filteredProducts.length} items
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredProducts.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Package className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="font-medium text-sm">No matching products found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                  <tr>
                    <th className="px-5 py-3">Product Name</th>
                    <th className="px-5 py-3">Barcode</th>
                    <th className="px-5 py-3 text-right">Selling Price</th>
                    <th className="px-5 py-3 text-right">Stock On Hand</th>
                    <th className="px-5 py-3 text-right">Reorder Point</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredProducts.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-slate-900 dark:text-slate-100">
                        {p.name}
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 font-mono text-xs">
                        {p.barcode ? (
                          <span className="flex items-center gap-1.5">
                            <Barcode className="h-3.5 w-3.5 text-slate-400" />
                            {p.barcode}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatMoney(p.price_cents, currency)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-medium">
                        {Number(p.stock_on_hand)}
                      </td>
                      <td className="px-5 py-3.5 text-right text-slate-500">
                        {Number(p.reorder_point)}
                      </td>
                      <td className="px-5 py-3.5">
                        {!p.is_active ? (
                          <Badge variant="destructive">Archived</Badge>
                        ) : Number(p.stock_on_hand) <= Number(p.reorder_point) ? (
                          <Badge variant="warning">Low Stock</Badge>
                        ) : (
                          <Badge variant="default">Active</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5 animate-scale-in">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Add New Product</h2>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddProduct} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Product Name</label>
                <Input
                  required
                  placeholder="e.g. Fresh Milk 1L"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Barcode (Optional)</label>
                <Input
                  placeholder="e.g. 600123456789"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Selling Price ({currency})</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="2.50"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Opening Stock</label>
                  <Input
                    type="number"
                    min="0"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Reorder Point</label>
                  <Input
                    type="number"
                    min="0"
                    value={reorder}
                    onChange={(e) => setReorder(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={pending} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                  {pending ? "Saving..." : "Save Product"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
