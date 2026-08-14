"use client";

import { formatMoney } from "@ai-pos/shared";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, ShoppingCart, DollarSign, CreditCard, Smartphone, Calendar } from "lucide-react";

interface DailySale {
  day: string;
  transactions: number;
  revenue_cents: number;
  cash_cents: number;
  mobile_money_cents: number;
  card_cents: number;
}

export function AnalyticsClient({
  dailySales,
  currency,
}: {
  dailySales: DailySale[];
  currency: string;
}) {
  const totalRev = dailySales.reduce((acc, r) => acc + Number(r.revenue_cents || 0), 0);
  const totalTx = dailySales.reduce((acc, r) => acc + Number(r.transactions || 0), 0);
  const avgBasket = totalTx > 0 ? Math.round(totalRev / totalTx) : 0;

  const cashTotal = dailySales.reduce((acc, r) => acc + Number(r.cash_cents || 0), 0);
  const mobileTotal = dailySales.reduce((acc, r) => acc + Number(r.mobile_money_cents || 0), 0);
  const cardTotal = dailySales.reduce((acc, r) => acc + Number(r.card_cents || 0), 0);

  const maxRev = Math.max(...dailySales.map((r) => Number(r.revenue_cents || 0)), 1);

  return (
    <div className="max-w-7xl mx-auto space-y-6 font-sans">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
          <BarChart3 className="size-6 text-primary" />
          Sales & Financial Analytics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          14-day revenue trends, payment channel breakdown, and transaction volumes.
        </p>
      </div>

      {/* Telemetry Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              14-Day Total Revenue
            </CardTitle>
            <div className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
              <DollarSign className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gradient">
              {formatMoney(totalRev, currency)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Across {dailySales.length} calendar days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Transactions
            </CardTitle>
            <div className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
              <ShoppingCart className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gradient">
              {totalTx}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Completed sales orders</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Average Basket Size
            </CardTitle>
            <div className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gradient">
              {formatMoney(avgBasket, currency)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Per transaction ticket</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cash Ratio
            </CardTitle>
            <div className="grid size-8 place-items-center rounded-lg bg-warning/12 text-warning">
              <CreditCard className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gradient">
              {totalRev > 0 ? `${Math.round((cashTotal / totalRev) * 100)}%` : "0%"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatMoney(cashTotal, currency)} cash sales
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Bar Chart Section */}
      <Card>
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-primary" />
              <CardTitle className="text-base font-semibold">14-Day Revenue Sparkline Bar Chart</CardTitle>
            </div>
            <Badge variant="outline" className="font-mono text-xs">Daily Totals</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="flex items-end gap-2.5 h-48 pt-4">
            {dailySales.map((d) => {
              const heightPct = Math.round((Number(d.revenue_cents || 0) / maxRev) * 100);
              return (
                <div
                  key={d.day}
                  className="flex-1 flex flex-col items-center h-full justify-end group relative"
                >
                  <div
                    className="w-full rounded-t-md bg-primary transition-all duration-300 hover:brightness-110"
                    style={{ height: `${Math.max(heightPct, 8)}%` }}
                    title={`${d.day}: ${formatMoney(d.revenue_cents, currency)}`}
                  />
                  <span className="mt-2 w-full truncate text-center font-mono text-[10px] text-muted-foreground">
                    {d.day.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Payment Distribution Section */}
      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-base font-semibold">Payment Channel Distribution</CardTitle>
          <CardDescription>Breakdown by Tender Type across all registers</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Cash */}
            <div className="space-y-2 rounded-xl border border-border bg-muted p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <DollarSign className="size-4 text-muted-foreground" />
                  Cash Payments
                </span>
                <Badge variant="default">{totalRev > 0 ? Math.round((cashTotal / totalRev) * 100) : 0}%</Badge>
              </div>
              <div className="text-xl font-bold text-foreground">
                {formatMoney(cashTotal, currency)}
              </div>
            </div>

            {/* Mobile Money */}
            <div className="space-y-2 rounded-xl border border-border bg-muted p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Smartphone className="size-4 text-muted-foreground" />
                  Mobile Money / M-Pesa
                </span>
                <Badge variant="secondary">{totalRev > 0 ? Math.round((mobileTotal / totalRev) * 100) : 0}%</Badge>
              </div>
              <div className="text-xl font-bold text-foreground">
                {formatMoney(mobileTotal, currency)}
              </div>
            </div>

            {/* Card */}
            <div className="space-y-2 rounded-xl border border-border bg-muted p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <CreditCard className="size-4 text-muted-foreground" />
                  Card Payments
                </span>
                <Badge variant="outline">{totalRev > 0 ? Math.round((cardTotal / totalRev) * 100) : 0}%</Badge>
              </div>
              <div className="text-xl font-bold text-foreground">
                {formatMoney(cardTotal, currency)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
