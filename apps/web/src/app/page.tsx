import { formatMoney } from "@ai-pos/shared";
import { Shell } from "@/components/Shell";
import { AiAssistant } from "@/components/AiAssistant";
import { DemoBanner } from "@/components/DemoBanner";
import { createClient } from "@/lib/supabase/server";

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
  let shopName = "Demo Retail Shop";
  let userName = "Owner";
  let userRole = "owner";
  let currency = "USD";
  let oversold = 0;

  // Null means the figures below are the shop's own. Anything else is the
  // reason they aren't, and gets shown at the top of the page — invented
  // revenue that looks identical to real revenue is the one failure mode a
  // till cannot have.
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

      // An empty result is a legitimate answer for a brand-new shop; showing
      // three days of invented takings instead is not.
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
      {},
    ),
  )
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const cashSplit = thisWeek.reduce(
    (acc, r) => ({
      cash: acc.cash + Number(r.cash_cents ?? 0),
      mobile: acc.mobile + Number(r.mobile_money_cents ?? 0),
      card: acc.card + Number(r.card_cents ?? 0),
    }),
    { cash: 0, mobile: 0, card: 0 },
  );

  return (
    <Shell shopName={shopName}>
      <h1>Today</h1>
      <p className="subtitle">
        {userName ? `${userName} · ` : ""}
        {userRole}
      </p>

      {demoReason && <DemoBanner reason={demoReason} />}

      <AiAssistant />

      {oversold > 0 && (
        <div className="notice">
          <strong>{oversold} sale(s) went through on stock you didn&apos;t have.</strong> Two
          devices sold the last unit at once. The sales are recorded — the stock counts need
          correcting.
        </div>
      )}

      <div className="tiles">
        <div className="tile">
          <div className="label">Revenue today</div>
          <div className="value">{formatMoney(Number(today?.revenue_cents ?? 0), currency)}</div>
          <div className="delta">{today?.transactions ?? 0} transactions</div>
        </div>
        <div className="tile">
          <div className="label">Revenue this week</div>
          <div className="value">{formatMoney(weekRevenue, currency)}</div>
          <div className="delta">{percentChange(weekRevenue, prevRevenue)}</div>
        </div>
        <div className="tile">
          <div className="label">Transactions this week</div>
          <div className="value">{weekTransactions}</div>
          <div className="delta">
            {weekTransactions > 0
              ? `${formatMoney(Math.round(weekRevenue / weekTransactions), currency)} average`
              : "—"}
          </div>
        </div>
        <div className="tile">
          <div className="label">Cash vs mobile money</div>
          <div className="value">
            {weekRevenue > 0 ? `${Math.round((cashSplit.cash / weekRevenue) * 100)}%` : "—"}
          </div>
          <div className="delta">
            {formatMoney(cashSplit.cash, currency)} cash ·{" "}
            {formatMoney(cashSplit.mobile, currency)} mobile
          </div>
        </div>
      </div>

      <section className="panel">
        <header>
          Top movers <span className="hint">last 7 days</span>
        </header>
        {movers.length === 0 ? (
          <p className="empty">No sales in the last week.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Units</th>
                <th className="num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {movers.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td className="num">{m.units}</td>
                  <td className="num">{formatMoney(m.revenue, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <header>
          Running low <span className="hint">at or below reorder point</span>
        </header>
        {lowStock.length === 0 ? (
          <p className="empty">Everything is above its reorder point.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">On hand</th>
                <th className="num">Reorder at</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lowStock.map((p) => (
                <tr key={p.product_id as string}>
                  <td>{p.name}</td>
                  <td className="num">{Number(p.stock_on_hand)}</td>
                  <td className="num">{Number(p.reorder_point)}</td>
                  <td className="num">
                    {Number(p.stock_on_hand) <= 0 ? (
                      <span className="pill danger">out</span>
                    ) : (
                      <span className="pill warn">low</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <header>
          Last 14 days <span className="hint">by day the sale happened</span>
        </header>
        {rows.length === 0 ? (
          <p className="empty">Nothing recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Transactions</th>
                <th className="num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day as string}>
                  <td>{r.day}</td>
                  <td className="num">{r.transactions}</td>
                  <td className="num">
                    {formatMoney(Number(r.revenue_cents ?? 0), currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}
