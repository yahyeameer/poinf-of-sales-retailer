import { redirect } from "next/navigation";

import { formatMoney } from "@ai-pos/shared";

import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  shop: "Shop floor",
  warehouse: "Warehouse",
  van: "Delivery van",
};

interface StockRow {
  location_id: string;
  on_hand: number;
  cost_cents: number;
}

export default async function LocationsPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login?next=/locations");

  const supabase = await createClient();

  const [{ data: locations }, { data: stock }] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, kind, code, address, phone, is_default, is_active")
      .order("is_default", { ascending: false })
      .order("name"),
    supabase.from("v_location_stock").select("location_id, on_hand, cost_cents"),
  ]);

  // Value at cost, not at retail: this is what the business has tied up, which
  // is the number an owner deciding where to move stock actually wants.
  const byLocation = new Map<string, { lines: number; units: number; valueCents: number }>();
  for (const row of (stock ?? []) as StockRow[]) {
    const acc = byLocation.get(row.location_id) ?? { lines: 0, units: 0, valueCents: 0 };
    acc.lines += 1;
    acc.units += Number(row.on_hand);
    acc.valueCents += Number(row.on_hand) * Number(row.cost_cents);
    byLocation.set(row.location_id, acc);
  }

  return (
    <Shell shopName={ctx.shopName}>
      <h1>Locations</h1>
      <p className="subtitle">
        Every place stock can sit. Balances are held per location — a warehouse
        full of stock doesn&apos;t help a customer standing at the till.
      </p>

      <section className="panel">
        <header>
          <span>Locations ({(locations ?? []).length})</span>
          <span className="hint">value shown at cost</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Code</th>
              <th className="num">Products</th>
              <th className="num">Units</th>
              <th className="num">Stock value</th>
            </tr>
          </thead>
          <tbody>
            {(locations ?? []).map((l) => {
              const agg = byLocation.get(l.id as string) ?? { lines: 0, units: 0, valueCents: 0 };
              return (
                <tr key={l.id as string}>
                  <td style={{ fontWeight: 550 }}>
                    {l.name}
                    {l.is_default && <span className="pill" style={{ marginLeft: 6 }}>Default</span>}
                    {!l.is_active && <span className="pill danger" style={{ marginLeft: 6 }}>Inactive</span>}
                  </td>
                  <td>{KIND_LABEL[l.kind as string] ?? l.kind}</td>
                  <td><code>{l.code ?? "—"}</code></td>
                  <td className="num">{agg.lines}</td>
                  <td className="num">{Math.round(agg.units * 1000) / 1000}</td>
                  <td className="num">{formatMoney(Math.round(agg.valueCents), ctx.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {ctx.role === "owner" && (
        <p className="hint">
          Adding and editing locations is owner-only and not wired to a form yet —
          they can be created directly in the database for now.
        </p>
      )}
    </Shell>
  );
}
