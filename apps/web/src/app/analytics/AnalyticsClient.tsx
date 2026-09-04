"use client";

import Link from "next/link";
import { formatMoney } from "@ai-pos/shared";
import {
  BarChart3,
  Coins,
  PackageX,
  Percent,
  Receipt,
  ShoppingCart,
  TriangleAlert,
} from "lucide-react";

import { DemoBanner } from "@/components/DemoBanner";
import { LocalTime } from "@/components/LocalTime";
import { MarginTrend } from "@/components/charts/MarginTrend";
import { PaymentMix } from "@/components/charts/PaymentMix";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { RANGES, type RangeKey } from "./ranges";

export interface AnalyticsData {
  daily: {
    day: string;
    transactions: number;
    revenue_cents: number;
    margin_cents: number;
    cash_cents: number;
    mobile_money_cents: number;
    card_cents: number;
  }[];
  previous: { revenue_cents: number; transactions: number; margin_cents: number };
  topProducts: {
    product_id: string;
    name: string;
    units: number;
    revenue_cents: number;
    margin_cents: number;
  }[];
  deadStock: {
    product_id: string;
    name: string;
    stock_on_hand: number;
    tied_up_cents: number;
    days_since_last_sale: number | null;
  }[];
  cashiers: {
    cashier_id: string;
    cashier_name: string;
    transactions: number;
    revenue_cents: number;
    voids: number;
  }[];
}

/** Percentage change, or undefined when there is no baseline to compare to —
 *  a tile with no delta is honest; "+100%" against zero is not. */
function pctChange(current: number, previous: number): number | undefined {
  if (previous <= 0) return undefined;
  return ((current - previous) / previous) * 100;
}

/**
 * What the shop actually made.
 *
 * The previous version of this screen showed revenue four different ways and
 * called it analytics. Revenue is the number that flatters: a shop can take
 * more money every week while making less, and nothing here would have said
 * so. Three things the database already knew and nothing displayed —
 * margin per sale (cost snapshotted at the moment of sale), capital sitting in
 * stock that has not moved in a month, and voids per cashier — are the whole
 * point of this rewrite. Two of the three views behind them had no caller at
 * all.
 */
