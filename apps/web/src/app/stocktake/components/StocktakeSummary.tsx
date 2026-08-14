"use client";

import { formatMoney } from "@ai-pos/shared";
import { Coins, ListChecks, PackageMinus, PackagePlus } from "lucide-react";

import { StatTile } from "@/components/ui/stat-tile";

import type { CountSummary } from "./types";

/** Trims float noise from repeated addition without hiding a real fraction. */
const tidy = (n: number) => Math.round(n * 1000) / 1000;

/**
 * What the count adds up to so far, above the sheet rather than below it — the
 * person counting wants to know the shelf is short long before they reach the
 * end of a 300-line list.
 *
 * Shrinkage and a negative value impact are the two figures worth interrupting
 * someone for, so those are the only two that take a colour. The nested span
 * opts out of the tile's gradient by setting a colour of its own.
 */
export function StocktakeSummary({
  summary,
  countedLines,
  totalLines,
  currency,
}: {
  summary: CountSummary;
  countedLines: number;
  totalLines: number;
  currency: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        icon={ListChecks}
        label="Counted"
        value={countedLines}
        hint={`of ${totalLines} products`}
      />

      <StatTile
        icon={PackageMinus}
        label="Missing"
        value={
          summary.missing > 0 ? (
            <span className="text-destructive">{tidy(summary.missing)}</span>
          ) : (
            0
          )
        }
        hint="units short of the ledger"
      />

      <StatTile
        icon={PackagePlus}
        label="Extra"
        value={tidy(summary.surplus)}
        hint="units more than expected"
      />

      <StatTile
        icon={Coins}
        label="Value impact"
        value={
          summary.valueCents < 0 ? (
            <span className="text-destructive">
              {formatMoney(Math.round(summary.valueCents), currency)}
            </span>
          ) : (
            formatMoney(Math.round(summary.valueCents), currency)
          )
        }
        hint="at cost"
      />
    </div>
  );
}
