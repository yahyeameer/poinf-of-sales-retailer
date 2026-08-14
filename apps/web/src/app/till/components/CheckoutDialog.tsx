"use client";

import { formatMoney } from "@ai-pos/shared";
import { Plus, X } from "lucide-react";

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
import { cn } from "@/lib/utils";

import { METHOD_LABEL, type Method, type Notice as NoticeResult, type Tender } from "./types";

/**
 * Taking the money. The one rule enforced here is that the tenders must add up
 * to the total exactly — over-tendering goes in "Given", which is what produces
 * change. Letting a sale post with a mismatch would put the drawer out by the
 * difference and only surface at close, hours later.
 */
export function CheckoutDialog({
  open,
  onOpenChange,
  currency,
  totalCents,
  tenders,
  setTenders,
  pending,
  notice,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  totalCents: number;
  tenders: Tender[];
  setTenders: React.Dispatch<React.SetStateAction<Tender[]>>;
  pending: boolean;
  notice: NoticeResult;
  onSubmit: () => void;
}) {
  const tendersTotal = tenders.reduce(
    (sum, t) => sum + Math.round((parseFloat(t.amount) || 0) * 100),
    0,
  );
  const outstanding = totalCents - tendersTotal;
  const cashChange = tenders
    .filter((t) => t.method === "cash")
    .reduce((sum, t) => {
      const tendered = Math.round((parseFloat(t.tendered) || 0) * 100);
      const amount = Math.round((parseFloat(t.amount) || 0) * 100);
      return sum + Math.max(0, tendered - amount);
    }, 0);

  const patch = (i: number, values: Partial<Tender>) =>
    setTenders((prev) => prev.map((t, j) => (j === i ? { ...t, ...values } : t)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
        </DialogHeader>

        <div className="flex items-baseline justify-between rounded-xl bg-primary-soft px-4 py-3">
          <span className="text-sm font-medium text-primary">Due</span>
          <strong className="text-2xl font-bold tabular-nums text-primary">
            {formatMoney(totalCents, currency)}
          </strong>
        </div>

        <div className="space-y-3">
          {tenders.map((t, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor={`method-${i}`}>Method</Label>
                  <Select
                    value={t.method}
                    onValueChange={(v) => patch(i, { method: v as Method })}
                  >
                    <SelectTrigger id={`method-${i}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
                        <SelectItem key={m} value={m}>
                          {METHOD_LABEL[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {tenders.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mt-5 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${METHOD_LABEL[t.method]} payment`}
                    onClick={() => setTenders((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`amount-${i}`}>Amount</Label>
                  <Input
                    id={`amount-${i}`}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="0.00"
                    className="tabular-nums"
                    value={t.amount}
                    onChange={(e) => patch(i, { amount: e.target.value })}
                  />
                </div>
                {t.method === "cash" && (
                  <div className="space-y-1">
                    <Label htmlFor={`given-${i}`}>Cash given</Label>
                    <Input
                      id={`given-${i}`}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder="0.00"
                      className="tabular-nums"
                      value={t.tendered}
                      onChange={(e) => patch(i, { tendered: e.target.value })}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setTenders((prev) => [
                ...prev,
                {
                  method: "mobile_money",
                  amount: (Math.max(0, outstanding) / 100).toFixed(2),
                  tendered: "",
                },
              ])
            }
          >
            <Plus />
            Split across another method
          </Button>
        </div>

        <dl className="space-y-1 border-t border-border pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Tendered</dt>
            <dd className="tabular-nums">{formatMoney(tendersTotal, currency)}</dd>
          </div>
          {outstanding !== 0 && (
            <div className={cn("flex justify-between font-semibold", "text-warning")}>
              <dt>{outstanding > 0 ? "Still owing" : "Over by"}</dt>
              <dd className="tabular-nums">{formatMoney(Math.abs(outstanding), currency)}</dd>
            </div>
          )}
          {cashChange > 0 && (
            <div className="flex items-baseline justify-between pt-1">
              <dt className="font-semibold">Change</dt>
              <dd className="text-xl font-bold tabular-nums text-primary">
                {formatMoney(cashChange, currency)}
              </dd>
            </div>
          )}
        </dl>

        {notice && !notice.ok && <Notice tone="error">{notice.message}</Notice>}

        {outstanding !== 0 && (
          <p className="text-xs text-muted-foreground">
            Payments have to add up to the total exactly. Change goes in the
            &ldquo;Cash given&rdquo; box, not the amount.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button type="button" size="lg" disabled={pending || outstanding !== 0} onClick={onSubmit}>
            {pending ? "Posting…" : "Complete sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
