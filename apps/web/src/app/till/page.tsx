import { redirect } from "next/navigation";

import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { TillClient, type TillProduct, type ParkedSale, type OpenShift } from "./TillClient";

export const dynamic = "force-dynamic";

export default async function TillPage() {
  const ctx = await getTenantContext();
  // The till takes money. There is no useful read-only preview of that, so a
  // signed-out visitor goes to the door rather than seeing a fake shop.
  if (!ctx) redirect("/login?next=/till");

  const supabase = await createClient();

  const [{ data: products }, { data: shift }, { data: parked }, { data: tenant }] =
    await Promise.all([
      supabase
        .from("products")
        .select("id, name, barcode, price_cents, stock_on_hand, unit")
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(500),

      supabase
        .from("shifts")
        .select("id, opened_at, opening_float_cents")
        .eq("status", "open")
        .maybeSingle(),

      supabase
        .from("parked_sales")
        .select("id, label, cart, created_at")
        .order("created_at", { ascending: false })
        .limit(20),

      supabase.from("tenants").select("tax_rate, tax_inclusive").single(),
    ]);

  return (
    <Shell shopName={ctx.shopName}>
      <TillClient
        products={(products ?? []) as TillProduct[]}
        openShift={(shift ?? null) as OpenShift | null}
        parked={(parked ?? []) as ParkedSale[]}
        currency={ctx.currency}
        taxRate={Number(tenant?.tax_rate ?? 0)}
        taxInclusive={tenant?.tax_inclusive ?? true}
        cashierName={ctx.userName}
        canRefund={ctx.role === "owner" || ctx.role === "manager"}
      />
    </Shell>
  );
}
