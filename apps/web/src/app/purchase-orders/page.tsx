import Link from "next/link";
import { redirect } from "next/navigation";

import { AccessGate } from "@/components/AccessGate";
import { Shell } from "@/components/Shell";
import { canAccessRoute } from "@/components/nav-items";
import { Notice } from "@/components/ui/notice";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, navAccess } from "@/lib/tenant";
import {
  PurchaseOrdersClient,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type SupplierOption,
  type CatalogProduct,
} from "./PurchaseOrdersClient";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login?next=/purchase-orders");

  const access = navAccess(ctx);
  if (!canAccessRoute("/purchase-orders", access)) {
    return (
      <Shell shopName={ctx.shopName}>
        <AccessGate href="/purchase-orders" access={access} />
      </Shell>
    );
  }

  const supabase = await createClient();

  const [{ data: orders }, { data: lines }, { data: suppliers }, { data: products }] =
    await Promise.all([
      supabase
        .from("v_purchase_orders")
        .select(
          "id, reference, status, expected_at, created_at, received_at, note, " +
            "supplier_id, supplier_name, location_name, lines, units_ordered, units_received, total_cost_cents",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("purchase_order_lines")
        .select("id, purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost_cents"),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("products")
        .select("id, name, cost_cents")
        .eq("is_active", true)
        .order("name")
        .limit(500),
    ]);

  const productName = new Map<string, string>();
  for (const p of (products ?? []) as unknown as { id: string; name: string }[]) {
    productName.set(p.id, p.name);
  }

  // Lines are fetched in one query and grouped here rather than nested in the
  // order select: v_purchase_orders is a view, and PostgREST cannot embed a
  // related table through one.
  const linesByOrder = new Map<string, PurchaseOrderLine[]>();
  for (const l of (lines ?? []) as unknown as {
    id: string;
    purchase_order_id: string;
    product_id: string;
    quantity_ordered: number;
    quantity_received: number;
    unit_cost_cents: number;
  }[]) {
    const list = linesByOrder.get(l.purchase_order_id) ?? [];
    list.push({
      id: l.id,
      productId: l.product_id,
      productName: productName.get(l.product_id) ?? "Unknown product",
      quantityOrdered: Number(l.quantity_ordered),
      quantityReceived: Number(l.quantity_received),
      unitCostCents: Number(l.unit_cost_cents),
    });
    linesByOrder.set(l.purchase_order_id, list);
  }

  // Cast through unknown, the same way receipts/page.tsx does: these are new
  // views and RPCs, so the generated database.types.ts has no shape for them
  // until `npm run db:types` is re-run against a database carrying these
  // migrations. The interfaces above are the contract in the meantime.
  const rows: PurchaseOrder[] = (
    (orders ?? []) as unknown as {
      id: string;
      reference: string;
      status: PurchaseOrder["status"];
      expected_at: string | null;
      created_at: string;
      received_at: string | null;
      note: string | null;
      supplier_name: string;
      location_name: string;
      lines: number;
      units_ordered: number;
      units_received: number;
      total_cost_cents: number;
    }[]
  ).map((o) => ({
    id: o.id,
    reference: o.reference,
    status: o.status,
    expectedAt: o.expected_at,
    createdAt: o.created_at,
    receivedAt: o.received_at,
    note: o.note,
    supplierName: o.supplier_name,
    locationName: o.location_name,
    unitsOrdered: Number(o.units_ordered),
    unitsReceived: Number(o.units_received),
    totalCostCents: Number(o.total_cost_cents),
    lines: linesByOrder.get(o.id) ?? [],
  }));

  const supplierOptions: SupplierOption[] = ((suppliers ?? []) as unknown as { id: string; name: string }[]).map(
    (s) => ({ id: s.id, name: s.name }),
  );

  const catalog: CatalogProduct[] = (
    (products ?? []) as unknown as { id: string; name: string; cost_cents: number }[]
  ).map((p) => ({ id: p.id, name: p.name, costCents: Number(p.cost_cents) }));

  if (supplierOptions.length === 0) {
    return (
      <Shell shopName={ctx.shopName}>
        <div className="mx-auto max-w-7xl space-y-6">
          <h1 className="text-2xl font-bold tracking-tight text-gradient">Purchase orders</h1>
          <Notice tone="warning">
            An order has to be placed with someone. Add a supplier on the{" "}
            <Link href={"/suppliers" as never} className="font-semibold underline underline-offset-4">
              Suppliers
            </Link>{" "}
            page first.
          </Notice>
        </div>
      </Shell>
    );
  }

  return (
    <Shell shopName={ctx.shopName}>
      <PurchaseOrdersClient
        orders={rows}
        suppliers={supplierOptions}
        catalog={catalog}
        currency={ctx.currency}
        locationName={ctx.locationName}
      />
    </Shell>
  );
}
