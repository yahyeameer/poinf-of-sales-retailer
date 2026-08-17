"use client";

import { formatMoney } from "@ai-pos/shared";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { LocalTime } from "@/components/LocalTime";

import { Paper, PaperRow, PaperRule } from "./Paper";
import { METHOD_LABEL, type Method } from "./types";

interface MethodTotal {
  method: string;
  amount_cents: number;
}

interface CashMovement {
  kind: string;
  amount_cents: number;
  reason: string;
}

/**
 * The mid-shift read. Deliberately does not close anything — an owner checking
 * on the drawer at lunchtime should not have to end the cashier's shift to do
 * it.
 */
export function XReportDialog({
  open,
  onOpenChange,
  report,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: Record<string, unknown> | null;
  currency: string;
}) {
  if (!report) return null;

  const byMethod = (report.by_method as MethodTotal[] | null) ?? [];
  const movements = (report.cash_movements as CashMovement[] | null) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>X report</DialogTitle>
          <DialogDescription>Mid-shift read. The shift stays open.</DialogDescription>
        </DialogHeader>

        <Paper printable className="max-h-[55vh] overflow-y-auto">
          <PaperRow
            label="Opened"
            value={<LocalTime value={String(report.opened_at)} />}
          />
          <PaperRow
            label="Float"
            value={formatMoney(Number(report.opening_float_cents), currency)}
          />
          <PaperRule />
          <PaperRow label="Sales" value={String(report.sales_count)} />
          <PaperRow
            label="Gross"
            value={formatMoney(Number(report.gross_sales_cents), currency)}
          />
          <PaperRow
            label={`Refunds (${String(report.refunds_count)})`}
            value={formatMoney(Number(report.refunds_cents), currency)}
          />
          <PaperRow
            strong
            label="NET"
            value={formatMoney(Number(report.net_sales_cents), currency)}
          />
          <PaperRule />
          {byMethod.map((m) => (
            <PaperRow
              key={m.method}
              label={METHOD_LABEL[m.method as Method] ?? m.method}
              value={formatMoney(Number(m.amount_cents), currency)}
            />
          ))}
          {movements.map((c, i) => (
            <PaperRow
              key={i}
              label={`${c.kind === "pay_in" ? "In" : c.kind === "drop" ? "Drop" : "Out"}: ${c.reason}`}
              value={`${c.kind === "pay_in" ? "" : "−"}${formatMoney(Number(c.amount_cents), currency)}`}
            />
          ))}
          <PaperRule />
          <PaperRow
            strong
            label="CASH EXPECTED"
            value={formatMoney(Number(report.expected_cash_cents), currency)}
          />
        </Paper>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer />
            Print
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
