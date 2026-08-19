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

import { LocalTime } from "@/components/LocalTime";

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

  // The actions are the same three on both layouts, so they are written once
  // rather than kept in step by hand.
  const actions = (r: Receipt, block?: boolean) => (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={block ? "flex-1" : undefined}
        onClick={() => onView(r)}
      >
        <Eye />
        View
      </Button>

      {canRefund && !r.isRefund && !r.voided && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={block ? "flex-1" : undefined}
          onClick={() => onRefund(r)}
        >
          <RotateCcw />
          Refund
        </Button>
      )}

      <Button asChild variant="ghost" size="sm" className={block ? "flex-1" : undefined}>
        <a href={whatsAppLink(r)} target="_blank" rel="noreferrer">
          <MessageCircle />
          WhatsApp
        </a>
      </Button>
    </>
  );

  return (
    <>
      {/* Phones: one card per sale. Five columns of receipt do not fit in
          390px, and side-scrolling a table to reach the refund button is not
          something to ask of someone standing at a counter. */}
      <ul className="divide-y divide-border sm:hidden">
        {receipts.map((r) => (
          <li key={r.id} className="space-y-3 p-4" data-inactive={r.voided ? "true" : undefined}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <code className="block truncate rounded bg-muted px-1.5 py-0.5 text-xs">
                  {r.id}
                </code>
                <p className="text-xs text-muted-foreground">
                  <LocalTime value={r.created_at} />
                </p>
              </div>

              {/* The amount is what the eye goes to first on a phone, so it
                  leads rather than sitting in the fourth column. */}
              <p
                className={`shrink-0 text-base font-semibold tabular-nums ${
                  r.total_cents < 0 ? "text-destructive" : ""
                }`}
              >
                {formatMoney(r.total_cents, currency)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{r.payment_method}</Badge>
              {r.isRefund && <Badge variant="destructive">Refund</Badge>}
              {r.voided && <Badge variant="outline">Voided</Badge>}
            </div>

            <div className="flex gap-2">{actions(r, true)}</div>
          </li>
        ))}
      </ul>

      <div className="hidden sm:block">
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
                  <LocalTime value={r.created_at} />
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
                  <div className="flex flex-wrap justify-end gap-2">{actions(r)}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
