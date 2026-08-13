"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AlertTriangle, Check, ClipboardList, Lock, Plus } from "lucide-react";

import { recordStockAdjustment, type AdjustmentReason } from "@/app/actions";
import { DemoBanner } from "@/components/DemoBanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface Movement {
  id: string;
  product_id: string;
  delta: number;
  reason: string;
  note: string | null;
  created_at: string;
  products?: { name?: string } | { name?: string }[] | null;
}

export interface LowStockItem {
  product_id: string;
  name: string;
  stock_on_hand: number;
  reorder_point: number;
  /** Low stock is per-location now: plentiful in the warehouse, empty on the shelf. */
  location_name?: string;
}

export interface ProductOption {
  id: string;
  name: string;
  stock_on_hand: number;
}

const REASON_OPTIONS: { value: AdjustmentReason; label: string }[] = [
  { value: "restock", label: "Restock / Supplier Delivery" },
  { value: "stocktake", label: "Inventory Audit Count" },
  { value: "damaged", label: "Damaged / Expired Stock" },
  { value: "return", label: "Customer Return" },
];

const REASON_LABELS: Record<string, string> = {
  sale: "Sale",
  restock: "Restock",
  adjustment: "Adjustment",
  void: "Voided sale",
  stocktake: "Stocktake",
};

export function StockClient({
  initialMovements,
  lowStock,
  products,
  currency,
  locationName,
  canEdit,
  demoReason,
}: {
  initialMovements: Movement[];
  lowStock: LowStockItem[];
  products: ProductOption[];
  currency: string;
  locationName: string;
  canEdit: boolean;
  demoReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [showModal, setShowModal] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id ?? "");
  const [change, setChange] = useState("10");
  const [reason, setReason] = useState<AdjustmentReason>("restock");
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");

  function handleAdjustStock(e: React.FormEvent) {
    e.preventDefault();
    const delta = parseFloat(change);
    if (!selectedProductId || !Number.isFinite(delta)) return;

    setNotice(null);
    startTransition(async () => {
      const cost = parseFloat(unitCost);
      const result = await recordStockAdjustment({
        productId: selectedProductId,
        delta,
        reason,
        unitCostCents: Number.isFinite(cost) ? Math.round(cost * 100) : null,
        note: note.trim() || null,
      });

      setNotice(result);
      if (result.ok) {
        setShowModal(false);
        setNote("");
        setUnitCost("");
        router.refresh();
      }
    });
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {demoReason && <DemoBanner reason={demoReason} />}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            <ClipboardList className="h-6 w-6 text-emerald-600" />
            Stock &amp; Inventory Ledger
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Balances at{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {locationName}
            </span>
            . Adjustments you record here land at this location.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => {
              setNotice(null);
              setShowModal(true);
            }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Record adjustment
          </Button>
        )}
      </div>

      {notice && !showModal && (
        <div
          className={
            notice.ok
              ? "flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
          }
        >
          {notice.ok ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{notice.message}</span>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <CardTitle className="text-base">Stock alerts &amp; low balances</CardTitle>
          <Badge variant={lowStock.length > 0 ? "destructive" : "outline"} className="text-xs">
            {lowStock.length} need attention
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {lowStock.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">
              Everything is above its reorder point.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Reorder at</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStock.map((item) => (
                  <TableRow key={`${item.product_id}-${item.location_name ?? ""}`}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-slate-500">{item.location_name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(item.stock_on_hand)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-500">
                      {Number(item.reorder_point)}
                    </TableCell>
                    <TableCell>
                      {Number(item.stock_on_hand) <= 0 ? (
                        <Badge variant="destructive">Out of stock</Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
                        >
                          Reorder
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <CardTitle className="text-base">Recent stock movements</CardTitle>
          <Badge variant="outline" className="gap-1 text-xs">
            <Lock className="h-3 w-3" /> append-only
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {initialMovements.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">
              No stock movements recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date / time</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialMovements.map((m) => {
                  const prodName = Array.isArray(m.products)
                    ? m.products[0]?.name
                    : (m.products as { name?: string } | null)?.name ?? "Unknown product";
                  const delta = Number(m.delta);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">
                        {new Date(m.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>{prodName}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-semibold tabular-nums",
                          delta > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="font-normal">
                            {REASON_LABELS[m.reason] ?? m.reason}
                          </Badge>
                          {m.note && (
                            <span className="text-xs text-slate-400">{m.note}</span>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showModal} onOpenChange={(o) => !o && setShowModal(false)}>
        <DialogContent>
          <form onSubmit={handleAdjustStock} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Record stock adjustment</DialogTitle>
              <DialogDescription>
                This writes a ledger entry at {locationName}. Corrections are new entries,
                never edits.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="s-product">Product</Label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger id="s-product">
                  <SelectValue placeholder="Pick a product" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {Number(p.stock_on_hand)} on hand
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="s-reason">Reason</Label>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as AdjustmentReason)}
              >
                <SelectTrigger id="s-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASON_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="s-change">
                Quantity change{" "}
                <span className="font-normal text-slate-400">
                  {reason === "restock" ? "(units received)" : "(+ to add, − to remove)"}
                </span>
              </Label>
              <Input
                id="s-change"
                type="number"
                step="0.001"
                required
                value={change}
                onChange={(e) => setChange(e.target.value)}
                className="tabular-nums"
              />
            </div>

            {reason === "restock" && (
              <div className="space-y-2">
                <Label htmlFor="s-cost">Unit cost paid ({currency})</Label>
                <Input
                  id="s-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="1.10"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  className="tabular-nums"
                />
                <p className="text-xs text-slate-500">
                  Folded into the weighted average cost. The selling price is left alone —
                  you&apos;ll get a warning if margin drops below your minimum.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="s-note">Note (optional)</Label>
              <Input
                id="s-note"
                placeholder="e.g. crate damaged in transit"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {notice && !notice.ok && (
              <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{notice.message}</span>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowModal(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Recording…" : "Submit adjustment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
