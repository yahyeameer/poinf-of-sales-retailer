"use client";

import * as React from "react";
import { formatMoney } from "@ai-pos/shared";

import { Button } from "@/components/ui/button";
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

import type { Receipt } from "./types";

/**
 * Cancelling a sale outright.
 *
 * Deliberately not the refund dialog with a checkbox. A refund asks which items
 * are coming back and how many; a void has no such question — the whole sale is
 * being struck, all of it goes back on the shelf, and offering quantity fields
 * would invite someone to void half a sale, which is not a thing void does.
 *
 * The reason is optional but asked for anyway, because a voided sale in the
 * ledger with no note is the row an owner stares at three weeks later trying to
 * work out whether the drawer was short that day.
 */
export function VoidDialog({
  receipt,
  currency,
  pending,
  onOpenChange,
  onVoid,
}: {
  receipt: Receipt | null;
  currency: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onVoid: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [seededFor, setSeededFor] = React.useState<string | null>(null);

  // Cleared when the dialog opens against a different sale, during render for
  // the same reason RefundDialog does it: an effect would let the previous
  // sale's reason paint for a frame.
  if (receipt && seededFor !== receipt.id) {
    setSeededFor(receipt.id);
    setReason("");
  }

  return (
    <Dialog open={receipt !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Void {receipt?.id}</DialogTitle>
          <DialogDescription>
            This cancels the whole sale and puts every item back on the shelf. The
            row stays in the history, marked voided — nothing is deleted.
          </DialogDescription>
        </DialogHeader>

        {receipt?.refundedUnits ? (
          <Notice tone="warning">
            {receipt.refundedUnits} item(s) from this sale have already been refunded.
            Voiding it on top of that will return the stock twice — refund the rest
            instead, or check the ledger afterwards.
          </Notice>
        ) : null}

        <ul className="space-y-2">
          {receipt?.items.map((item) => (
            <li
              key={item.saleItemId}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3"
            >
              <p className="min-w-0 truncate text-sm font-semibold">{item.name}</p>
              <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {item.qty} × {formatMoney(item.price_cents, currency)}
              </p>
            </li>
          ))}
        </ul>

        <div className="space-y-1.5">
          <Label htmlFor="void-reason">Reason</Label>
          <Input
            id="void-reason"
            type="text"
            placeholder="e.g. rang up twice, customer changed their mind"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="flex items-baseline justify-between rounded-xl bg-destructive/10 px-4 py-3">
          <span className="text-sm font-medium text-destructive">Cancelling</span>
          <strong className="text-2xl font-bold tabular-nums text-destructive">
            {formatMoney(receipt?.total_cents ?? 0, currency)}
          </strong>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Keep the sale
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => onVoid(reason.trim())}
          >
            {pending ? "Voiding…" : "Void this sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
