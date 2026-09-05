"use client";

import { parseMoneyToCents } from "@ai-pos/shared";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";

import type { Notice as NoticeResult } from "./types";

/**
 * Closing the drawer. The expected figure stays hidden until the count is in —
 * a target you can see is a target you count towards, and the whole point of a
 * blind count is to catch the difference rather than paper over it.
 */
export function CloseShiftDialog({
  open,
  onOpenChange,
  currency,
  pending,
  notice,
  onCloseShift,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  pending: boolean;
  notice: NoticeResult;
  onCloseShift: (countedCents: number, note: string | null) => void;
}) {
  const [counted, setCounted] = React.useState("");
  const [note, setNote] = React.useState("");

  // A stale count from the last time this opened is worse than an empty box —
  // it is a number the cashier might not re-check.
  React.useEffect(() => {
    if (open) setCounted("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Close the shift</DialogTitle>
          <DialogDescription>
            Count the drawer and enter what is actually in it. The expected figure is
            deliberately hidden until you have.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="counted">Cash counted ({currency})</Label>
          <Input
            id="counted"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            autoFocus
            className="text-lg font-semibold tabular-nums"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="close-note">Note (optional)</Label>
          <Input
            id="close-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {notice && !notice.ok && <Notice tone="error">{notice.message}</Notice>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || counted === ""}
            onClick={() =>
              onCloseShift(parseMoneyToCents(counted, currency) ?? 0, note.trim() || null)
            }
          >
            {pending ? "Closing…" : "Count and close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
