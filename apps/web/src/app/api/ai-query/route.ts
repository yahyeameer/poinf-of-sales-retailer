import { NextResponse } from "next/server";
import { formatMoney } from "@ai-pos/shared";

import { askGemini, geminiConfigured, parseJsonReply } from "@/lib/ai/gemini";
import { LOOKUPS, LOOKUP_MENU } from "@/lib/ai/lookups";
import { createClient } from "@/lib/supabase/server";

/**
 * The assistant, in two halves.
 *
 * The figures come from the shop's own views, run with the caller's session so
 * RLS decides what is readable. The model picks which lookups answer the
 * question and phrases the result. It is never handed the database and never
 * asked to do arithmetic — every money value reaches it already formatted, to
 * be quoted rather than recomputed.
 *
 * That split is the point. This route used to be three `includes()` branches
 * and, before that, invented prose: a shop owner asking "am I losing money on
 * rice?" was told "store health is good", which is measured by nothing. Adding
 * a model must not bring that back, so the prompt below forbids figures that
 * are not in the payload and the UI still marks anything ungrounded.
 *
 * Without GEMINI_API_KEY the route behaves exactly as it did before — the
 * keyword matcher underneath is untouched and is also the fallback whenever a
 * model call fails, times out, or the model name has been retired.
 */
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

    // --- the model path -------------------------------------------------
    //
    // Tried first, falls through to the keyword matcher below on any failure.
    // Two calls: one to choose lookups (cheap, JSON), one to phrase the answer
    // from what they returned. Grounding needs the data before the prose, so
    // the round trip cannot be collapsed into one.
    if (geminiConfigured()) {
      const answered = await answerWithGemini(query, supabase, money, currency);
      if (answered) return NextResponse.json(answered);
      // Nothing to tell the user: the keyword path below still answers the
      // three questions it always did.
    }

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


// ---------------------------------------------------------------------------
// The model path
// ---------------------------------------------------------------------------

const ROUTER_SYSTEM = `You route a shop owner's question to data lookups for a
point-of-sale system. Reply with JSON only: {"lookups": ["id", ...]}.

Choose at most 3 ids from this list, most relevant first. Choose none (an empty
array) if the question is not about this shop's sales, stock, products, money
or staff — small talk, general knowledge, and anything the list cannot answer
should return an empty array rather than a loose guess.

Available lookups:
`;

const ANSWER_SYSTEM = `You are the assistant inside a small shop's
point-of-sale app. Answer the owner's question using ONLY the JSON facts you
are given.

Rules, in order of importance:
1. Never state a number that is not in the facts. Do not add, average,
   project, or estimate. Every money value is already formatted — quote it
   exactly as written, including its currency symbol.
2. If the facts do not answer the question, say so plainly in one sentence and
   name what you could look at instead. A clear "I don't have that" is more
   useful than a confident guess, and far safer.
3. If a lookup reports available: false, that means the signed-in user is not
   allowed to see those figures — say the answer needs an owner or manager,
   not that the data is missing.
4. Be brief and concrete: two or three sentences, no preamble, no bullet
   lists unless you are naming several products. Talk like a shopkeeper, not
   an analyst. No markdown headings.`;

async function answerWithGemini(
  query: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  money: (cents: number) => string,
  currency: string,
): Promise<{ answer: string; matched: boolean } | null> {
  const routed = await askGemini({
    system: ROUTER_SYSTEM + LOOKUP_MENU,
    user: query,
    json: true,
    thinking: false,
    maxOutputTokens: 256,
  });

  if (!routed.ok) {
    console.error("[ai-query] routing failed:", routed.reason);
    return null;
  }

  const picked = parseJsonReply<{ lookups?: unknown }>(routed.text);
  const ids = Array.isArray(picked?.lookups)
    ? (picked!.lookups as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 3)
    : [];

  const chosen = LOOKUPS.filter((l) => ids.includes(l.id));

  // The model judged the question out of range. Answer in the app's own words
  // rather than spending a second call on it — and mark it ungrounded so the
  // UI presents it as a limitation.
  if (chosen.length === 0) {
    return {
      matched: false,
      answer:
        "I can't answer that one. I read figures straight from your shop's data, " +
        "so I can cover sales and takings, best sellers, stock that's running low " +
        "or not moving, your payment mix, and profit.",
    };
  }

  // Run them with the caller's own session: RLS is what decides which of these
  // rows exist for this user, not the prompt.
  const facts: Record<string, unknown> = {};
  for (const lookup of chosen) {
    try {
      facts[lookup.id] = await lookup.run(supabase, money);
    } catch (err) {
      console.error(`[ai-query] lookup ${lookup.id} failed:`, err);
    }
  }

  if (Object.keys(facts).length === 0) return null;

  const drafted = await askGemini({
    system: ANSWER_SYSTEM,
    user:
      `Shop currency: ${currency}\n\n` +
      `Question: ${query}\n\n` +
      `Facts:\n${JSON.stringify(facts, null, 2)}`,
    // Two or three sentences quoting figures that are already formatted does
    // not need deliberation, and on 2.5-series models thought tokens come out
    // of this same budget — which is what truncated the answer in testing.
    thinking: false,
    maxOutputTokens: 600,
  });

  if (!drafted.ok) {
    console.error("[ai-query] answer failed:", drafted.reason);
    return null;
  }

  return { answer: drafted.text.trim(), matched: true };
}
