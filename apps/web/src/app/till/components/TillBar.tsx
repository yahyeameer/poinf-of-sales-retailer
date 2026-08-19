"use client";

import Link from "next/link";
import { formatMoney } from "@ai-pos/shared";
import { ArrowLeft, Banknote, FileText, LogOut } from "lucide-react";

import { LocalTime } from "@/components/LocalTime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { OpenShift } from "./types";

/**
 * Who is selling, where, and since when — plus the three shift-level actions.
 *
 * The Exit link is not decoration: on a phone the till runs full-screen with
 * the app's tab bar hidden, so this is the only way back out.
 */
export function TillBar({
  shift,
  currency,
  cashierName,
  locationName,
  pending,
  onCashDrawer,
  onXReport,
  onCloseShift,
}: {
  shift: OpenShift;
  currency: string;
  cashierName: string;
  locationName: string;
  pending: boolean;
  onCashDrawer: () => void;
  onXReport: () => void;
  onCloseShift: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 glow-sm lit-edge relative">
      <Button asChild variant="ghost" size="icon" className="lg:hidden" aria-label="Leave the till">
        <Link href={"/" as never}>
          <ArrowLeft />
        </Link>
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="solid" className="animate-pulse-glow">
            Shift open
          </Badge>
          <span className="truncate text-sm font-semibold">{locationName}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
          since <LocalTime value={shift.opened_at} format="time" /> · float{" "}
          {formatMoney(shift.opening_float_cents, currency)} ·{" "}
          {cashierName}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCashDrawer} disabled={pending}>
          <Banknote />
          <span className="hidden sm:inline">Cash in/out</span>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onXReport} disabled={pending}>
          <FileText />
          <span className="hidden sm:inline">X report</span>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCloseShift} disabled={pending}>
          <LogOut />
          <span className="hidden sm:inline">Close shift</span>
        </Button>
      </div>
    </div>
  );
}
