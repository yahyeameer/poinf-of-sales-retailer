"use client";

import { formatMoney } from "@ai-pos/shared";
import { CheckCircle2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Paper, PaperRow, PaperRule } from "./Paper";
import type { SaleReceipt } from "./types";

/**
 * Shown the moment a sale posts. Change due is the largest thing on it — it is
 * the one number the cashier has to act on before the customer walks away.
 */
export function ReceiptDialog({
  receipt,
  currency,
  onClose,
}: {
  receipt: SaleReceipt | null;
  currency: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={receipt !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" />
            Sale complete
          </DialogTitle>
        </DialogHeader>

        {receipt && (
          <>
            {receipt.changeCents > 0 && (
              <div className="flex items-baseline justify-between rounded-xl bg-primary-soft px-4 py-3">
                <span className="text-sm font-medium text-primary">Change due</span>
                <strong className="text-3xl font-bold tabular-nums text-primary text-glow">
                  {formatMoney(receipt.changeCents, currency)}
                </strong>
              </div>
            )}

            <Paper printable>
              {receipt.lines.map((l) => (
                <PaperRow
                  key={l.productId}
                  label={`${l.quantity}× ${l.name}`}
                  value={formatMoney(Math.round(l.quantity * l.unitPriceCents), currency)}
                />
              ))}
              <PaperRule />
              <PaperRow strong label="TOTAL" value={formatMoney(receipt.totalCents, currency)} />
              <PaperRow label="Ref" value={receipt.saleId.slice(0, 8).toUpperCase()} />
            </Paper>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer />
            Print
          </Button>
          <Button type="button" size="lg" onClick={onClose}>
            Next customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
