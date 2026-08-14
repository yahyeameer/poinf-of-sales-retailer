"use client";

import { formatMoney } from "@ai-pos/shared";
import { Eye, MessageCircle, ReceiptText, RotateCcw } from "lucide-react";

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

import type { Receipt } from "./types";

/**
 * Sales history. A refund is a row in the same list as the sale it reverses,
 * because an owner reconciling a till drawer is looking for what happened in
 * order, not for two separate ledgers they have to interleave by hand.
 */
export function ReceiptsTable({
  receipts,
  currency,
  canRefund,
  onView,
  onRefund,
  whatsAppLink,
}: {
  receipts: Receipt[];
  currency: string;
  canRefund: boolean;
  onView: (receipt: Receipt) => void;
  onRefund: (receipt: Receipt) => void;
  whatsAppLink: (receipt: Receipt) => string;
}) {
  if (receipts.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="No sales yet"
        description="Receipts appear here as soon as the till takes its first payment."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Receipt</TableHead>
          <TableHead>Date &amp; time</TableHead>
          <TableHead>Payment</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {receipts.map((r) => (
          // A voided sale stays visible but dimmed — it happened, and hiding it
          // makes a drawer that doesn't balance impossible to explain.
          <TableRow key={r.id} data-inactive={r.voided ? "true" : undefined}>
            <TableCell>
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.id}</code>
                {r.isRefund && <Badge variant="destructive">Refund</Badge>}
                {r.voided && <Badge variant="outline">Voided</Badge>}
              </div>
            </TableCell>

            <TableCell className="whitespace-nowrap text-muted-foreground">
              {new Date(r.created_at).toLocaleString()}
            </TableCell>

            <TableCell>
              <Badge variant="secondary">{r.payment_method}</Badge>
            </TableCell>

            {/* A refund is stored as a negative total; colouring it is what
                stops it reading as an unusually small sale. */}
            <TableCell
              className={`text-right font-semibold tabular-nums ${
                r.total_cents < 0 ? "text-destructive" : ""
              }`}
            >
              {formatMoney(r.total_cents, currency)}
            </TableCell>

            <TableCell>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onView(r)}>
                  <Eye />
                  View
                </Button>

                {canRefund && !r.isRefund && !r.voided && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onRefund(r)}>
                    <RotateCcw />
                    Refund
                  </Button>
                )}

                <Button asChild variant="ghost" size="sm">
                  <a href={whatsAppLink(r)} target="_blank" rel="noreferrer">
                    <MessageCircle />
                    WhatsApp
                  </a>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
