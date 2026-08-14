"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { CashKind, Notice as NoticeResult } from "./types";

const KIND_LABEL: Record<CashKind, string> = {
  pay_out: "Paying money out",
  pay_in: "Putting money in",
  drop: "Moving cash to the safe",
};

/**
 * Cash that moves without a sale — a delivery fare paid from the drawer, a
 * float top-up, a drop to the safe. Each one has to be recorded or the drawer
 * reads short at close and the cashier gets blamed for it.
 */
export function CashDialog({
  open,
  onOpenChange,
  currency,
  pending,
  notice,
  onRecord,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  pending: boolean;
  notice: NoticeResult;
  onRecord: (kind: CashKind, amountCents: number, reason: string) => void;
}) {
  const [kind, setKind] = React.useState<CashKind>("pay_out");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cash in or out</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="cash-kind">What is happening</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as CashKind)}>
            <SelectTrigger id="cash-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABEL) as CashKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cash-amount">Amount ({currency})</Label>
          <Input
            id="cash-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            className="tabular-nums"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cash-reason">What for</Label>
          <Input
            id="cash-reason"
            type="text"
            placeholder="e.g. delivery fare"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {notice && !notice.ok && <Notice tone="error">{notice.message}</Notice>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              onRecord(kind, Math.round((parseFloat(amount) || 0) * 100), reason);
              setAmount("");
              setReason("");
            }}
          >
            {pending ? "Recording…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
