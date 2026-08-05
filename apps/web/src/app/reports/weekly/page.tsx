import { formatMoney } from "@ai-pos/shared";

import { Shell } from "@/components/Shell";
import { DemoBanner } from "@/components/DemoBanner";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";

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
        <h1>Weekly Store Digest</h1>
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
        <h1>Weekly Store Digest</h1>
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
      <h1>Weekly Store Digest</h1>
      <p className="subtitle">
        Last seven days, straight from the ledger. Numbers only — the written summary
        goes out by email once the digest job is wired up.
      </p>

      <section className="panel" style={{ padding: "20px" }}>
        <div className="tiles" style={{ marginTop: 0, marginBottom: 0 }}>
          <div className="tile">
            <div className="label">Revenue this week</div>
            <div className="value">{formatMoney(stats.revenue_this_week ?? 0, currency)}</div>
            <div className="delta">
              {changeLine(stats.revenue_this_week ?? 0, stats.revenue_last_week ?? 0)}
            </div>
          </div>
          <div className="tile">
            <div className="label">Transactions</div>
            <div className="value">{stats.transactions_this_week ?? 0}</div>
            <div className="delta">
              {(stats.transactions_this_week ?? 0) > 0
                ? `${formatMoney(
                    Math.round((stats.revenue_this_week ?? 0) / stats.transactions_this_week),
                    currency,
                  )} average basket`
                : "—"}
            </div>
          </div>
          <div className="tile">
            <div className="label">Busiest time</div>
            <div className="value" style={{ fontSize: "22px" }}>
              {stats.busiest_day ?? "—"}
            </div>
            <div className="delta">around {hourLabel(stats.busiest_hour)}</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <header>
          <span>Top movers</span>
          <span className="hint">by revenue, last 7 days</span>
        </header>
        {movers.length === 0 ? (
          <p className="empty">No sales recorded this week.</p>
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
                  <td style={{ fontWeight: 550 }}>{m.name}</td>
                  <td className="num">{Number(m.units)}</td>
                  <td className="num">{formatMoney(m.revenue, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <header>
          <span>Not selling</span>
          <span className="hint">no sale in 30 days</span>
        </header>
        {deadStock.length === 0 ? (
          <p className="empty">Everything on the shelf has sold in the last month.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">On hand</th>
                <th className="num">Days since last sale</th>
              </tr>
            </thead>
            <tbody>
              {deadStock.map((d) => (
                <tr key={d.name}>
                  <td>{d.name}</td>
                  <td className="num">{Number(d.stock_on_hand)}</td>
                  <td className="num">
                    {d.days_since_last_sale === null ? "never sold" : d.days_since_last_sale}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <header>
          <span>Reorder before you run out</span>
        </header>
        {lowStock.length === 0 ? (
          <p className="empty">Nothing is below its reorder point.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">On hand</th>
                <th className="num">Reorder at</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((l) => (
                <tr key={l.name}>
                  <td>{l.name}</td>
                  <td className="num">{Number(l.stock_on_hand)}</td>
                  <td className="num">{Number(l.reorder_point)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}
