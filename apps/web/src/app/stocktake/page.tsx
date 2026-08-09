import { redirect } from "next/navigation";

import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { StocktakeClient, type CountLine, type StocktakeDoc } from "./StocktakeClient";

export const dynamic = "force-dynamic";

export default async function StocktakePage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login?next=/stocktake");

  if (ctx.role === "cashier") {
    return (
      <Shell shopName={ctx.shopName}>
        <h1>Stocktake</h1>
        <div className="notice">
          Committing a stocktake is limited to owners and managers, since it corrects
          the ledger.
        </div>
      </Shell>
    );
  }

  if (!ctx.locationId) {
    return (
      <Shell shopName={ctx.shopName}>
        <h1>Stocktake</h1>
        <div className="notice">This shop has no location set up yet.</div>
      </Shell>
    );
  }

  const supabase = await createClient();

  // Counting is always against one location — the shelf you are standing at.
  // The switcher in the sidebar chooses which.
  const [{ data: lines }, { data: recent }] = await Promise.all([
    supabase
      .from("v_location_stock")
      .select("product_id, product_name, barcode, on_hand, cost_cents")
      .eq("location_id", ctx.locationId)
      .order("product_name"),
    supabase
      .from("v_stocktakes")
      .select("reference_id, counted_at, location_name, lines_adjusted, units_missing, units_surplus")
      .order("counted_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <Shell shopName={ctx.shopName}>
      <StocktakeClient
        locationName={ctx.locationName}
        locationId={ctx.locationId}
        lines={(lines ?? []) as CountLine[]}
        recent={(recent ?? []) as StocktakeDoc[]}
        currency={ctx.currency}
      />
    </Shell>
  );
}
