import { redirect } from "next/navigation";

import { ClipboardList } from "lucide-react";

import { Shell } from "@/components/Shell";
import { Notice } from "@/components/ui/notice";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { StocktakeClient, type CountLine, type StocktakeDoc } from "./StocktakeClient";

export const dynamic = "force-dynamic";

/**
 * The two ways onto this screen that end before the count sheet does. Both
 * still say where you are, because a bare sentence on an empty page reads as
 * something having gone wrong rather than as a rule.
 */
function StocktakeGate({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
        <ClipboardList className="size-6 text-primary" />
        Stocktake
      </h1>
      <Notice tone="warning">{children}</Notice>
    </div>
  );
}

export default async function StocktakePage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login?next=/stocktake");

  if (ctx.role === "cashier") {
    return (
      <Shell shopName={ctx.shopName}>
        <StocktakeGate>
          Committing a stocktake is limited to owners and managers, since it corrects
          the ledger.
        </StocktakeGate>
      </Shell>
    );
  }

  if (!ctx.locationId) {
    return (
      <Shell shopName={ctx.shopName}>
        <StocktakeGate>This shop has no location set up yet.</StocktakeGate>
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
