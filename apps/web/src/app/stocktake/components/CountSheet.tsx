"use client";

import * as React from "react";
import { PackageSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { CountLine } from "./types";

/**
 * The sheet itself. Search is local to this component because it only ever
 * decides what is on screen — the totals above are computed from every line,
 * counted or not, so filtering must not be able to change them.
 *
 * The search box also takes a barcode: a counter with a scanner in one hand
 * jumps to the product rather than scrolling to it.
 */
export function CountSheet({
  lines,
  counts,
  changedLines,
  onCount,
}: {
  lines: CountLine[];
  counts: Record<string, string>;
  changedLines: number;
  onCount: (productId: string, value: string) => void;
}) {
  const [search, setSearch] = React.useState("");

  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) => l.product_name.toLowerCase().includes(q) || (l.barcode && l.barcode.includes(q)),
    );
  }, [lines, search]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Count sheet</CardTitle>
        <Badge variant={changedLines > 0 ? "warning" : "secondary"}>
          {changedLines} line{changedLines === 1 ? "" : "s"} would change
        </Badge>
      </CardHeader>

      <CardContent className="p-0">
        <div className="px-5 pb-4">
          <Input
            type="search"
            className="max-w-sm"
            placeholder="Search or scan a barcode to jump to a product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="No products match"
            description="Clear the search to see the whole count sheet."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Ledger says</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {visible.map((l) => {
                const raw = counts[l.product_id];
                // Blank is "not counted", which is not the same as counting
                // zero — so the difference column stays empty rather than
                // claiming the whole shelf is missing.
                const counted = raw === undefined || raw === "" ? null : parseFloat(raw);
                const delta =
                  counted !== null && Number.isFinite(counted)
                    ? counted - Number(l.on_hand)
                    : null;

                return (
                  <TableRow key={l.product_id}>
                    <TableCell className="font-medium">
                      {l.product_name}
                      {l.barcode && (
                        <div className="mt-0.5">
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {l.barcode}
                          </code>
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {Number(l.on_hand)}
                    </TableCell>

                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        aria-label={`Counted quantity for ${l.product_name}`}
                        className="ml-auto w-28 text-right tabular-nums"
                        value={raw ?? ""}
                        onChange={(e) => onCount(l.product_id, e.target.value)}
                      />
                    </TableCell>

                    <TableCell
                      className={`text-right font-semibold tabular-nums ${
                        delta === null || delta === 0
                          ? "text-muted-foreground"
                          : delta < 0
                            ? "text-destructive"
                            : "text-success"
                      }`}
                    >
                      {delta === null ? "—" : delta > 0 ? `+${delta}` : delta}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
