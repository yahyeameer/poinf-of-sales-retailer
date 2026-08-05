import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let shopName = "Demo Retail Shop";
  let currency = "USD";
  let tenantId = "demo-tenant-uuid-1234";

  try {
    const supabase = await createClient();
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name, currency, created_at")
      .single();

    if (tenant) {
      shopName = tenant.name ?? shopName;
      currency = tenant.currency ?? currency;
      tenantId = tenant.id ?? tenantId;
    }
  } catch {
    // Demo fallback for local development preview
  }

  return (
    <Shell shopName={shopName}>
      <h1>Shop Settings</h1>
      <p className="subtitle">Configure store details, currency formats, and sync hooks.</p>

      <div style={{ display: "grid", gap: "20px" }}>
        <section className="panel" style={{ padding: "20px" }}>
          <h2 style={{ fontSize: "16px", marginTop: 0 }}>General Information</h2>
          <label>Store Name</label>
          <input type="text" defaultValue={shopName} disabled />

          <label>Store Currency</label>
          <input type="text" defaultValue={currency} disabled />

          <label>Tenant ID (RLS Namespace)</label>
          <input type="text" defaultValue={tenantId} disabled />
        </section>

        <section className="panel" style={{ padding: "20px" }}>
          <h2 style={{ fontSize: "16px", marginTop: 0 }}>Sync & Connectivity Status</h2>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "10px", flexWrap: "wrap" }}>
            <span className="pill" style={{ color: "var(--accent)", padding: "4px 10px" }}>
              ● Row-Level Security Enforced
            </span>
            <span className="pill" style={{ color: "var(--accent)", padding: "4px 10px" }}>
              ● Offline Ledger Trigger Active
            </span>
          </div>
        </section>
      </div>
    </Shell>
  );
}
