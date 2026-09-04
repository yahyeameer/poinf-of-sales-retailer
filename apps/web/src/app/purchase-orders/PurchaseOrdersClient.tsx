"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { formatMoney, parseMoneyToCents } from "@ai-pos/shared";
import { Ban, ClipboardList, PackageCheck, Plus, Send, Sparkles, Trash2 } from "lucide-react";

import { LocalTime } from "@/components/LocalTime";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
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
import { useToast } from "@/components/ui/toast";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  receivePurchaseOrder,
  sendPurchaseOrder,
  suggestPurchaseLines,
} from "@/app/purchasing-actions";

export type PurchaseOrderStatus = "draft" | "sent" | "partial" | "received" | "cancelled";

export interface PurchaseOrderLine {
  id: string;
  productId: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCostCents: number;
}

export interface PurchaseOrder {
  id: string;
  reference: string;
  status: PurchaseOrderStatus;
  expectedAt: string | null;
  createdAt: string;
  receivedAt: string | null;
  note: string | null;
  supplierName: string;
  locationName: string;
  unitsOrdered: number;
  unitsReceived: number;
  totalCostCents: number;
  lines: PurchaseOrderLine[];
}

export interface SupplierOption {
  id: string;
  name: string;
}

export interface CatalogProduct {
  id: string;
  name: string;
  costCents: number;
}

/** One row of the order being drafted. `key` is client identity, not product —
 *  two blank rows must stay distinguishable while someone fills them in. */
interface DraftRow {
  key: number;
  productId: string;
  quantity: string;
  unitCost: string;
}

const STATUS_TONE: Record<PurchaseOrderStatus, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  draft: "outline",
  sent: "default",
  partial: "warning",
  received: "success",
  cancelled: "destructive",
};

type OpenDialog =
  | { name: "create" }
  | { name: "receive"; order: PurchaseOrder }
  | null;

/**
 * The loop between "these lines are low" and "the stock arrived".
 *
 * Receiving is the part that matters: it writes restock movements through the
 * ledger, so the same trigger that has always maintained products.cost_cents
 * does the averaging. Nothing here computes a cost of its own.
 */
