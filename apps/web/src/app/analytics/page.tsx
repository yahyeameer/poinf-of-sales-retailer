import { shopDayIso } from "@ai-pos/shared";
import { AccessGate } from "@/components/AccessGate";
import { Shell } from "@/components/Shell";
import { canAccessRoute } from "@/components/nav-items";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, navAccess } from "@/lib/tenant";
import { AnalyticsClient, type AnalyticsData } from "./AnalyticsClient";
import { RANGES, type RangeKey } from "./ranges";

export const dynamic = "force-dynamic";

/**
 * The reporting views bucket by the shop's own day now, so a range's
 * boundaries have to be computed in the same zone. toISOString() converts to
 * UTC first and shifts the window by a day at the edges for anyone not on UTC
 * — which would drop or double-count the first and last day of every range.
 */
function isoDay(offsetDays = 0, timeZone = "UTC"): string {
  return shopDayIso(timeZone, offsetDays);
}

/**
 * Sample figures for the signed-out preview. Shaped so the margin split is
 * visible — a demo where cost is a flat fraction of revenue would hide the one
 * thing this screen exists to show.
 */
function demoData(days: number): AnalyticsData {
  const daily = Array.from({ length: days }).map((_, i) => {
    const revenue = 12000 + ((i * 7919) % 26000);
    // Margin rate wanders between roughly 18% and 38%, so the stack has shape.
    const rate = 0.18 + ((i * 37) % 20) / 100;
    return {
      day: isoDay(days - 1 - i),
      transactions: Math.max(1, Math.round(revenue / 1400)),
      revenue_cents: revenue,
      margin_cents: Math.round(revenue * rate),
      cash_cents: Math.round(revenue * 0.62),
      mobile_money_cents: Math.round(revenue * 0.38),
      card_cents: 0,
    };
  });

  return {
    daily,
    previous: { revenue_cents: 0, margin_cents: 0, transactions: 0 },
    topProducts: [
      { product_id: "d1", name: "Basmati Rice 5kg", units: 84, revenue_cents: 105000, margin_cents: 31500 },
      { product_id: "d2", name: "Sunflower Oil 1L", units: 61, revenue_cents: 57000, margin_cents: 9700 },
      { product_id: "d3", name: "Whole Milk 1L", units: 140, revenue_cents: 28000, margin_cents: 8400 },
      { product_id: "d4", name: "Wheat Flour 2kg", units: 39, revenue_cents: 35100, margin_cents: 4200 },
      { product_id: "d5", name: "Coca-Cola 500ml", units: 210, revenue_cents: 42000, margin_cents: 3100 },
    ],
    deadStock: [
      { product_id: "x1", name: "Gift Hamper (large)", stock_on_hand: 6, tied_up_cents: 42000, days_since_last_sale: 96 },
      { product_id: "x2", name: "Scented Candle 3pk", stock_on_hand: 22, tied_up_cents: 19800, days_since_last_sale: 61 },
      { product_id: "x3", name: "Wall Calendar 2026", stock_on_hand: 14, tied_up_cents: 7000, days_since_last_sale: null },
    ],
    cashiers: [
      { cashier_id: "c1", cashier_name: "Amina", transactions: 214, revenue_cents: 298000, voids: 1 },
      // Deliberately over the 5% rate so the sample shows the flag; Amina sits
      // under it so both states are visible side by side.
      { cashier_id: "c2", cashier_name: "Yusuf", transactions: 187, revenue_cents: 241000, voids: 14 },
    ],
  };
}

interface DailyRow {
  day: string;
  transactions: number;
  revenue_cents: number;
  cash_cents: number;
  mobile_money_cents: number;
  card_cents: number;
}

interface PerfRow {
  product_id: string;
  name: string;
  day: string;
  units: number;
  revenue_cents: number;
  margin_cents: number;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const range: RangeKey =
    params.range && params.range in RANGES ? (params.range as RangeKey) : "30d";
  const days = RANGES[range].days;

  const ctx = await getTenantContext();

  if (ctx) {
    const access = navAccess(ctx);
    if (!canAccessRoute("/analytics", access)) {
      return (
        <Shell shopName={ctx.shopName}>
          <AccessGate href="/analytics" access={access} />
        </Shell>
      );
    }
  }

  if (!ctx) {
    return (
      <Shell shopName="Demo Retail Shop">
        <AnalyticsClient
          data={demoData(days)}
          currency="USD"
          range={range}
          demoReason="You're not signed in, so these are sample figures."
        />
      </Shell>
    );
  }

  const supabase = await createClient();
  const from = isoDay(days - 1, ctx.timezone);
  // The comparison window is the same length immediately before this one, so
  // "+12%" always means "against an equal stretch", not against a longer or
  // shorter one.
  const prevFrom = isoDay(days * 2 - 1, ctx.timezone);

