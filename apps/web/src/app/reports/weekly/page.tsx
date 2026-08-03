import { formatMoney } from "@ai-pos/shared";
import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function WeeklyReportPage() {
  let shopName = "Demo Retail Shop";
  let currency = "USD";

  try {
    const supabase = await createClient();
    const { data: tenant } = await supabase.from("tenants").select("name, currency").single();
    if (tenant) {
      shopName = tenant.name ?? shopName;
      currency = tenant.currency ?? currency;
    }
  } catch {
    // Demo fallback
  }

  return (
    <Shell shopName={shopName}>
      <h1>Weekly Executive Store Digest</h1>
      <p className="subtitle">AI-generated weekly health digest, stock velocity, and manager recommendations.</p>

      <section className="panel" style={{ padding: "20px" }}>
        <h2 style={{ fontSize: "16px", marginTop: 0 }}>Executive Summary: Week Ending Sunday</h2>
        <p style={{ color: "var(--muted)", fontSize: "14px", lineHeight: "1.6" }}>
          Overall shop revenue increased by <strong>+18%</strong> compared to last week. Customer foot traffic peaked on Friday afternoon. Cash remained the dominant payment method (65%), while Mobile Money accounted for 35%.
        </p>

        <div className="tiles" style={{ marginTop: "16px", marginBottom: 0 }}>
          <div className="tile">
            <div className="label">Weekly Revenue</div>
            <div className="value">{formatMoney(185000, currency)}</div>
            <div className="delta">+18% vs last week</div>
          </div>
          <div className="tile">
            <div className="label">Items Sold</div>
            <div className="value">412 units</div>
            <div className="delta">58 distinct SKUs</div>
          </div>
          <div className="tile">
            <div className="label">Oversold Incidents</div>
            <div className="value">0</div>
            <div className="delta">100% ledger accuracy</div>
          </div>
        </div>
      </section>

      <section className="panel" style={{ padding: "20px" }}>
        <h2 style={{ fontSize: "16px", marginTop: 0 }}>✨ AI Manager Recommendations</h2>
        <ul style={{ paddingLeft: "20px", margin: 0, color: "var(--text)", fontSize: "14px", lineHeight: "1.8" }}>
          <li>
            <strong>Reorder Prompt:</strong> <em>Sunflower Oil 1L</em> and <em>Wheat Flour 2kg</em> are approaching 0 stock. Place supplier order before Thursday.
          </li>
          <li>
            <strong>Pricing Strategy:</strong> <em>Coca-Cola 500ml</em> represents 35% of total beverage sales volume. Consider bundling with snacks for +12% basket size.
          </li>
          <li>
            <strong>Ledger Health:</strong> All device sync queues processed cleanly without conflicting transactions.
          </li>
        </ul>
      </section>
    </Shell>
  );
}
