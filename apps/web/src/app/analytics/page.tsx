import { AccessGate } from "@/components/AccessGate";
import { Shell } from "@/components/Shell";
import { canAccessRoute } from "@/components/nav-items";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, navAccess } from "@/lib/tenant";
import { AnalyticsClient } from "./AnalyticsClient";

export const dynamic = "force-dynamic";

function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

const DEMO_DAILY = Array.from({ length: 14 }).map((_, i) => {
  const dayStr = isoDay(13 - i);
  const baseRev = 15000 + (i % 5) * 4500 + Math.floor(Math.random() * 3000);
  return {
    day: dayStr,
    transactions: Math.floor(baseRev / 1400),
    revenue_cents: baseRev,
    cash_cents: Math.round(baseRev * 0.65),
    mobile_money_cents: Math.round(baseRev * 0.35),
    card_cents: 0,
  };
});

export default async function AnalyticsPage() {
  let dailySales = DEMO_DAILY;
  let currency = "USD";
  let shopName = "Demo Retail Shop";

  // Signed out this stays the demo preview. Signed in and standing in a
  // warehouse, every series here would be empty — sales are location-scoped —
  // and the demo fallback below would quietly fill the charts with invented
  // numbers, which is worse than saying the screen doesn't apply.
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

  try {
    const supabase = await createClient();
    const { data: tenant } = await supabase.from("tenants").select("name, currency").single();
    if (tenant) {
      shopName = tenant.name ?? shopName;
      currency = tenant.currency ?? currency;
    }

    const { data: dbSales } = await supabase
      .from("v_sales_daily")
      .select("day, transactions, revenue_cents, cash_cents, mobile_money_cents, card_cents")
      .gte("day", isoDay(13))
      .order("day", { ascending: true });

    if (dbSales && dbSales.length > 0) {
      dailySales = dbSales;
    }
  } catch {
    // Demo fallback for local development preview
  }

  return (
    <Shell shopName={shopName}>
      <AnalyticsClient dailySales={dailySales} currency={currency} />
    </Shell>
  );
}
