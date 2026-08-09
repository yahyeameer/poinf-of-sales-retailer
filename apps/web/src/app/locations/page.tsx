import { redirect } from "next/navigation";

import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { LocationsClient, type LocationRow } from "./LocationsClient";

export const dynamic = "force-dynamic";

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

  const rows: LocationRow[] = (locations ?? []).map((l) => {
    const agg = byLocation.get(l.id as string) ?? { lines: 0, units: 0, valueCents: 0 };
    return {
      id: l.id as string,
      name: l.name as string,
      kind: l.kind as LocationRow["kind"],
      code: (l.code as string | null) ?? null,
      address: (l.address as string | null) ?? null,
      phone: (l.phone as string | null) ?? null,
      is_default: Boolean(l.is_default),
      is_active: Boolean(l.is_active),
      ...agg,
    };
  });

  return (
    <Shell shopName={ctx.shopName}>
      <LocationsClient
        locations={rows}
        currency={ctx.currency}
        canEdit={ctx.role === "owner"}
      />
    </Shell>
  );
}