export function AnalyticsClient({
  data,
  currency,
  range,
  demoReason,
}: {
  data: AnalyticsData;
  currency: string;
  range: RangeKey;
  demoReason: string | null;
}) {
  const revenue = data.daily.reduce((s, d) => s + d.revenue_cents, 0);
  const margin = data.daily.reduce((s, d) => s + d.margin_cents, 0);
  const transactions = data.daily.reduce((s, d) => s + d.transactions, 0);
  const basket = transactions > 0 ? Math.round(revenue / transactions) : 0;
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;

  const prevBasket =
    data.previous.transactions > 0
      ? Math.round(data.previous.revenue_cents / data.previous.transactions)
      : 0;

  const tiedUp = data.deadStock.reduce((s, d) => s + d.tied_up_cents, 0);
  const topMargin = Math.max(1, ...data.topProducts.map((p) => Math.abs(p.margin_cents)));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {demoReason && <DemoBanner reason={demoReason} />}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
            <BarChart3 className="size-6 text-primary" />
            Analytics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What you took, what it cost you, and what is sitting still.
          </p>
        </div>

        {/* Filters in one row above the charts. Links rather than client state,
            so a range survives a refresh and can be sent to someone. */}
        <div
          className="inline-flex rounded-lg border border-border bg-card p-1"
          role="group"
          aria-label="Date range"
        >
          {(Object.keys(RANGES) as RangeKey[]).map((key) => (
            <Link
              key={key}
              href={`/analytics?range=${key}` as never}
              aria-current={range === key ? "true" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                range === key
                  ? "bg-primary-soft text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {RANGES[key].label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Revenue"
          value={formatMoney(revenue, currency)}
          icon={Receipt}
          delta={pctChange(revenue, data.previous.revenue_cents)}
          deltaLabel="vs previous period"
          hint={`${RANGES[range].label} to today`}
        />
        <StatTile
          label="Gross margin"
          value={formatMoney(margin, currency)}
          icon={Coins}
          hint={`${marginPct.toFixed(1)}% of revenue kept`}
        />
        <StatTile
          label="Sales"
          value={transactions.toLocaleString()}
          icon={ShoppingCart}
          delta={pctChange(transactions, data.previous.transactions)}
          deltaLabel="vs previous period"
        />
        <StatTile
          label="Average basket"
          value={formatMoney(basket, currency)}
          icon={Percent}
          delta={pctChange(basket, prevBasket)}
          deltaLabel="vs previous period"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue and what you kept</CardTitle>
          <CardDescription>
            Each column is a day&apos;s takings, split into the cost of the goods and the
            margin left over. Cost is what you actually paid at the time, not today&apos;s
            price.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MarginTrend
            data={data.daily.map((d) => ({
              day: d.day,
              revenue_cents: d.revenue_cents,
              margin_cents: d.margin_cents,
            }))}
            currency={currency}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>How people paid</CardTitle>
            <CardDescription>Share of takings by tender over the period</CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentMix
              cash={data.daily.reduce((s, d) => s + d.cash_cents, 0)}
              mobile={data.daily.reduce((s, d) => s + d.mobile_money_cents, 0)}
              card={data.daily.reduce((s, d) => s + d.card_cents, 0)}
              currency={currency}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Earners, by margin</CardTitle>
            <CardDescription>
              Ranked by money kept, not units shifted — the two orders are rarely the same
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {data.topProducts.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="Nothing sold in this period"
                description="Once the till takes payments, the best earners appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {data.topProducts.map((p) => {
                  const pct = p.revenue_cents > 0 ? (p.margin_cents / p.revenue_cents) * 100 : 0;
                  return (
                    <li key={p.product_id} className="space-y-1.5 px-5 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {formatMoney(p.margin_cents, currency)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(2, (Math.abs(p.margin_cents) / topMargin) * 100)}%`,
                            background:
                              p.margin_cents < 0
                                ? "var(--destructive)"
                                : "var(--chart-margin)",
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {p.units.toLocaleString()} sold ·{" "}
                        {formatMoney(p.revenue_cents, currency)} revenue ·{" "}
                        <span className={pct < 0 ? "text-destructive" : undefined}>
                          {pct.toFixed(0)}% margin
                        </span>
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PackageX className="size-4 text-warning" />
              Money sitting still
            </CardTitle>
            <CardDescription>
              In stock, but nothing sold in over a month. This is cash you have already
              spent.
            </CardDescription>
          </div>
          {tiedUp > 0 && (
            <Badge variant="warning" className="shrink-0 tabular-nums">
              {formatMoney(tiedUp, currency)} tied up
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {data.deadStock.length === 0 ? (
            <EmptyState
              icon={PackageX}
              title="Everything is moving"
              description="Nothing you hold has gone a month without selling."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Cash tied up</TableHead>
                    <TableHead className="text-right">Last sold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.deadStock.map((d) => (
                    <TableRow key={d.product_id}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {d.stock_on_hand.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(d.tied_up_cents, currency)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {d.days_since_last_sale === null
                          ? "never"
                          : `${d.days_since_last_sale} days ago`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who rang it up</CardTitle>
          <CardDescription>
            Voids are here because a pattern of them is worth noticing — not because any
            single one is wrong.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.cashiers.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="No sales attributed yet"
              description="Sales are credited to whoever is signed in at the till."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cashier</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Takings</TableHead>
                    <TableHead className="text-right">Voids</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.cashiers.map((c) => {
                    // A rate, not a count: ten voids across a thousand sales is
                    // noise, ten across forty is a conversation.
                    const rate = c.transactions > 0 ? (c.voids / c.transactions) * 100 : 0;
                    const notable = c.voids > 0 && rate >= 5;
                    return (
                      <TableRow key={c.cashier_id}>
                        <TableCell className="font-medium">{c.cashier_name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.transactions.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatMoney(c.revenue_cents, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {/* Status colour carries an icon and a label, never
                              colour alone. */}
                          {notable ? (
                            <span className="inline-flex items-center gap-1.5 text-warning">
                              <TriangleAlert className="size-3.5" aria-hidden />
                              {c.voids} ({rate.toFixed(0)}%)
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{c.voids}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