export function PurchaseOrdersClient({
  orders,
  suppliers,
  catalog,
  currency,
  locationName,
}: {
  orders: PurchaseOrder[];
  suppliers: SupplierOption[];
  catalog: CatalogProduct[];
  currency: string;
  locationName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<OpenDialog>(null);
  const toast = useToast();

  // --- draft state ---------------------------------------------------------
  const nextKey = React.useRef(1);
  const [supplierId, setSupplierId] = React.useState(suppliers[0]?.id ?? "");
  const [expectedAt, setExpectedAt] = React.useState("");
  const [draft, setDraft] = React.useState<DraftRow[]>([]);

  // --- receive state -------------------------------------------------------
  const [received, setReceived] = React.useState<Record<string, string>>({});
  const [seededFor, setSeededFor] = React.useState<string | null>(null);

  // Seeded during render rather than in an effect, so the fields are never
  // briefly the previous order's — the same approach RefundDialog takes.
  if (dialog?.name === "receive" && seededFor !== dialog.order.id) {
    setSeededFor(dialog.order.id);
    setReceived(
      Object.fromEntries(
        dialog.order.lines.map((l) => [
          l.id,
          String(Math.max(l.quantityOrdered - l.quantityReceived, 0)),
        ]),
      ),
    );
  }

  function openCreate() {
    setSupplierId(suppliers[0]?.id ?? "");
    setExpectedAt("");
    setDraft([{ key: nextKey.current++, productId: "", quantity: "1", unitCost: "" }]);
    setDialog({ name: "create" });
  }

  function fillFromLowStock() {
    startTransition(async () => {
      const result = await suggestPurchaseLines();
      if (!result.ok) {
        toast(result);
        return;
      }
      const rows = result.data ?? [];
      if (rows.length === 0) {
        toast({ ok: true, message: "Nothing is below its reorder point right now." });
        return;
      }
      setDraft(
        rows.map((r) => ({
          key: nextKey.current++,
          productId: r.productId,
          quantity: String(r.suggestedQty),
          unitCost: (r.unitCostCents / 100).toFixed(2),
        })),
      );
      toast({ ok: true, message: `Drafted ${rows.length} line(s) from the low-stock list.` });
    });
  }

  function submitCreate(send: boolean) {
    const lines = draft
      .filter((d) => d.productId && parseFloat(d.quantity) > 0)
      .map((d) => ({
        productId: d.productId,
        quantity: parseFloat(d.quantity),
        // parseMoneyToCents, never a bare * 100: a shop pricing in UGX or KWD
        // does not have two decimal places, and money.ts owns that decision.
        unitCostCents: parseMoneyToCents(d.unitCost || "0", currency) ?? 0,
      }));

    if (lines.length === 0) {
      toast({ ok: false, message: "Add at least one line with a quantity." });
      return;
    }

    startTransition(async () => {
      const result = await createPurchaseOrder({
        supplierId,
        lines,
        expectedAt: expectedAt || null,
        note: null,
        send,
      });
      toast(result);
      if (result.ok) {
        setDialog(null);
        router.refresh();
      }
    });
  }

  function submitReceive() {
    if (dialog?.name !== "receive") return;
    const order = dialog.order;

    const lines = order.lines
      .map((l) => ({ lineId: l.id, quantity: parseFloat(received[l.id] ?? "0") || 0 }))
      .filter((l) => l.quantity > 0);

    if (lines.length === 0) {
      toast({ ok: false, message: "Enter what actually arrived." });
      return;
    }

    startTransition(async () => {
      const result = await receivePurchaseOrder({ id: order.id, lines, note: null });
      toast(result);
      if (result.ok) {
        setDialog(null);
        setSeededFor(null);
        router.refresh();
      }
    });
  }

  function send(order: PurchaseOrder) {
    startTransition(async () => {
      const result = await sendPurchaseOrder(order.id);
      toast(result);
      if (result.ok) router.refresh();
    });
  }

  function cancel(order: PurchaseOrder) {
    startTransition(async () => {
      const result = await cancelPurchaseOrder(order.id, null);
      toast(result);
      if (result.ok) router.refresh();
    });
  }

  const draftTotal = draft.reduce((sum, d) => {
    const qty = parseFloat(d.quantity) || 0;
    const cost = parseMoneyToCents(d.unitCost || "0", currency) ?? 0;
    return sum + qty * cost;
  }, 0);

  const open = orders.filter((o) => o.status === "draft" || o.status === "sent" || o.status === "partial");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
            <ClipboardList className="size-6 text-primary" />
            Purchase orders
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ordering into {locationName}. Receiving a delivery updates stock and cost through
            the ledger.
          </p>
        </div>

        <Button type="button" onClick={openCreate}>
          <Plus />
          New order
        </Button>
      </div>

      {open.length > 0 && (
        <Notice tone="info">
          {open.length} order{open.length === 1 ? "" : "s"} still open.
        </Notice>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Recent orders</CardTitle>
          <Badge variant="secondary">{orders.length}</Badge>
        </CardHeader>

        <CardContent className="p-0">
          {orders.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No orders yet"
              description="Draft one from the low-stock list and it will be waiting here when the delivery turns up."
              action={
                <Button type="button" onClick={openCreate}>
                  <Plus />
                  Create the first order
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {orders.map((o) => (
                    <TableRow
                      key={o.id}
                      data-inactive={o.status === "cancelled" ? "true" : undefined}
                    >
                      <TableCell>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">
                          {o.reference}
                        </code>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          <LocalTime value={o.createdAt} format="date" />
                          {o.expectedAt && (
                            <>
                              {" · due "}
                              <LocalTime value={o.expectedAt} format="date" />
                            </>
                          )}
                        </p>
                      </TableCell>

                      <TableCell className="text-sm">{o.supplierName}</TableCell>

                      <TableCell>
                        <Badge variant={STATUS_TONE[o.status]} className="capitalize">
                          {o.status}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right tabular-nums">
                        {o.unitsReceived.toLocaleString()} / {o.unitsOrdered.toLocaleString()}
                      </TableCell>

                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(o.totalCostCents, currency)}
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          {o.status === "draft" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              onClick={() => send(o)}
                            >
                              <Send />
                              Place
                            </Button>
                          )}

                          {(o.status === "sent" || o.status === "partial" || o.status === "draft") && (
                            <Button
                              type="button"
                              size="sm"
                              disabled={pending}
                              onClick={() => setDialog({ name: "receive", order: o })}
                            >
                              <PackageCheck />
                              Receive
                            </Button>
                          )}

                          {/* Cancelling is only offered while nothing has been
                              booked in. Once stock has arrived the RPC refuses,
                              because the ledger already says it did. */}
                          {(o.status === "draft" || o.status === "sent") &&
                            o.unitsReceived === 0 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => cancel(o)}
                              >
                                <Ban />
                                Cancel
                              </Button>
                            )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- create ---------- */}
      <Dialog open={dialog?.name === "create"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New purchase order</DialogTitle>
            <DialogDescription>
              Ordering into {locationName}. Costs are what the supplier quoted — they become
              the product&apos;s cost when the delivery is booked in.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="po-supplier">Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger id="po-supplier">
                  <SelectValue placeholder="Pick a supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="po-expected">Expected</Label>
              <Input
                id="po-expected"
                type="date"
                value={expectedAt}
                onChange={(e) => setExpectedAt(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Lines</span>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={fillFromLowStock}>
              <Sparkles />
              Fill from low stock
            </Button>
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto">
            {draft.map((row) => (
              <div key={row.key} className="flex items-end gap-2 rounded-xl border border-border bg-muted/40 p-2.5">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label className="text-xs" htmlFor={`po-p-${row.key}`}>Product</Label>
                  <Select
                    value={row.productId}
                    onValueChange={(v) =>
                      setDraft((d) =>
                        d.map((r) =>
                          r.key === row.key
                            ? {
                                ...r,
                                productId: v,
                                // Seed the cost from what the product currently
                                // averages, as a starting point to correct.
                                unitCost:
                                  r.unitCost ||
                                  (
                                    (catalog.find((c) => c.id === v)?.costCents ?? 0) / 100
                                  ).toFixed(2),
                              }
                            : r,
                        ),
                      )
                    }
                  >
                    <SelectTrigger id={`po-p-${row.key}`}>
                      <SelectValue placeholder="Pick a product" />
                    </SelectTrigger>
                    <SelectContent>
                      {catalog.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-20 space-y-1">
                  <Label className="text-xs" htmlFor={`po-q-${row.key}`}>Qty</Label>
                  <Input
                    id={`po-q-${row.key}`}
                    type="number"
                    min="0"
                    step="any"
                    className="tabular-nums"
                    value={row.quantity}
                    onChange={(e) =>
                      setDraft((d) =>
                        d.map((r) => (r.key === row.key ? { ...r, quantity: e.target.value } : r)),
                      )
                    }
                  />
                </div>

                <div className="w-24 space-y-1">
                  <Label className="text-xs" htmlFor={`po-c-${row.key}`}>Unit cost</Label>
                  <Input
                    id={`po-c-${row.key}`}
                    inputMode="decimal"
                    className="tabular-nums"
                    value={row.unitCost}
                    onChange={(e) =>
                      setDraft((d) =>
                        d.map((r) => (r.key === row.key ? { ...r, unitCost: e.target.value } : r)),
                      )
                    }
                  />
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Remove line"
                  onClick={() => setDraft((d) => d.filter((r) => r.key !== row.key))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft((d) => [
                ...d,
                { key: nextKey.current++, productId: "", quantity: "1", unitCost: "" },
              ])
            }
          >
            <Plus />
            Add a line
          </Button>

          <div className="flex items-baseline justify-between rounded-xl bg-primary-soft px-4 py-3">
            <span className="text-sm font-medium text-primary">Order value</span>
            <strong className="text-2xl font-bold tabular-nums text-primary">
              {formatMoney(draftTotal, currency)}
            </strong>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => submitCreate(false)}>
              Save draft
            </Button>
            <Button type="button" disabled={pending} onClick={() => submitCreate(true)}>
              {pending ? "Placing…" : "Place order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- receive ---------- */}
      <Dialog
        open={dialog?.name === "receive"}
        onOpenChange={(o) => {
          if (!o) {
            setDialog(null);
            setSeededFor(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Receive {dialog?.name === "receive" ? dialog.order.reference : ""}
            </DialogTitle>
            <DialogDescription>
              Enter what actually turned up. A short delivery leaves the rest outstanding, so
              the order stays open until the balance arrives.
            </DialogDescription>
          </DialogHeader>

          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {dialog?.name === "receive" &&
              dialog.order.lines.map((l) => {
                const outstanding = l.quantityOrdered - l.quantityReceived;
                return (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{l.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {outstanding} of {l.quantityOrdered} still to come, at{" "}
                        {formatMoney(l.unitCostCents, currency)}
                      </p>
                    </div>

                    <Input
                      type="number"
                      min="0"
                      max={outstanding}
                      step="any"
                      aria-label={`Quantity of ${l.productName} received`}
                      className="w-24 shrink-0 tabular-nums"
                      value={received[l.id] ?? "0"}
                      onChange={(e) =>
                        setReceived((r) => ({ ...r, [l.id]: e.target.value }))
                      }
                      disabled={outstanding <= 0}
                    />
                  </li>
                );
              })}
          </ul>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setDialog(null);
                setSeededFor(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" disabled={pending} onClick={submitReceive}>
              {pending ? "Booking in…" : "Book in delivery"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
