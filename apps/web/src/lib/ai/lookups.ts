import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The shop facts the assistant is allowed to answer from.
 *
 * Every one of these is a query against the shop's own views, run with the
 * caller's session — so RLS decides what comes back. A cashier asking about
 * profit gets an empty result and is told the question cannot be answered,
 * because `expenses` refuses them the rows; the model is never the thing
 * deciding who may see the wage bill. That distinction matters: a prompt is
 * not a permission.
 *
 * The model chooses which of these to run and phrases what comes back. It
 * never computes a figure. Each row carries a pre-formatted money string so
 * the model has nothing left to calculate — it quotes rather than arithmetics.
 */

const DAY_MS = 86_400_000;
const since = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

export interface Lookup {
  id: string;
  /** Shown to the model when it picks. Written as the question it answers. */
  description: string;
  run: (supabase: SupabaseClient, money: (cents: number) => string) => Promise<unknown>;
}

export const LOOKUPS: Lookup[] = [
  {
    id: "low_stock",
    description: "Which products are at or below their reorder point and need restocking.",
    run: async (supabase) => {
      const { data } = await supabase
        .from("v_low_stock")
        .select("name, stock_on_hand, reorder_point, location_name")
        .order("stock_on_hand", { ascending: true })
        .limit(20);
      return { items: data ?? [] };
    },
  },
  {
    id: "basket_average",
    description:
      "Average basket / average transaction value, revenue and number of sales over the last 7 days.",
    run: async (supabase, money) => {
      const { data } = await supabase
        .from("v_sales_daily")
        .select("revenue_cents, transactions")
        .gte("day", since(7));
      const revenue = (data ?? []).reduce((a, r) => a + Number(r.revenue_cents ?? 0), 0);
      const transactions = (data ?? []).reduce((a, r) => a + Number(r.transactions ?? 0), 0);
      return {
        window: "last 7 days",
        transactions,
        revenue: money(revenue),
        average_basket: transactions > 0 ? money(revenue / transactions) : null,
      };
    },
  },
  {
    id: "payment_mix",
    description: "The split between cash, mobile money and card over the last 7 days.",
    run: async (supabase, money) => {
      const { data } = await supabase
        .from("v_sales_daily")
        .select("cash_cents, mobile_money_cents, card_cents")
        .gte("day", since(7));
      let cash = 0, mobile = 0, card = 0;
      (data ?? []).forEach((r) => {
        cash += Number(r.cash_cents ?? 0);
        mobile += Number(r.mobile_money_cents ?? 0);
        card += Number(r.card_cents ?? 0);
      });
      const total = cash + mobile + card;
      const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
      return {
        window: "last 7 days",
        total: money(total),
        cash: { amount: money(cash), percent: pct(cash) },
        mobile_money: { amount: money(mobile), percent: pct(mobile) },
        card: { amount: money(card), percent: pct(card) },
      };
    },
  },
  {
    id: "top_products",
    description:
      "Best sellers: which products earned the most, and how many units, over the last 30 days.",
    run: async (supabase, money) => {
      const { data } = await supabase
        .from("v_product_performance")
        .select("name, units, revenue_cents, margin_cents")
        .gte("day", since(30));
      const byName = new Map<string, { units: number; revenue: number; margin: number }>();
      (data ?? []).forEach((r) => {
        const k = String(r.name);
        const cur = byName.get(k) ?? { units: 0, revenue: 0, margin: 0 };
        cur.units += Number(r.units ?? 0);
        cur.revenue += Number(r.revenue_cents ?? 0);
        cur.margin += Number(r.margin_cents ?? 0);
        byName.set(k, cur);
      });
      return {
        window: "last 30 days",
        products: [...byName.entries()]
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .slice(0, 10)
          .map(([name, v]) => ({
            name,
            units: v.units,
            revenue: money(v.revenue),
            margin: money(v.margin),
          })),
      };
    },
  },
  {
    id: "dead_stock",
    description:
      "Dead stock: products not selling, how long since they last sold, and the money tied up in them.",
    run: async (supabase, money) => {
      const { data } = await supabase
        .from("v_dead_stock")
        .select("name, stock_on_hand, days_since_last_sale, tied_up_cents")
        .order("tied_up_cents", { ascending: false })
        .limit(15);
      return {
        items: (data ?? []).map((r) => ({
          name: r.name,
          stock_on_hand: r.stock_on_hand,
          days_since_last_sale: r.days_since_last_sale,
          tied_up: money(Number(r.tied_up_cents ?? 0)),
        })),
      };
    },
  },
  {
    id: "revenue_trend",
    description:
      "Revenue and sales counts per day for the last 30 days — takings, busiest days, whether trade is up or down.",
    run: async (supabase, money) => {
      const { data } = await supabase
        .from("v_sales_daily")
        .select("day, revenue_cents, transactions")
        .gte("day", since(30))
        .order("day", { ascending: true });
      const rows = data ?? [];
      return {
        window: "last 30 days",
        total: money(rows.reduce((a, r) => a + Number(r.revenue_cents ?? 0), 0)),
        days: rows.map((r) => ({
          day: r.day,
          revenue: money(Number(r.revenue_cents ?? 0)),
          transactions: r.transactions,
        })),
      };
    },
  },
  {
    id: "profit",
    description:
      "Profit: revenue, cost of goods, expenses and what is left, per day over the last 30 days. Owners and managers only.",
    run: async (supabase, money) => {
      const { data, error } = await supabase
        .from("v_profit_daily")
        .select("*")
        .gte("day", since(30))
        .order("day", { ascending: true });
      // Empty here usually means RLS refused the rows — expenses include
      // wages, so a cashier cannot read them. Say that rather than "no data",
      // which would read as "the shop made nothing".
      if (error || !data || data.length === 0) {
        return { available: false, note: "No profit rows are readable for this user." };
      }
      return {
        window: "last 30 days",
        available: true,
        days: data.map((r: Record<string, unknown>) => ({
          day: r.day,
          revenue: money(Number(r.revenue_cents ?? 0)),
          gross_profit: money(Number(r.gross_profit_cents ?? 0)),
          expenses: money(Number(r.expenses_cents ?? 0)),
          net_profit: money(Number(r.net_profit_cents ?? 0)),
        })),
      };
    },
  },
];

export const LOOKUP_MENU = LOOKUPS.map((l) => `- ${l.id}: ${l.description}`).join("\n");
