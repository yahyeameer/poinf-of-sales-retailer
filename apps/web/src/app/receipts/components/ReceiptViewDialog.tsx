"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
// Aliased: `Receipt` on this screen is a row of sale history, which is a
// different thing from the document that gets handed to a customer.
import { Receipt as ReceiptPaper, type ReceiptShop } from "@/components/Receipt";

import type { Receipt } from "./types";

/**
 * A past receipt, reprinted.
 *
 * It renders the same component as the settings preview, so a layout an owner
 * designs there is exactly what the customer is handed — and the print
 * stylesheet keys off `.receipt`, which that component carries, so Print emits
 * the paper alone rather than the dialog around it.
 */
export function ReceiptViewDialog({
  receipt,
  shop,
  onClose,
}: {
  receipt: Receipt | null;
  shop: ReceiptShop;
  onClose: () => void;
}) {
  return (
    <Dialog open={receipt !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Receipt {receipt?.id}</DialogTitle>
        </DialogHeader>

        {receipt && (
          <div className="flex justify-center">
            <ReceiptPaper
              shop={shop}
              sale={{
                ref: receipt.id,
                createdAt: receipt.created_at,
                paymentMethod: receipt.payment_method,
                items: receipt.items.map((i) => ({
                  name: i.name,
                  qty: i.qty,
                  priceCents: i.price_cents,
                })),
                totalCents: receipt.total_cents,
                isRefund: receipt.isRefund,
                voided: receipt.voided,
              }}
            />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer />
            Print
          </Button>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
