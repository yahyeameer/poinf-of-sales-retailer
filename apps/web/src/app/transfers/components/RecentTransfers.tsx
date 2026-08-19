"use client";

import { ArrowLeftRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { TransferDoc } from "./types";
import { LocalTime } from "@/components/LocalTime";

/**
 * Transfers already made, reassembled from the ledger — there is no transfers
 * table, only the paired movements, which is what keeps the business total
 * honest.
 *
 * The balanced column is the reason this list is worth showing at all: a pair
 * that doesn't net to zero means stock was created or destroyed by a move, and
 * that is the kind of thing that has to be visible rather than inferred.
 */
export function RecentTransfers({ recent }: { recent: TransferDoc[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent transfers</CardTitle>
        <CardDescription>Reassembled from the ledger</CardDescription>
      </CardHeader>

      <CardContent className="p-0">
        {recent.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="No transfers yet"
            description="Moves between your locations appear here once you record one."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead>Balanced</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {recent.map((t) => {
                const netDelta = Number(t.net_delta);
                return (
                  <TableRow key={t.reference_id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <LocalTime value={t.moved_at} />
                    </TableCell>
                    <TableCell>{t.from_location ?? "—"}</TableCell>
                    <TableCell>{t.to_location ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.lines}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(t.units)}</TableCell>
                    <TableCell>
                      {netDelta === 0 ? (
                        <Badge variant="success">Yes</Badge>
                      ) : (
                        <Badge variant="destructive">Off by {netDelta}</Badge>
                      )}
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
