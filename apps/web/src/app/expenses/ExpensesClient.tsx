"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, parseMoneyToCents } from "@ai-pos/shared";
import { Plus, Receipt, Trash2, TrendingDown, TrendingUp } from "lucide-react";

import { LocalTime } from "@/components/LocalTime";
import { ProfitTrend } from "@/components/charts/ProfitTrend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionNotice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import type { ShopLocation } from "@/lib/tenant";
import {
  CATEGORY_LABEL,
  EXPENSE_CATEGORIES,
  deleteExpense,
  recordExpense,
  type ExpenseCategory,
} from "@/app/expenses-actions";

export interface ExpenseRow {
  id: string;
  category: ExpenseCategory;
  amount_cents: number;
  note: string | null;
  spent_on: string;
  location_id: string | null;
  created_by: string | null;
}

interface Totals {
  revenue: number;
  grossMargin: number;
  expenses: number;
  netProfit: number;
}

const ALL_LOCATIONS = "__all__";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function ExpensesClient({
  expenses,
  totals,
  trend,
  currency,
  locations,
  activeLocationId,
}: {
  expenses: ExpenseRow[];
  totals: Totals;
  trend: {
    day: string;
    gross_margin_cents: number;
    expenses_cents: number;
    net_profit_cents: number;
  }[];
  currency: string;
  locations: ShopLocation[];
  activeLocationId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const [category, setCategory] = useState<ExpenseCategory>("rent");
  const [amount, setAmount] = useState("");
  const [spentOn, setSpentOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [locationId, setLocationId] = useState<string>(activeLocationId ?? ALL_LOCATIONS);

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await fn();
      setNotice(result);
      if (result.ok) router.refresh();
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // parseMoneyToCents, not Number(x) * 100: it is the same function the till
    // uses, so a currency with no minor unit is handled here the same way.
    const cents = parseMoneyToCents(amount, currency);
    if (cents === null || cents <= 0) {
      setNotice({ ok: false, message: "Enter an amount greater than zero." });
      return;
    }

    startTransition(async () => {
      const result = await recordExpense({
        category,
        amountCents: cents,
        spentOn,
        note,
        locationId: locationId === ALL_LOCATIONS ? null : locationId,
      });
      setNotice(result);
      if (result.ok) {
        setOpen(false);
        setAmount("");
        setNote("");
        router.refresh();
      }
    });
  }

  const profitable = totals.netProfit >= 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the shop spends, so profit means profit rather than margin.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-1.5">
          <Plus className="size-4" />
          Record an expense
        </Button>
      </div>

      <ActionNotice result={notice} />

      {/* The four numbers, in the order the arithmetic happens: what came in,
          what was left after the goods, what went out, what is actually left.
          Reading them left to right is the calculation. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Revenue" hint="Last 30 days" value={formatMoney(totals.revenue, currency)} />
        <Stat
          label="Kept on goods"
          hint="After what stock cost"
          value={formatMoney(totals.grossMargin, currency)}
        />
        <Stat
          label="Spent"
          hint="Rent, wages, everything else"
          value={formatMoney(totals.expenses, currency)}
        />
        <Stat
          label="Left over"
          hint={profitable ? "Actual profit" : "Running at a loss"}
          value={formatMoney(totals.netProfit, currency)}
          tone={profitable ? "good" : "bad"}
          icon={profitable ? TrendingUp : TrendingDown}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">What was left, by day</CardTitle>
          <p className="text-xs text-muted-foreground">
            Margin on what sold, minus what was spent that day.
          </p>
        </CardHeader>
        <CardContent>
          <ProfitTrend data={trend} currency={currency} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Recent expenses</CardTitle>
            <Badge variant="outline" className="font-mono text-xs">
              {expenses.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {expenses.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nothing recorded yet"
              description="Add rent, wages, transport — anything that leaves the till but isn't stock."
            />
          ) : (
            <ul className="divide-y divide-border">
              {expenses.map((e) => {
                const location = locations.find((l) => l.id === e.location_id);
                return (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5"
                  >
                    <Badge variant="secondary" className="text-xs">
                      {CATEGORY_LABEL[e.category] ?? e.category}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {e.note || <span className="text-muted-foreground">No note</span>}
                      <span className="ml-2 text-xs text-muted-foreground">
                        <LocalTime value={e.spent_on} format="date" />
                        {location ? ` · ${location.name}` : ""}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatMoney(e.amount_cents, currency)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove this expense"
                      disabled={pending}
                      onClick={() => run(() => deleteExpense(e.id))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Record an expense</DialogTitle>
              <DialogDescription>
                Money that left the business but wasn&apos;t stock. Stock is already counted
                against each sale.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label>Category</Label>
              {/* Buttons rather than a select: eight options, and on a phone a
                  native select is a full-screen wheel for something that should
                  be one tap. */}
              <div className="flex flex-wrap gap-1.5">
                {EXPENSE_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={category === c}
                    className={cn(
                      "min-h-10 rounded-lg border px-3 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      category === c
                        ? "border-primary/45 bg-primary-soft text-primary"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {CATEGORY_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ex-amount">Amount</Label>
                <Input
                  id="ex-amount"
                  inputMode="decimal"
                  autoFocus
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ex-date">Date</Label>
                <Input
                  id="ex-date"
                  type="date"
                  max={todayIso()}
                  value={spentOn}
                  onChange={(e) => setSpentOn(e.target.value)}
                />
              </div>
            </div>

            {locations.length > 1 && (
              <div className="space-y-2">
                <Label>Belongs to</Label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLocationId(ALL_LOCATIONS)}
                    aria-pressed={locationId === ALL_LOCATIONS}
                    className={cn(
                      "min-h-10 rounded-lg border px-3 text-sm",
                      locationId === ALL_LOCATIONS
                        ? "border-primary/45 bg-primary-soft text-primary"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    Whole business
                  </button>
                  {locations.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setLocationId(l.id)}
                      aria-pressed={locationId === l.id}
                      className={cn(
                        "min-h-10 rounded-lg border px-3 text-sm",
                        locationId === l.id
                          ? "border-primary/45 bg-primary-soft text-primary"
                          : "border-border bg-card text-muted-foreground",
                      )}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ex-note">Note (optional)</Label>
              <Input
                id="ex-note"
                placeholder="March rent, driver for the Tuesday run…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Record"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "good" | "bad";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5">
          {Icon && (
            <Icon
              className={cn(
                "size-4",
                tone === "bad" ? "text-destructive" : "text-[var(--chart-margin)]",
              )}
            />
          )}
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
        </div>
        {/* The number wears an ink token unless its sign is the message. */}
        <p
          className={cn(
            "mt-1 text-2xl font-bold tabular-nums",
            tone === "bad" && "text-destructive",
          )}
        >
          {value}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
