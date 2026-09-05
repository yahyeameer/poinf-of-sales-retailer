import { AccessGate } from "@/components/AccessGate";
import { Shell } from "@/components/Shell";
import { canAccessRoute } from "@/components/nav-items";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, navAccess } from "@/lib/tenant";
import { redirect } from "next/navigation";

import { ExpensesClient, type ExpenseRow } from "./ExpensesClient";

export const dynamic = "force-dynamic";

interface ProfitRow {
  day: string;
  revenue_cents: number;
  gross_margin_cents: number;
  expenses_cents: number;
  net_profit_cents: number;
}

function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

export default async function ExpensesPage() {
  const ctx = await getTenantContext();
  // No signed-out preview. Every other page has one, but a demo of a shop's
  // wage bill is a strange thing to show a stranger, and there is no shape to
  // preview here that is not just invented numbers about money.
  if (!ctx) redirect("/login?next=/expenses");

  const access = navAccess(ctx);
  if (!canAccessRoute("/expenses", access)) {
    return (
      <Shell shopName={ctx.shopName}>
        <AccessGate href="/expenses" access={access} />
      </Shell>
    );
  }

  const supabase = await createClient();
  const from = isoDay(29);

  const [{ data: expenses }, { data: profit }] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, category, amount_cents, note, spent_on, location_id, created_by")
      .order("spent_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("v_profit_daily")
      .select("day, revenue_cents, gross_margin_cents, expenses_cents, net_profit_cents")
      .gte("day", from)
      .order("day"),
  ]);

  const rows = (expenses ?? []) as unknown as ExpenseRow[];
  const profitRows = (profit ?? []) as unknown as ProfitRow[];

  // Totalled here rather than in the client so the page and any future export
  // cannot disagree about what "this month" means.
  const totals = profitRows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + Number(r.revenue_cents ?? 0),
      grossMargin: acc.grossMargin + Number(r.gross_margin_cents ?? 0),
      expenses: acc.expenses + Number(r.expenses_cents ?? 0),
      netProfit: acc.netProfit + Number(r.net_profit_cents ?? 0),
    }),
    { revenue: 0, grossMargin: 0, expenses: 0, netProfit: 0 },
  );

  return (
    <Shell shopName={ctx.shopName}>
      <ExpensesClient
        expenses={rows}
        totals={totals}
        trend={profitRows.map((r) => ({
          day: r.day,
          gross_margin_cents: Number(r.gross_margin_cents ?? 0),
          expenses_cents: Number(r.expenses_cents ?? 0),
          net_profit_cents: Number(r.net_profit_cents ?? 0),
        }))}
        currency={ctx.currency}
        locations={ctx.locations}
        activeLocationId={ctx.locationId}
      />
    </Shell>
  );
}
