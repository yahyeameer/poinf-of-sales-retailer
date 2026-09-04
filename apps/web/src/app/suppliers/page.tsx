import { redirect } from "next/navigation";

import { AccessGate } from "@/components/AccessGate";
import { Shell } from "@/components/Shell";
import { canAccessRoute } from "@/components/nav-items";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, navAccess } from "@/lib/tenant";
import { SuppliersClient, type Supplier } from "./SuppliersClient";

export const dynamic = "force-dynamic";

interface SupplierRow {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
  lead_time_days: number;
  is_active: boolean;
}

interface PurchaseRow {
  supplier_id: string;
  deliveries: number;
  units: number;
  spend_cents: number;
  last_delivery_at: string | null;
}

export default async function SuppliersPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login?next=/suppliers");

  const access = navAccess(ctx);
  if (!canAccessRoute("/suppliers", access)) {
    return (
      <Shell shopName={ctx.shopName}>
        <AccessGate href="/suppliers" access={access} />
      </Shell>
    );
  }

  const supabase = await createClient();

  const [{ data: suppliers }, { data: purchases }] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, contact_name, phone, email, address, note, lead_time_days, is_active")
      .order("is_active", { ascending: false })
      .order("name"),
    // What each one has actually cost, straight from the ledger. This is the
    // reason to record a supplier at all — products.cost_cents is an average
    // with no memory of who it was bought from.
    supabase
      .from("v_supplier_purchases")
      .select("supplier_id, deliveries, units, spend_cents, last_delivery_at"),
  ]);

  const spendBySupplier = new Map<string, PurchaseRow>();
  for (const row of (purchases ?? []) as unknown as PurchaseRow[]) {
    spendBySupplier.set(row.supplier_id, row);
  }

  // Cast through unknown: see the note in purchase-orders/page.tsx.
  const rows: Supplier[] = ((suppliers ?? []) as unknown as SupplierRow[]).map((s) => {
    const p = spendBySupplier.get(s.id);
    return {
      id: s.id,
      name: s.name,
      contactName: s.contact_name,
      phone: s.phone,
      email: s.email,
      address: s.address,
      note: s.note,
      leadTimeDays: s.lead_time_days,
      isActive: s.is_active,
      deliveries: Number(p?.deliveries ?? 0),
      units: Number(p?.units ?? 0),
      spendCents: Number(p?.spend_cents ?? 0),
      lastDeliveryAt: p?.last_delivery_at ?? null,
    };
  });

  return (
    <Shell shopName={ctx.shopName}>
      <SuppliersClient suppliers={rows} currency={ctx.currency} />
    </Shell>
  );
}
