"use client";

import * as React from "react";
import { formatMoney } from "@ai-pos/shared";
import { PackageSearch, ScanLine } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { TillProduct } from "./types";

/**
 * Scan field plus the product keys.
 *
 * The keys are `tap`-sized (56px) because the alternative is a cashier missing
 * and selling the wrong thing, which costs a void and a queue. Out-of-stock
 * keys stay pressable — a shop sells what is physically on the shelf whatever
 * the system believes, and blocking the sale is worse than a wrong count.
 */
export function ProductKeypad({
  products,
  currency,
  search,
  searchRef,
  onSearchChange,
  onSearchKeyDown,
  onAdd,
}: {
  products: TillProduct[];
  currency: string;
  search: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  onSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onAdd: (product: TillProduct) => void;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          type="search"
          // 16px minimum, or iOS zooms the whole page on focus and the cashier
          // loses the keypad.
          className="h-12 pl-9 text-base"
          placeholder="Scan a barcode or search…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          aria-label="Scan or search products"
        />
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Nothing matches that"
          description={
            search
              ? `No product name or barcode contains “${search}”.`
              : "No products are stocked at this location yet."
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => {
            const out = Number(p.stock_on_hand) <= 0;

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onAdd(p)}
                className={cn(
                  "tap group flex flex-col justify-between gap-1 rounded-xl border border-border",
                  "bg-card p-3 text-left transition-all duration-150",
                  "hover:border-primary/45 hover:glow-md",
                  "active:scale-[0.97]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  out && "border-dashed opacity-70",
                )}
              >
                <span className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</span>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold tabular-nums text-primary">
                    {formatMoney(p.price_cents, currency)}
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-medium tabular-nums",
                      out ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {out ? "none left" : Number(p.stock_on_hand)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
