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
        matched: true,
        answer: `${lowStock.length} item(s) running low: ${items}.`,
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
        matched: true,
        answer:
          totalTx === 0
            ? "No completed sales in the past 7 days, so there's no average basket to report."
            : `Over the past 7 days your average basket was ${money(avg)} across ${totalTx} sales.`,
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
        matched: true,
        answer:
          total === 0
            ? "No payments recorded in the past 7 days."
            : `7-day payment split — cash ${cashPct}% (${money(cash)}), ` +
              `mobile money ${mobilePct}% (${money(mobile)}), ` +
              `card ${cardPct}% (${money(card)}).`,
      });
    }

    // Nothing matched.
    //
    // This used to answer anyway: "Analysis complete for <question>. Your
    // catalog contains N products. Store health is good with active sales
    // processing." Three sentences of confident prose, none of which had
    // anything to do with what was asked, and the last of which was invented
    // outright — "store health is good" is measured by nothing. A shop owner
    // asking "am I losing money on rice?" got told everything was fine.
    //
    // Saying plainly that the question is out of range is more useful than a
    // fluent non-answer, and far safer. `matched: false` lets the UI present
    // it as a limitation rather than as an insight.
    const { count: productCount } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({
      matched: false,
      answer:
        `I can't answer that one yet. I look up figures directly from your shop's ` +
        `data, and I currently cover: what's below its reorder point, your average ` +
        `basket size, and the split between cash, mobile money and card. ` +
        `Your catalog has ${productCount ?? 0} products.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
