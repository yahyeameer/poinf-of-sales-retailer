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
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 flex items-center gap-2.5">
          <BarChart3 className="h-6 w-6 text-emerald-600" />
          Sales & Financial Analytics
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          14-day revenue trends, payment channel breakdown, and transaction volumes.
        </p>
      </div>

      {/* Telemetry Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              14-Day Total Revenue
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <DollarSign className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {formatMoney(totalRev, currency)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Across {dailySales.length} calendar days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Transactions
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <ShoppingCart className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {totalTx}
            </div>
            <p className="text-xs text-slate-500 mt-1">Completed sales orders</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Average Basket Size
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-950 text-violet-600 dark:text-violet-400 flex items-center justify-center">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {formatMoney(avgBasket, currency)}
            </div>
            <p className="text-xs text-slate-500 mt-1">Per transaction ticket</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Cash Ratio
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <CreditCard className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {totalRev > 0 ? `${Math.round((cashTotal / totalRev) * 100)}%` : "0%"}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {formatMoney(cashTotal, currency)} cash sales
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Bar Chart Section */}
      <Card>
        <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-600" />
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
                    className="w-full bg-emerald-600 hover:bg-emerald-500 rounded-t-md transition-all duration-300 shadow-sm"
                    style={{ height: `${Math.max(heightPct, 8)}%` }}
                    title={`${d.day}: ${formatMoney(d.revenue_cents, currency)}`}
                  />
                  <span className="text-[10px] font-mono text-slate-400 mt-2 truncate w-full text-center">
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
        <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="text-base font-semibold">Payment Channel Distribution</CardTitle>
          <CardDescription>Breakdown by Tender Type across all registers</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Cash */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                  Cash Payments
                </span>
                <Badge variant="default">{totalRev > 0 ? Math.round((cashTotal / totalRev) * 100) : 0}%</Badge>
              </div>
              <div className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {formatMoney(cashTotal, currency)}
              </div>
            </div>

            {/* Mobile Money */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <Smartphone className="h-4 w-4 text-violet-600" />
                  Mobile Money / M-Pesa
                </span>
                <Badge variant="secondary">{totalRev > 0 ? Math.round((mobileTotal / totalRev) * 100) : 0}%</Badge>
              </div>
              <div className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {formatMoney(mobileTotal, currency)}
              </div>
            </div>

            {/* Card */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4 text-blue-600" />
                  Card Payments
                </span>
                <Badge variant="outline">{totalRev > 0 ? Math.round((cardTotal / totalRev) * 100) : 0}%</Badge>
              </div>
              <div className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {formatMoney(cardTotal, currency)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
