"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";

import { ActionNotice } from "@/components/ui/notice";
import { submitStocktake } from "@/app/warehouse-actions";

import { CommitPanel } from "./components/CommitPanel";
import { CountSheet } from "./components/CountSheet";
import { PreviousCounts } from "./components/PreviousCounts";
import { StocktakeSummary } from "./components/StocktakeSummary";
import type { CountLine, CountSummary, Notice, StocktakeDoc } from "./components/types";

// Re-exported so page.tsx keeps importing its row types from here rather than
// reaching into ./components.
export type { CountLine, StocktakeDoc } from "./components/types";

/**
 * Counting the shelves against the ledger.
 *
 * This file owns the counts, the derived totals and the commit; the sheet, the
 * tiles and the note live in ./components. The counts stay here because three
 * separate things read them, and a second copy would be a second answer to how
 * short the shop is.
 */
export function StocktakeClient({
  locationName,
  locationId,
  lines,
  recent,
  currency,
}: {
  locationName: string;
  locationId: string;
  lines: CountLine[];
  recent: StocktakeDoc[];
  currency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);

  // Only lines someone actually typed a number into count. A blank row means
  // "not counted", which is different from counting zero — and conflating the
  // two would write off every product the counter hasn't reached yet.
  const entered = useMemo(
    () =>
      lines
        .map((l) => ({ line: l, raw: counts[l.product_id] }))
        .filter((x) => x.raw !== undefined && x.raw !== "")
        .map((x) => ({ line: x.line, counted: parseFloat(x.raw as string) }))
        .filter((x) => Number.isFinite(x.counted) && x.counted >= 0),
    [lines, counts],
  );

  const summary = useMemo<CountSummary>(() => {
    let missing = 0;
    let surplus = 0;
    let valueCents = 0;
    let changed = 0;
    for (const { line, counted } of entered) {
      const delta = counted - Number(line.on_hand);
      if (delta === 0) continue;
      changed += 1;
      if (delta < 0) missing += -delta;
      else surplus += delta;
      valueCents += delta * Number(line.cost_cents);
    }
    return { missing, surplus, valueCents, changed };
  }, [entered]);

  function commit(note: string) {
    setNotice(null);
    startTransition(async () => {
      const result = await submitStocktake({
        locationId,
        counts: entered.map((x) => ({ productId: x.line.product_id, counted: x.counted })),
        note: note || null,
      });
      setNotice(result);
      if (result.ok) {
        setCounts({});
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
          <ClipboardList className="size-6 text-primary" />
          Stocktake
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Counting <span className="font-semibold text-foreground">{locationName}</span>.
          Type what you actually find; leave a row blank if you haven&apos;t counted it.
          Only the difference is written to the ledger.
        </p>
      </div>

      <ActionNotice result={notice} />

      <StocktakeSummary
        summary={summary}
        countedLines={entered.length}
        totalLines={lines.length}
        currency={currency}
      />

      <CountSheet
        lines={lines}
        counts={counts}
        changedLines={summary.changed}
        onCount={(productId, value) =>
          setCounts((prev) => ({ ...prev, [productId]: value }))
        }
      />

      <CommitPanel
        countedLines={entered.length}
        changedLines={summary.changed}
        pending={pending}
        onCommit={commit}
      />

      <PreviousCounts recent={recent} />
    </div>
  );
}
