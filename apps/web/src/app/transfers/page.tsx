import { redirect } from "next/navigation";

import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { TransfersClient, type StockAtLocation, type TransferDoc } from "./TransfersClient";

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login?next=/transfers");

  if (ctx.role === "cashier") {
    return (
      <Shell shopName={ctx.shopName}>
        <h1>Stock Transfers</h1>
        <div className="notice">
          Moving stock between locations is limited to owners and managers.
        </div>
      </Shell>
    );
  }

  const supabase = await createClient();

  const [{ data: stock }, { data: recent }] = await Promise.all([
    supabase
      .from("v_location_stock")
      .select("location_id, product_id, product_name, on_hand")
      .order("product_name"),
    supabase
      .from("v_transfers")
      .select("reference_id, moved_at, from_location, to_location, lines, units, net_delta")
      .order("moved_at", { ascending: false })
      .limit(20),
  ]);

  if (ctx.locations.length < 2) {
    return (
      <Shell shopName={ctx.shopName}>
        <h1>Stock Transfers</h1>
        <p className="subtitle">Move goods between your locations.</p>
        <div className="notice">
          You only have one location, so there is nowhere to transfer to. Add a warehouse
          on the <a href="/locations">Locations</a> page first.
        </div>
      </Shell>
    );
  }

  return (
    <Shell shopName={ctx.shopName}>
      <TransfersClient
        locations={ctx.locations}
        stock={(stock ?? []) as StockAtLocation[]}
        recent={(recent ?? []) as TransferDoc[]}
      />
    </Shell>
  );
}
