"use client";

import { PackageX, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Draft, StockAtLocation } from "./types";

/**
 * The rows of the draft transfer.
 *
 * The quantity field turns red the moment it exceeds what is actually on the
 * source shelf, rather than waiting for the server to reject the whole
 * transfer — by then the person has typed six more lines.
 */
export function TransferLines({
  lines,
  available,
  onHandFor,
  onUpdate,
  onRemove,
  onAdd,
}: {
  lines: Draft[];
  available: StockAtLocation[];
  onHandFor: (productId: string) => number;
  onUpdate: (key: number, patch: Partial<Draft>) => void;
  onRemove: (key: number) => void;
  onAdd: () => void;
}) {
  if (available.length === 0) {
    return (
      <EmptyState
        icon={PackageX}
        title="Nothing to move"
        description="That location has no stock on hand, so there is nothing to transfer out of it."
      />
    );
  }

  return (
    <div className="space-y-3">
      {lines.map((line) => {
        const onHand = onHandFor(line.productId);
        const qty = parseFloat(line.quantity);
        const tooMany = Boolean(line.productId) && Number.isFinite(qty) && qty > onHand;

        return (
          <div key={line.key} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Select
                value={line.productId}
                onValueChange={(productId) => onUpdate(line.key, { productId })}
              >
                <SelectTrigger aria-label="Product">
                  <SelectValue placeholder="Choose a product…" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((s) => (
                    <SelectItem key={s.product_id} value={s.product_id}>
                      {s.product_name} ({Number(s.on_hand)} here)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-28 shrink-0">
              <Input
                type="number"
                step="0.001"
                min="0"
                aria-label="Quantity"
                placeholder="Qty"
                className={`text-right tabular-nums ${
                  tooMany ? "border-destructive focus-visible:ring-destructive" : ""
                }`}
                value={line.quantity}
                onChange={(e) => onUpdate(line.key, { quantity: e.target.value })}
              />
              {tooMany && (
                <p className="mt-1 text-xs font-medium text-destructive">only {onHand} there</p>
              )}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove line"
              disabled={lines.length === 1}
              onClick={() => onRemove(line.key)}
            >
              <X />
            </Button>
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <Plus />
        Add another product
      </Button>
    </div>
  );
}
