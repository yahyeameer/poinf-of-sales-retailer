"use client";

import { History } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { StocktakeDoc } from "./types";
import { LocalTime } from "@/components/LocalTime";

/**
 * Counts already committed. Kept on the same screen as the sheet because the
 * useful question when a shelf comes up short is whether it also came up short
 * last month — a recurring gap is theft or miscounting, a one-off is neither.
 */
export function PreviousCounts({ recent }: { recent: StocktakeDoc[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Previous counts</CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {recent.length === 0 ? (
          <EmptyState
            icon={History}
            title="No stocktakes yet"
            description="Once you commit a count it appears here, so you can compare against it."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Lines corrected</TableHead>
                <TableHead className="text-right">Missing</TableHead>
                <TableHead className="text-right">Extra</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {recent.map((s) => {
                const missing = Number(s.units_missing ?? 0);
                return (
                  <TableRow key={s.reference_id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <LocalTime value={s.counted_at} />
                    </TableCell>
                    <TableCell>{s.location_name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.lines_adjusted}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${
                        missing > 0 ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {missing}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(s.units_surplus ?? 0)}
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
