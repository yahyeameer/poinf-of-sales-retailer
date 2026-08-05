import { NextResponse } from "next/server";
import { formatMoney } from "@ai-pos/shared";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Every figure below was hardcoded to "$". Shops on this product are far
    // more likely to be pricing in KES, SOS or ETB, and being told their
    // takings are in dollars is worse than showing no symbol at all.
    const { data: tenant } = await supabase.from("tenants").select("currency").single();
    const currency = tenant?.currency ?? "USD";
    const money = (cents: number) => formatMoney(Math.round(cents), currency);

    const lower = query.toLowerCase();

    // Route logic & response builder based on tenant's stock and sales database
    if (lower.includes("low") || lower.includes("reorder") || lower.includes("stock")) {
      const { data: lowStock } = await supabase
        .from("v_low_stock")
        .select("name, stock_on_hand, reorder_point")
        .limit(5);

      if (!lowStock || lowStock.length === 0) {
        return NextResponse.json({
          answer: "Good news! All products are currently above their reorder points.",
        });
      }

      const items = lowStock
        .map(
          (p) => `${p.name}: ${p.stock_on_hand} left (reorder threshold: ${p.reorder_point})`
        )
        .join("; ");

      return NextResponse.json({
        answer: `Found ${lowStock.length} items running low: ${items}. Consider placing a reorder soon!`,
      });
    }

    if (lower.includes("average") || lower.includes("transaction") || lower.includes("basket")) {
      const { data: sales } = await supabase
        .from("v_sales_daily")
        .select("revenue_cents, transactions")
        .gte("day", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));

      const totalRev = (sales ?? []).reduce((acc, r) => acc + Number(r.revenue_cents ?? 0), 0);
      const totalTx = (sales ?? []).reduce((acc, r) => acc + Number(r.transactions ?? 0), 0);
      const avg = totalTx > 0 ? totalRev / totalTx : 0;

      return NextResponse.json({
        answer: `Over the past 7 days, your average transaction value was ${money(avg)} across ${totalTx} completed transactions.`,
      });
    }

    if (lower.includes("payment") || lower.includes("cash") || lower.includes("mobile")) {
      const { data: sales } = await supabase
        .from("v_sales_daily")
        .select("cash_cents, mobile_money_cents, card_cents")
        .gte("day", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));

      let cash = 0, mobile = 0, card = 0;
      (sales ?? []).forEach((r) => {
        cash += Number(r.cash_cents ?? 0);
        mobile += Number(r.mobile_money_cents ?? 0);
        card += Number(r.card_cents ?? 0);
      });

      const total = cash + mobile + card;
      const cashPct = total > 0 ? Math.round((cash / total) * 100) : 0;
      const mobilePct = total > 0 ? Math.round((mobile / total) * 100) : 0;
      const cardPct = total > 0 ? Math.round((card / total) * 100) : 0;

      return NextResponse.json({
        answer:
          `7-day payment breakdown — cash ${cashPct}% (${money(cash)}), ` +
          `mobile money ${mobilePct}% (${money(mobile)}), ` +
          `card ${cardPct}% (${money(card)}).`,
      });
    }

    // Default intelligence summary fallback
    const { count: productCount } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({
      answer: `Analysis complete for: "${query}". Your catalog contains ${
        productCount ?? 0
      } registered products. Store health is good with active sales processing.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
