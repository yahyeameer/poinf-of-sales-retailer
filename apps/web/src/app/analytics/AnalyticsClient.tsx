"use client";

import { formatMoney } from "@ai-pos/shared";

interface DailySale {
  day: string;
  transactions: number;
  revenue_cents: number;
  cash_cents: number;
  mobile_money_cents: number;
  card_cents: number;
}

export function AnalyticsClient({
  dailySales,
  currency,
}: {
  dailySales: DailySale[];
  currency: string;
}) {
  const totalRev = dailySales.reduce((acc, r) => acc + Number(r.revenue_cents || 0), 0);
  const totalTx = dailySales.reduce((acc, r) => acc + Number(r.transactions || 0), 0);
  const avgBasket = totalTx > 0 ? Math.round(totalRev / totalTx) : 0;

  const cashTotal = dailySales.reduce((acc, r) => acc + Number(r.cash_cents || 0), 0);
  const mobileTotal = dailySales.reduce((acc, r) => acc + Number(r.mobile_money_cents || 0), 0);
  const cardTotal = dailySales.reduce((acc, r) => acc + Number(r.card_cents || 0), 0);

  const maxRev = Math.max(...dailySales.map((r) => Number(r.revenue_cents || 0)), 1);

  return (
    <div>
      <h1>Sales & Financial Analytics</h1>
      <p className="subtitle">14-Day revenue trends, payment breakdowns, and volume metrics.</p>

      <div className="tiles">
        <div className="tile">
          <div className="label">14-Day Total Revenue</div>
          <div className="value">{formatMoney(totalRev, currency)}</div>
          <div className="delta">Across {dailySales.length} calendar days</div>
        </div>
        <div className="tile">
          <div className="label">Total Transactions</div>
          <div className="value">{totalTx}</div>
          <div className="delta">Completed sales</div>
        </div>
        <div className="tile">
          <div className="label">Average Basket Size</div>
          <div className="value">{formatMoney(avgBasket, currency)}</div>
          <div className="delta">Per customer transaction</div>
        </div>
        <div className="tile">
          <div className="label">Cash Ratio</div>
          <div className="value">
            {totalRev > 0 ? `${Math.round((cashTotal / totalRev) * 100)}%` : "0%"}
          </div>
          <div className="delta">{formatMoney(cashTotal, currency)} total cash</div>
        </div>
      </div>

      <section className="panel" style={{ padding: "20px" }}>
        <header style={{ marginBottom: "16px", padding: 0, border: "none" }}>
          <span>14-Day Revenue Sparkline Bar Chart</span>
        </header>

        <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", height: "180px", paddingTop: "20px" }}>
          {dailySales.map((d) => {
            const heightPct = Math.round((Number(d.revenue_cents || 0) / maxRev) * 100);
            return (
              <div
                key={d.day}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  height: "100%",
                  justifyContent: "flex-end",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    maxHeight: "140px",
                    height: `${Math.max(heightPct, 8)}%`,
                    background: "var(--accent)",
                    borderRadius: "4px 4px 0 0",
                    transition: "height 0.3s ease",
                  }}
                  title={`${d.day}: ${formatMoney(d.revenue_cents, currency)}`}
                />
                <span style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", whiteSpace: "nowrap" }}>
                  {d.day.slice(5)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel" style={{ padding: "20px" }}>
        <h2 style={{ fontSize: "16px", marginTop: 0 }}>Payment Method Distribution</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginTop: "12px" }}>
          <div style={{ padding: "14px", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>💵 Cash Payments</div>
            <div style={{ fontSize: "20px", fontWeight: "600", marginTop: "4px" }}>
              {formatMoney(cashTotal, currency)}
            </div>
            <span className="pill" style={{ marginTop: "6px" }}>
              {totalRev > 0 ? Math.round((cashTotal / totalRev) * 100) : 0}% of revenue
            </span>
          </div>

          <div style={{ padding: "14px", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>📱 Mobile Money</div>
            <div style={{ fontSize: "20px", fontWeight: "600", marginTop: "4px" }}>
              {formatMoney(mobileTotal, currency)}
            </div>
            <span className="pill" style={{ marginTop: "6px" }}>
              {totalRev > 0 ? Math.round((mobileTotal / totalRev) * 100) : 0}% of revenue
            </span>
          </div>

          <div style={{ padding: "14px", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>💳 Card Payments</div>
            <div style={{ fontSize: "20px", fontWeight: "600", marginTop: "4px" }}>
              {formatMoney(cardTotal, currency)}
            </div>
            <span className="pill" style={{ marginTop: "6px" }}>
              {totalRev > 0 ? Math.round((cardTotal / totalRev) * 100) : 0}% of revenue
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
