"use client";

import * as React from "react";
import { formatMoney } from "@ai-pos/shared";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Notice } from "@/components/ui/notice";

import type { Notice as NoticeResult, Receipt, RefundLine } from "./types";

/**
 * Money going back across the counter.
 *
 * The quantities, the reason and the restock decision are only ever used to
 * build one call, so they live here rather than in the client — the same reason
 * the till's dialogs own their own fields.
 */
export function RefundDialog({
  receipt,
  currency,
  pending,
  onOpenChange,
  onRefund,
}: {
  receipt: Receipt | null;
  currency: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onRefund: (lines: RefundLine[], reason: string, restock: boolean) => void;
}) {
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [reason, setReason] = React.useState("");
  const [restock, setRestock] = React.useState(true);
  const [seededFor, setSeededFor] = React.useState<string | null>(null);

  // Re-seed when the dialog opens against a different sale. Done during render
  // rather than in an effect so the fields are never briefly the previous
  // receipt's — React re-runs this pass before anything paints. Defaults to the
  // whole sale, because the usual refund is the customer handing it all back.
  if (receipt && seededFor !== receipt.id) {
    setSeededFor(receipt.id);
    setQuantities(Object.fromEntries(receipt.items.map((i) => [i.saleItemId, i.qty])));
    setReason("");
    setRestock(true);
  }

  const lines: RefundLine[] = Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));

  const total = receipt
    ? receipt.items.reduce(
        (sum, i) => sum + (quantities[i.saleItemId] ?? 0) * i.price_cents,
        0,
      )
    : 0;

  return (
    <Dialog open={receipt !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Refund {receipt?.id}</DialogTitle>
          <DialogDescription>
            Choose how many of each item are coming back. The original sale stays on
            the record — this writes a separate refund against it.
          </DialogDescription>
        </DialogHeader>

        {/* A second refund against the same sale is legitimate; a second refund
            of the same units is not, and the server rejects it. Saying so here
            beats letting the cashier find out after the cash drawer is open. */}
        {receipt?.refundedUnits ? (
          <Notice tone="warning">
            {receipt.refundedUnits} item(s) from this sale have already been refunded.
            Anything beyond what is left will be rejected.
          </Notice>
        ) : null}

        <ul className="space-y-2">
          {receipt?.items.map((item) => (
            <li
              key={item.saleItemId}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {item.qty} sold at {formatMoney(item.price_cents, currency)}
                </p>
              </div>

              <Input
                type="number"
                min="0"
                max={item.qty}
                step="1"
                aria-label={`Quantity of ${item.name} to refund`}
                className="w-20 shrink-0 tabular-nums"
                value={quantities[item.saleItemId] ?? 0}
                onChange={(e) =>
                  setQuantities((prev) => ({
                    ...prev,
                    [item.saleItemId]: Math.max(
                      0,
                      Math.min(item.qty, parseFloat(e.target.value) || 0),
                    ),
                  }))
                }
              />
            </li>
          ))}
        </ul>

        <div className="space-y-1.5">
          <Label htmlFor="refund-reason">Reason</Label>
          <Input
            id="refund-reason"
            type="text"
            placeholder="e.g. wrong size, faulty"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {/* Damaged goods come back as a refund but must not go back on the
            shelf, so this is a decision rather than an automatic consequence. */}
        <Label className="flex items-center gap-2.5 font-normal">
          <Checkbox checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          <span>Put these back on the shelf</span>
        </Label>

        <div className="flex items-baseline justify-between rounded-xl bg-primary-soft px-4 py-3">
          <span className="text-sm font-medium text-primary">Refunding</span>
          <strong className="text-2xl font-bold tabular-nums text-primary">
            {formatMoney(total, currency)}
          </strong>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || total === 0}
            onClick={() => onRefund(lines, reason.trim(), restock)}
          >
            {pending ? "Refunding…" : `Refund ${formatMoney(total, currency)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
