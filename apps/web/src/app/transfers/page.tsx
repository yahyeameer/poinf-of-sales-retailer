import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";

import { Shell } from "@/components/Shell";
import { Notice } from "@/components/ui/notice";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { TransfersClient, type StockAtLocation, type TransferDoc } from "./TransfersClient";

export const dynamic = "force-dynamic";

/** The two ways onto this screen that stop before the form. */
function TransfersGate({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
        <ArrowLeftRight className="size-6 text-primary" />
        Stock transfers
      </h1>
      <Notice tone="warning">{children}</Notice>
    </div>
  );
}

export default async function TransfersPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login?next=/transfers");

  if (ctx.role === "cashier") {
    return (
      <Shell shopName={ctx.shopName}>
        <TransfersGate>
          Moving stock between locations is limited to owners and managers.
        </TransfersGate>
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
        <TransfersGate>
          You only have one location, so there is nowhere to transfer to. Add a warehouse
          on the{" "}
          <Link href="/locations" className="font-semibold underline underline-offset-4">
            Locations
          </Link>{" "}
          page first.
        </TransfersGate>
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
