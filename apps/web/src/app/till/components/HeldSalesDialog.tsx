"use client";

import { PauseCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";

import type { ParkedSale } from "./types";

/**
 * Sales parked mid-transaction — a customer who went back for something, or a
 * card that needed re-trying. Resuming one loads its cart and deletes the park,
 * so the same basket cannot be sold twice.
 */
export function HeldSalesDialog({
  open,
  onOpenChange,
  parked,
  pending,
  onResume,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parked: ParkedSale[];
  pending: boolean;
  onResume: (sale: ParkedSale) => void;
  onDiscard: (sale: ParkedSale) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Held sales</DialogTitle>
        </DialogHeader>

        {parked.length === 0 ? (
          <EmptyState
            icon={PauseCircle}
            title="Nothing on hold"
            description="Use Hold on the cart to park a sale and come back to it."
          />
        ) : (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {parked.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" disabled={pending} onClick={() => onResume(p)}>
                    Resume
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => onDiscard(p)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    Discard
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
