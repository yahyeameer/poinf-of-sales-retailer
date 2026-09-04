import { redirect } from "next/navigation";
import { formatMoney } from "@ai-pos/shared";

import { LocalTime } from "@/components/LocalTime";
import { Shell } from "@/components/Shell";
import { AiAssistant } from "@/components/AiAssistant";
import { DemoBanner } from "@/components/DemoBanner";
import { dashboardHref } from "@/components/nav-items";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, navAccess } from "@/lib/tenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { RevenueTrend } from "@/components/charts/RevenueTrend";
import { PaymentMix } from "@/components/charts/PaymentMix";
import { TopProducts } from "@/components/charts/TopProducts";
import { 
  TrendingUp, 
  ShoppingCart, 
  DollarSign, 
  CreditCard, 
  AlertTriangle, 
  ArrowUpRight,
  CheckCircle2
} from "lucide-react";

export const dynamic = "force-dynamic";

function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

function percentChange(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "no change" : "first sales this week";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% vs last week`;
}

export default async function DashboardPage() {
  // Warehouse staff get their own dashboard. Redirecting rather than gating,
  // because "/" is where every stale bookmark and every post-login bounce lands
  // and there is a real page for them to be on. Owners are unpinned and stay.
  const ctx = await getTenantContext();
  if (ctx) {
    const home = dashboardHref(navAccess(ctx));
    if (home !== "/") redirect(home);
  }

  let shopName = "Demo Retail Shop";
  let userName = "Owner";
  let userRole = "owner";
  let currency = "USD";
  let oversold = 0;

  let demoReason: string | null = null;
  let rows: any[] = [
    { day: isoDay(0), transactions: 14, revenue_cents: 18500, cash_cents: 12000, mobile_money_cents: 6500, card_cents: 0 },
    { day: isoDay(1), transactions: 22, revenue_cents: 31200, cash_cents: 19000, mobile_money_cents: 12200, card_cents: 0 },
    { day: isoDay(2), transactions: 19, revenue_cents: 24500, cash_cents: 15000, mobile_money_cents: 9500, card_cents: 0 },
  ];
  let lowStock: any[] = [
    { product_id: "6", name: "Wheat Flour 2kg", stock_on_hand: 0, reorder_point: 10 },
    { product_id: "5", name: "Whole Milk 1L", stock_on_hand: 2, reorder_point: 8 },
    { product_id: "3", name: "Sunflower Oil 1L", stock_on_hand: 4, reorder_point: 5 },
  ];
  let topMovers: any[] = [
    { name: "Coca-Cola 500ml", units: 48, revenue_cents: 7200 },
    { name: "Basmati Rice 5kg", units: 12, revenue_cents: 15000 },
    { name: "Sunflower Oil 1L", units: 15, revenue_cents: 5700 },
  ];

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from("users")
        .select("name, role, tenant_id")
        .eq("id", user.id)
        .single();

      if (profile) {
        userName = profile.name || userName;
        userRole = profile.role || userRole;
      }

      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, currency")
        .single();

      if (tenant) {
        shopName = tenant.name || shopName;
        currency = tenant.currency || currency;
      }

      const [{ data: daily }, { data: dbLowStock }, { data: dbTopMovers }, { data: dbOversold }] =
        await Promise.all([
          supabase
            .from("v_sales_daily")
            .select("day, transactions, revenue_cents, cash_cents, mobile_money_cents, card_cents")
            .gte("day", isoDay(13))
            .order("day", { ascending: false }),

          supabase
            .from("v_low_stock")
            .select("product_id, name, stock_on_hand, reorder_point")
            .order("stock_on_hand", { ascending: true })
            .limit(8),

          supabase
            .from("v_product_performance")
            .select("name, units, revenue_cents")
            .gte("day", isoDay(6)),

          supabase
            .from("sales")
            .select("id", { count: "exact", head: true })
            .eq("has_oversell", true),
        ]);

      if (daily && daily.length > 0) rows = daily;
      if (dbLowStock) lowStock = dbLowStock;
      if (dbTopMovers) topMovers = dbTopMovers;
      if (dbOversold !== null) oversold = dbOversold as any;

      if (!daily || daily.length === 0) {
        rows = [];
        lowStock = dbLowStock ?? [];
        topMovers = dbTopMovers ?? [];
      }
    } else {
      demoReason = "You're not signed in, so these are sample figures.";
    }
  } catch (error) {
    demoReason =
      error instanceof Error
        ? `Couldn't reach the database (${error.message}), so these are sample figures.`
        : "Couldn't reach the database, so these are sample figures.";
    console.error("[dashboard] falling back to demo data:", error);
  }

  const today = rows.find((r) => r.day === isoDay(0));
  const thisWeek = rows.filter((r) => r.day >= isoDay(6));
  const lastWeek = rows.filter((r) => r.day < isoDay(6) && r.day >= isoDay(13));

  const sum = (list: typeof rows, key: "revenue_cents" | "transactions") =>
    list.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

  const weekRevenue = sum(thisWeek, "revenue_cents");
  const prevRevenue = sum(lastWeek, "revenue_cents");
  const weekTransactions = sum(thisWeek, "transactions");

  const movers = Object.values(
    (topMovers ?? []).reduce<Record<string, { name: string; units: number; revenue: number }>>(
      (acc, row) => {
        const key = row.name as string;
        acc[key] ??= { name: key, units: 0, revenue: 0 };
        acc[key].units += Number(row.units ?? 0);
        acc[key].revenue += Number(row.revenue_cents ?? 0);
        return acc;
      },
      {}
    )
  )
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const cashSplit = thisWeek.reduce(
    (acc, r) => ({
      cash: acc.cash + Number(r.cash_cents ?? 0),
      mobile: acc.mobile + Number(r.mobile_money_cents ?? 0),
      card: acc.card + Number(r.card_cents ?? 0),
    }),
    { cash: 0, mobile: 0, card: 0 }
  );

  // A contiguous oldest→newest week for the trend chart, zero-filled so a day
  // with no sales is a gap in the line, not a missing column.
  const trend = Array.from({ length: 7 }, (_, k) => {
    const day = isoDay(6 - k);
    const row = rows.find((r) => r.day === day);
    return {
      day,
      revenue_cents: Number(row?.revenue_cents ?? 0),
      transactions: Number(row?.transactions ?? 0),
    };
  });

  return (
    <Shell shopName={shopName}>
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gradient">
              Retail Dashboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Welcome back, <span className="font-semibold text-foreground">{userName}</span> ({userRole})
            </p>
          </div>
          <Badge variant="outline" className="w-fit text-xs px-3 py-1 font-mono">
            {/* Server-rendered, so this was showing the container's date — which
                in UTC is the wrong day for the shop either side of midnight. */}
            <LocalTime value={Date.now()} format="long" />
          </Badge>
        </div>

        {demoReason && <DemoBanner reason={demoReason} />}

        <AiAssistant />

        {oversold > 0 && (
          <Notice tone="error">
            <span className="font-bold">{oversold} oversold sale(s) recorded!</span>{" "}
            Multiple devices checked out units exceeding current physical stock. Please
            inspect stock counts.
          </Notice>
        )}

        {/* Telemetry Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Tile 1 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Revenue Today
              </CardTitle>
              <div className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
                <DollarSign className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gradient">
                {formatMoney(Number(today?.revenue_cents ?? 0), currency)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-semibold text-primary">{today?.transactions ?? 0}</span> transactions completed
              </p>
            </CardContent>
          </Card>

          {/* Tile 2 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Revenue This Week
              </CardTitle>
              <div className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
                <TrendingUp className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gradient">
                {formatMoney(weekRevenue, currency)}
              </div>
              <div className="mt-1 flex items-center gap-1 text-xs font-medium text-success">
                <ArrowUpRight className="h-3.5 w-3.5" />
                {percentChange(weekRevenue, prevRevenue)}
              </div>
            </CardContent>
          </Card>

          {/* Tile 3 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Weekly Orders
              </CardTitle>
              <div className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
                <ShoppingCart className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gradient">
                {weekTransactions}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {weekTransactions > 0
                  ? `${formatMoney(Math.round(weekRevenue / weekTransactions), currency)} avg ticket`
                  : "No sales recorded"}
              </p>
            </CardContent>
          </Card>

          {/* Tile 4 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cash vs Mobile
              </CardTitle>
              <div className="grid size-8 place-items-center rounded-lg bg-warning/12 text-warning">
                <CreditCard className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gradient">
                {weekRevenue > 0 ? `${Math.round((cashSplit.cash / weekRevenue) * 100)}% Cash` : "—"}
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {formatMoney(cashSplit.cash, currency)} cash · {formatMoney(cashSplit.mobile, currency)} mobile
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts row: the week at a glance. Trend leads (2/3), tender mix rides
            alongside (1/3); both read off data already fetched above. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Sales this week</CardTitle>
                <Badge variant="secondary">{formatMoney(weekRevenue, currency)} total</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              <RevenueTrend data={trend} currency={currency} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Payment mix</CardTitle>
                <Badge variant="secondary">Last 7 days</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              <PaymentMix
                cash={cashSplit.cash}
                mobile={cashSplit.mobile}
                card={cashSplit.card}
                currency={currency}
              />
            </CardContent>
          </Card>
        </div>

        {/* Panels Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Panel 1: Top Movers */}
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Top Movers</CardTitle>
                <Badge variant="secondary">Last 7 days</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {movers.length === 0 ? (
                <EmptyState icon={ShoppingCart} title="No sales in the last week" description="Best sellers appear here once the till starts taking money." />
              ) : (
                <TopProducts data={movers} currency={currency} />
              )}
            </CardContent>
          </Card>

          {/* Panel 2: Low Stock Alerts */}
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-warning" />
                  <CardTitle className="text-base font-semibold">Running Low</CardTitle>
                </div>
                <Badge variant="warning">At / below reorder point</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {lowStock.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="Nothing needs reordering" description="Every product is above its reorder point." />
              ) : (
                <div className="divide-y divide-border">
                  {lowStock.map((item) => (
                    <div key={item.product_id || item.name} className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{item.name}</div>
                        <div className="text-xs text-muted-foreground">Reorder threshold: {item.reorder_point}</div>
                      </div>
                      <Badge variant={item.stock_on_hand <= 0 ? "destructive" : "warning"}>
                        {item.stock_on_hand <= 0 ? "Out of Stock" : `${item.stock_on_hand} left`}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
