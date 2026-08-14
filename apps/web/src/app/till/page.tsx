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
      // Stock comes from this location's shelf, not the org-wide total — the
      // number beside a product on the till has to be what is actually here.
      supabase
        .from("v_location_stock")
        .select("product_id, product_name, barcode, on_hand, price_cents")
        .eq("location_id", ctx.locationId ?? "")
        .order("product_name", { ascending: true })
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

  // v_location_stock names its columns after the join, so flatten to the shape
  // the till already speaks rather than teaching the till a second shape.
  const tillProducts: TillProduct[] = (products ?? []).map((row) => ({
    id: row.product_id as string,
    name: row.product_name as string,
    barcode: (row.barcode as string | null) ?? null,
    price_cents: Number(row.price_cents),
    stock_on_hand: Number(row.on_hand),
    unit: "each",
  }));

  return (
    <Shell shopName={ctx.shopName} fullScreenOnMobile>
      <TillClient
        products={tillProducts}
        openShift={(shift ?? null) as OpenShift | null}
        parked={(parked ?? []) as ParkedSale[]}
        currency={ctx.currency}
        taxRate={Number(tenant?.tax_rate ?? 0)}
        taxInclusive={tenant?.tax_inclusive ?? true}
        cashierName={ctx.userName}
        locationName={ctx.locationName}
        canRefund={ctx.role === "owner" || ctx.role === "manager"}
      />
    </Shell>
  );
}
