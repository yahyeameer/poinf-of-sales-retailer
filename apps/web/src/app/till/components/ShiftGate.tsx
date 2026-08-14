"use client";

import * as React from "react";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionNotice } from "@/components/ui/notice";

import type { Notice } from "./types";

/**
 * Until a shift is open there is nothing else on this screen worth showing —
 * every sale has to belong to one, and the opening float is what the drawer is
 * later measured against.
 */
export function ShiftGate({
  currency,
  pending,
  notice,
  onOpenShift,
}: {
  currency: string;
  pending: boolean;
  notice: Notice;
  onOpenShift: (floatCents: number) => void;
}) {
  const [floatInput, setFloatInput] = React.useState("50.00");

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-5 aurora">
      <div className="space-y-2 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary glow-md">
          <Lock className="size-5" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-gradient">Open the till</h1>
        <p className="text-sm text-muted-foreground">
          Count the cash in the drawer and enter it. Everything sold this shift is
          measured against this number, so it is worth getting right.
        </p>
      </div>

      <ActionNotice result={notice} />

      <Card glow="md">
        <CardHeader>
          <CardTitle>Opening float</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="float">Amount in the drawer ({currency})</Label>
            <Input
              id="float"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={floatInput}
              onChange={(e) => setFloatInput(e.target.value)}
              autoFocus
              className="text-lg font-semibold tabular-nums"
            />
          </div>
          <Button
            type="button"
            size="till"
            block="always"
            disabled={pending}
            onClick={() => onOpenShift(Math.round((parseFloat(floatInput) || 0) * 100))}
          >
            {pending ? "Opening…" : "Open shift"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
