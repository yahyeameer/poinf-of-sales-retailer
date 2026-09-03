import { formatMoney } from "@ai-pos/shared";
import { CheckCircle2, TrendingUp } from "lucide-react";

import { AccessGate } from "@/components/AccessGate";
import { Shell } from "@/components/Shell";
import { canAccessRoute } from "@/components/nav-items";
import { DemoBanner } from "@/components/DemoBanner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, navAccess } from "@/lib/tenant";

export const dynamic = "force-dynamic";

interface WeeklyStats {
  shop_name: string;
  currency: string;
  revenue_this_week: number;
  revenue_last_week: number;
  transactions_this_week: number;
  busiest_day: string | null;
  busiest_hour: number | null;
  top_5_movers: { name: string; units: number; revenue: number }[];
  dead_stock_30d: { name: string; stock_on_hand: number; days_since_last_sale: number | null }[];
  low_stock_alerts: { name: string; stock_on_hand: number; reorder_point: number }[];
}

function changeLine(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "no sales last week either" : "first week of sales";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% vs last week`;
}

function hourLabel(hour: number | null): string {
  if (hour === null) return "no clear peak";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
}

export default async function WeeklyReportPage() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return (
      <Shell shopName="Demo Retail Shop">
        <DemoBanner reason="You're not signed in, so there's no week to report on." />
        <h1 className="text-2xl font-bold tracking-tight text-gradient">Weekly Store Digest</h1>
      </Shell>
    );
  }

  // The digest is entirely takings, baskets and movers. None of it exists for
  // someone pinned to a warehouse, where RLS scopes sales away.
  const access = navAccess(ctx);
  if (!canAccessRoute("/reports/weekly", access)) {
    return (
      <Shell shopName={ctx.shopName}>
        <AccessGate href="/reports/weekly" access={access} />
      </Shell>
    );
  }

  const supabase = await createClient();

  // Every figure on this page used to be a literal — "+18%", "$1,850.00",
  // "412 units", "peaked on Friday afternoon" — presented as an executive
  // summary. weekly_report_stats() has been in the schema the whole time.
  const { data, error } = await supabase.rpc("weekly_report_stats", {
    p_tenant_id: ctx.tenantId,
    p_week_end: new Date().toISOString().slice(0, 10),
  });

  if (error) {
    console.error("[weekly] stats rpc failed:", error);
    return (
      <Shell shopName={ctx.shopName}>
        <DemoBanner reason={`Couldn't build this week's report: ${error.message}`} />
        <h1 className="text-2xl font-bold tracking-tight text-gradient">Weekly Store Digest</h1>
      </Shell>
    );
  }

  const stats = data as WeeklyStats;
  const currency = stats.currency ?? ctx.currency;
  const movers = stats.top_5_movers ?? [];
  const deadStock = stats.dead_stock_30d ?? [];
  const lowStock = stats.low_stock_alerts ?? [];

  return (
    <Shell shopName={ctx.shopName}>
      <h1 className="text-2xl font-bold tracking-tight text-gradient">Weekly Store Digest</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Last seven days, straight from the ledger. Numbers only — the written summary
        goes out by email once the digest job is wired up.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Revenue this week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {formatMoney(stats.revenue_this_week ?? 0, currency)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {changeLine(stats.revenue_this_week ?? 0, stats.revenue_last_week ?? 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {stats.transactions_this_week ?? 0}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {(stats.transactions_this_week ?? 0) > 0
                ? `${formatMoney(
                    Math.round((stats.revenue_this_week ?? 0) / stats.transactions_this_week),
                    currency,
                  )} average basket`
                : "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Busiest time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.busiest_day ?? "—"}</div>
            <p className="mt-1 text-xs text-muted-foreground">around {hourLabel(stats.busiest_hour)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-3">
            <CardTitle className="text-base">Top movers</CardTitle>
            <span className="text-xs text-muted-foreground">by revenue, last 7 days</span>
          </CardHeader>
          <CardContent className="p-0">
            {movers.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No sales this week"
                description="Best sellers appear here once the till takes money."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movers.map((m) => (
                    <TableRow key={m.name}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(m.units)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(m.revenue, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-3">
            <CardTitle className="text-base">Not selling</CardTitle>
            <span className="text-xs text-muted-foreground">no sale in 30 days</span>
          </CardHeader>
          <CardContent className="p-0">
            {deadStock.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Nothing is sitting still"
                description="Everything on the shelf has sold in the last month."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Days since last sale</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deadStock.map((d) => (
                    <TableRow key={d.name}>
                      <TableCell>{d.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(d.stock_on_hand)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {d.days_since_last_sale === null ? (
                          <Badge variant="secondary" className="font-normal">
                            never sold
                          </Badge>
                        ) : (
                          d.days_since_last_sale
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-base">Reorder before you run out</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {lowStock.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Nothing needs reordering"
                description="Every product is above its reorder point."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Reorder at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStock.map((l) => (
                    <TableRow key={l.name}>
                      <TableCell>{l.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(l.stock_on_hand)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {Number(l.reorder_point)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
