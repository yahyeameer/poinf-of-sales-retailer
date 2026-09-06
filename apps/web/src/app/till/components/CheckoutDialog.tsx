"use client";

import {
  centsToInput,
  convertMinor,
  currencyDisplay,
  formatMoney,
  parseMoneyToCents,
} from "@ai-pos/shared";
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

import {
  METHOD_LABEL,
  type CounterCurrency,
  type Method,
  type Notice as NoticeResult,
  type Tender,
} from "./types";

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
  counter,
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
  /** Null for a shop that takes only its own money, which is most of them. */
  counter: CounterCurrency | null;
  totalCents: number;
  tenders: Tender[];
  setTenders: React.Dispatch<React.SetStateAction<Tender[]>>;
  pending: boolean;
  notice: NoticeResult;
  onSubmit: () => void;
}) {
  // Amounts are always the shop's currency, whatever the customer hands over.
  // That is what keeps "tenders must equal the total exactly" checkable, and
  // it is why settling in shillings cannot move a sale total.
  const tendersTotal = tenders.reduce(
    (sum, t) => sum + (parseMoneyToCents(t.amount, currency) ?? 0),
    0,
  );
  const outstanding = totalCents - tendersTotal;

  /** The currency a given leg is physically settled in. */
  const legCurrency = (t: Tender) => (t.inSecondary && counter ? counter.code : currency);

  /** What this leg is worth in the money the customer is actually holding. */
  const legDue = (t: Tender) => {
    const amount = parseMoneyToCents(t.amount, currency) ?? 0;
    return t.inSecondary && counter
      ? convertMinor(amount, currency, counter.code, counter.rate)
      : amount;
  };

  // Change is given in whatever was handed over. A customer paying 110,000
  // shillings for a 102,000 basket wants 8,000 shillings back, not its value
  // in dollars — and the drawer only holds one of those.
  //
  // This figure is the authoritative one: it is computed entirely within the
  // currency being handed over, so it is exact. The change on the receipt is
  // derived from tendered_cents, which is the shop-currency rounding of the
  // same event, and the two can differ by a few shillings — 8,000 SLSH is
  // $0.94 to the nearest cent and $0.94 is 7,990 SLSH back again. That gap is
  // arithmetic, not a bug: at 8,500 to the dollar a single cent is 85
  // shillings, so no cent figure can name every shilling amount. The cashier
  // hands over what this line says; the smallest note in circulation is 500,
  // which is twenty times the largest possible discrepancy.
  const changeByCurrency = tenders
    .filter((t) => t.method === "cash")
    .reduce<Record<string, number>>((acc, t) => {
      const code = legCurrency(t);
      const tendered = parseMoneyToCents(t.tendered, code) ?? 0;
      const change = Math.max(0, tendered - legDue(t));
      if (change > 0) acc[code] = (acc[code] ?? 0) + change;
      return acc;
    }, {});

  const patch = (i: number, values: Partial<Tender>) =>
    setTenders((prev) => prev.map((t, j) => (j === i ? { ...t, ...values } : t)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
        </DialogHeader>

        <div className="rounded-xl bg-primary-soft px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-primary">Due</span>
            <strong className="text-2xl font-bold tabular-nums text-primary">
              {formatMoney(totalCents, currency)}
            </strong>
          </div>
          {/* The number the cashier says out loud when the shop prices in one
              currency and the customer pays in another. */}
          {counter && (
            <div className="mt-1 flex items-baseline justify-between border-t border-primary/15 pt-1">
              <span className="text-xs text-muted-foreground">
                at {counter.rate.toLocaleString()} per {currencyDisplay(currency)}
              </span>
              <strong className="tabular-nums text-primary">
                {formatMoney(
                  convertMinor(totalCents, currency, counter.code, counter.rate),
                  counter.code,
                )}
              </strong>
            </div>
          )}
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
                    <Label htmlFor={`given-${i}`}>
                      Cash given{counter && t.inSecondary ? ` (${currencyDisplay(counter.code)})` : ""}
                    </Label>
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

              {/* Only cash. A card or a mobile-money transfer settles in the
                  account's own currency; there is no drawer to take shillings
                  into and no change to hand back. */}
              {counter && t.method === "cash" && (
                <div className="space-y-1 rounded-md bg-muted/50 px-2 py-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[hsl(var(--primary))]"
                      checked={!!t.inSecondary}
                      onChange={(e) =>
                        // The given box is re-read in the other currency, so a
                        // figure typed for the old one is now a wrong number
                        // rather than a stale one. Clearing it is the honest move.
                        patch(i, { inSecondary: e.target.checked, tendered: "" })
                      }
                    />
                    <span>Paying in {currencyDisplay(counter.code)}</span>
                  </label>
                  {t.inSecondary && (
                    <p className="text-xs text-muted-foreground">
                      Collect{" "}
                      <strong className="tabular-nums text-foreground">
                        {formatMoney(legDue(t), counter.code)}
                      </strong>{" "}
                      for this {formatMoney(parseMoneyToCents(t.amount, currency) ?? 0, currency)}.
                    </p>
                  )}
                </div>
              )}
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
                  amount: centsToInput(Math.max(0, outstanding), currency),
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
          {Object.entries(changeByCurrency).map(([code, amount]) => (
            <div key={code} className="flex items-baseline justify-between pt-1">
              <dt className="font-semibold">
                Change{Object.keys(changeByCurrency).length > 1 ? ` (${currencyDisplay(code)})` : ""}
              </dt>
              <dd className="text-xl font-bold tabular-nums text-primary">
                {formatMoney(amount, code)}
              </dd>
            </div>
          ))}
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
