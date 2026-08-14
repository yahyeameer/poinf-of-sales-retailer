"use client";

import { formatMoney } from "@ai-pos/shared";
import { Store } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { KIND_LABEL, type LocationRow } from "./types";

/**
 * Every place stock can sit, with what is sitting there.
 *
 * A closed location keeps its row rather than disappearing: its stock is still
 * counted in the business total, and a warehouse that vanished from this list
 * while still holding goods is how stock goes missing on paper.
 */
export function LocationsTable({
  locations,
  currency,
  canEdit,
  pending,
  onEdit,
  onToggleActive,
}: {
  locations: LocationRow[];
  currency: string;
  canEdit: boolean;
  pending: boolean;
  onEdit: (location: LocationRow) => void;
  onToggleActive: (location: LocationRow) => void;
}) {
  if (locations.length === 0) {
    return (
      <EmptyState
        icon={Store}
        title="No locations yet"
        description="Add the shop floor first, then any warehouse or van that holds stock."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Code</TableHead>
          <TableHead className="text-right">Products</TableHead>
          <TableHead className="text-right">Units</TableHead>
          <TableHead className="text-right">Stock value</TableHead>
          {canEdit && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>

      <TableBody>
        {locations.map((l) => (
          <TableRow key={l.id} data-inactive={l.is_active ? undefined : "true"}>
            <TableCell className="font-medium">
              <div className="flex flex-wrap items-center gap-2">
                {l.name}
                {l.is_default && <Badge>Default</Badge>}
                {!l.is_active && <Badge variant="destructive">Closed</Badge>}
              </div>
              {l.address && (
                <p className="mt-0.5 text-xs text-muted-foreground">{l.address}</p>
              )}
            </TableCell>

            <TableCell className="text-muted-foreground">
              {KIND_LABEL[l.kind] ?? l.kind}
            </TableCell>

            <TableCell>
              {l.code ? (
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{l.code}</code>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>

            <TableCell className="text-right tabular-nums">{l.lines}</TableCell>
            <TableCell className="text-right tabular-nums">
              {Math.round(l.units * 1000) / 1000}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {formatMoney(Math.round(l.valueCents), currency)}
            </TableCell>

            {canEdit && (
              <TableCell>
                <div className="flex justify-end gap-2 whitespace-nowrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => onEdit(l)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => onToggleActive(l)}
                  >
                    {l.is_active ? "Close" : "Reopen"}
                  </Button>
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
