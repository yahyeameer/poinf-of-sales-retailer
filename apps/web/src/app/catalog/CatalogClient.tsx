"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@ai-pos/shared";
import { createProduct } from "@/app/actions";
import { DemoBanner } from "@/components/DemoBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { ActionNotice } from "@/components/ui/notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, Package, Barcode } from "lucide-react";

export interface Product {
  id: string;
  name: string;
  barcode: string | null;
  price_cents: number;
  stock_on_hand: number;
  reorder_point: number;
  is_active: boolean;
}

/**
 * Archived beats low stock: a product nobody is selling any more is not a
 * restocking problem. Shared so the card list and the table cannot drift apart
 * on what counts as low.
 */
function statusBadge(p: Product) {
  if (!p.is_active) return <Badge variant="destructive">Archived</Badge>;
  if (Number(p.stock_on_hand) <= Number(p.reorder_point))
    return <Badge variant="warning">Low Stock</Badge>;
  return <Badge variant="default">Active</Badge>;
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
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
            <Package className="size-6 text-primary" />
            Product Catalog
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage product prices, barcodes, stock levels, and inventory reorder points.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => { setNotice(null); setShowAddModal(true); }}
          >
            <Plus />
            <span>Add Product</span>
          </Button>
        )}
      </div>

      {!showAddModal && <ActionNotice result={notice} />}

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
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
                  ? "bg-primary text-primary-foreground glow-btn"
                  : "bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Main Catalog Card & Table */}
      <Card>
        <CardHeader className="border-b border-border pb-3">
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
            <EmptyState
              icon={Package}
              title="No matching products"
              description="Nothing matches that search and filter. Clear them to see the whole catalog."
            />
          ) : (
            <>
              {/* Phones: one card per product. Six columns will not fit, and the
                  three that matter at the shelf are name, price and how many
                  are left. */}
              <ul className="divide-y divide-border sm:hidden">
                {filteredProducts.map((p) => (
                  <li
                    key={p.id}
                    className="space-y-2 p-4"
                    data-inactive={p.is_active ? undefined : "true"}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 font-semibold text-foreground">{p.name}</p>
                      <p className="shrink-0 font-semibold tabular-nums text-primary">
                        {formatMoney(p.price_cents, currency)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground tabular-nums">
                        {Number(p.stock_on_hand)} on hand
                      </span>
                      <span className="tabular-nums">reorder at {Number(p.reorder_point)}</span>
                      {p.barcode && (
                        <span className="flex items-center gap-1.5 font-mono">
                          <Barcode className="size-3.5" />
                          {p.barcode}
                        </span>
                      )}
                    </div>

                    <div>{statusBadge(p)}</div>
                  </li>
                ))}
              </ul>

              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead>Barcode</TableHead>
                      <TableHead className="text-right">Selling Price</TableHead>
                      <TableHead className="text-right">Stock On Hand</TableHead>
                      <TableHead className="text-right">Reorder Point</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                      {filteredProducts.map((p) => (
                      <TableRow key={p.id} data-inactive={p.is_active ? undefined : "true"}>
                        <TableCell className="font-semibold text-foreground">{p.name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {p.barcode ? (
                            <span className="flex items-center gap-1.5">
                              <Barcode className="size-3.5" />
                              {p.barcode}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-primary">
                          {formatMoney(p.price_cents, currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {Number(p.stock_on_hand)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {Number(p.reorder_point)}
                        </TableCell>
                        <TableCell>{statusBadge(p)}</TableCell>
                      </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add new product</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAddProduct} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Product Name</Label>
                <Input
                  required
                  placeholder="e.g. Fresh Milk 1L"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Barcode (Optional)</Label>
                <Input
                  placeholder="e.g. 600123456789"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Selling Price ({currency})</Label>
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
                  <Label className="text-xs">Opening Stock</Label>
                  <Input
                    type="number"
                    min="0"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Reorder Point</Label>
                  <Input
                    type="number"
                    min="0"
                    value={reorder}
                    onChange={(e) => setReorder(e.target.value)}
                  />
                </div>
              </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddModal(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save product"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