  const [{ data: daily }, { data: prevDaily }, { data: perf }, { data: dead }, { data: cash }] =
    await Promise.all([
      supabase
        .from("v_sales_daily")
        .select("day, transactions, revenue_cents, cash_cents, mobile_money_cents, card_cents")
        .gte("day", from)
        .order("day"),
      supabase
        .from("v_sales_daily")
        .select("day, transactions, revenue_cents")
        .gte("day", prevFrom)
        .lt("day", from),
      // v_product_performance carries margin_cents, computed from the unit cost
      // snapshotted on each sale_item. It had exactly one caller before this.
      supabase
        .from("v_product_performance")
        .select("product_id, name, day, units, revenue_cents, margin_cents")
        .gte("day", from),
      // Neither of these two views had any caller at all.
      supabase
        .from("v_dead_stock")
        .select("product_id, name, stock_on_hand, tied_up_cents, days_since_last_sale")
        .order("tied_up_cents", { ascending: false })
        .limit(8),
      supabase
        .from("v_cashier_performance")
        .select("cashier_id, cashier_name, day, transactions, revenue_cents, voids")
        .gte("day", from),
    ]);

  const dailyRows = (daily ?? []) as unknown as DailyRow[];
  const perfRows = (perf ?? []) as unknown as PerfRow[];

  // v_product_performance is per product per day; the chart wants one row per
  // day and the table wants one row per product, so it is folded both ways.
  const marginByDay = new Map<string, number>();
  for (const r of perfRows) {
    marginByDay.set(r.day, (marginByDay.get(r.day) ?? 0) + Number(r.margin_cents ?? 0));
  }

  const byProduct = new Map<string, AnalyticsData["topProducts"][number]>();
  for (const r of perfRows) {
    const cur = byProduct.get(r.product_id) ?? {
      product_id: r.product_id,
      name: r.name,
      units: 0,
      revenue_cents: 0,
      margin_cents: 0,
    };
    cur.units += Number(r.units ?? 0);
    cur.revenue_cents += Number(r.revenue_cents ?? 0);
    cur.margin_cents += Number(r.margin_cents ?? 0);
    byProduct.set(r.product_id, cur);
  }

  const cashierRows = (cash ?? []) as unknown as {
    cashier_id: string;
    cashier_name: string | null;
    transactions: number;
    revenue_cents: number;
    voids: number;
  }[];

  const byCashier = new Map<string, AnalyticsData["cashiers"][number]>();
  for (const r of cashierRows) {
    const id = r.cashier_id ?? "unknown";
    const cur = byCashier.get(id) ?? {
      cashier_id: id,
      cashier_name: r.cashier_name ?? "Unknown",
      transactions: 0,
      revenue_cents: 0,
      voids: 0,
    };
    cur.transactions += Number(r.transactions ?? 0);
    cur.revenue_cents += Number(r.revenue_cents ?? 0);
    cur.voids += Number(r.voids ?? 0);
    byCashier.set(id, cur);
  }

  const prev = ((prevDaily ?? []) as unknown as DailyRow[]).reduce(
    (acc, r) => ({
      revenue_cents: acc.revenue_cents + Number(r.revenue_cents ?? 0),
      transactions: acc.transactions + Number(r.transactions ?? 0),
      margin_cents: 0,
    }),
    { revenue_cents: 0, transactions: 0, margin_cents: 0 },
  );

  const data: AnalyticsData = {
    daily: dailyRows.map((r) => ({
      day: r.day,
      transactions: Number(r.transactions ?? 0),
      revenue_cents: Number(r.revenue_cents ?? 0),
      margin_cents: marginByDay.get(r.day) ?? 0,
      cash_cents: Number(r.cash_cents ?? 0),
      mobile_money_cents: Number(r.mobile_money_cents ?? 0),
      card_cents: Number(r.card_cents ?? 0),
    })),
    previous: prev,
    topProducts: [...byProduct.values()]
      .sort((a, b) => b.margin_cents - a.margin_cents)
      .slice(0, 8),
    deadStock: ((dead ?? []) as unknown as AnalyticsData["deadStock"]).map((d) => ({
      ...d,
      stock_on_hand: Number(d.stock_on_hand),
      tied_up_cents: Number(d.tied_up_cents),
    })),
    cashiers: [...byCashier.values()].sort((a, b) => b.revenue_cents - a.revenue_cents),
  };

  return (
    <Shell shopName={ctx.shopName}>
      <AnalyticsClient data={data} currency={ctx.currency} range={range} demoReason={null} />
    </Shell>
  );
}
