"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";

export interface ActionResult<T = undefined> {
  ok: boolean;
  message: string;
  data?: T;
}

/**
 * The purchasing RPCs raise the same custom SQLSTATEs as the rest of the
 * schema, with messages already written for a shop owner, so the message is
 * usually the right thing to show. Only the codes whose raw text would leak
 * schema detail are mapped.
 */
function readable(error: { message: string; code?: string } | null): string {
  if (!error) return "Something went wrong.";
  switch (error.code) {
    case "PS401": return "Your session expired. Sign in again.";
    case "PS403":
    case "PS404":
    case "PS405":
    case "PS422": return error.message;
    case "23505": return "That already exists.";
    case "42501": return "Your account doesn't have permission to do that.";
    default: return error.message;
  }
}

/** Purchasing shows up on the stock pages too — a delivery changes both. */
function revalidatePurchasing() {
  for (const path of ["/suppliers", "/purchase-orders", "/stock", "/catalog", "/warehouse", "/"]) {
    revalidatePath(path);
  }
}

async function requireManager() {
  const ctx = await getTenantContext();
  if (!ctx) return { ctx: null, error: "You need to sign in first." };
  if (ctx.role === "cashier") {
    return { ctx: null, error: "Only an owner or manager can do that." };
  }
  return { ctx, error: null };
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function saveSupplier(input: {
  id: string | null;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  leadTimeDays: number;
  note: string | null;
}): Promise<ActionResult> {
  const { ctx, error: authError } = await requireManager();
  if (!ctx) return { ok: false, message: authError! };
  if (!input.name.trim()) return { ok: false, message: "Give the supplier a name." };
  if (!Number.isFinite(input.leadTimeDays) || input.leadTimeDays < 0 || input.leadTimeDays > 365) {
    return { ok: false, message: "Lead time should be between 0 and 365 days." };
  }

  const supabase = await createClient();

  const row = {
    tenant_id: ctx.tenantId,
    name: input.name.trim(),
    contact_name: input.contactName?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    address: input.address?.trim() || null,
    lead_time_days: Math.round(input.leadTimeDays),
    note: input.note?.trim() || null,
  };

  const { error } = input.id
    ? await supabase.from("suppliers").update(row).eq("id", input.id)
    : await supabase.from("suppliers").insert(row);

  // The unique index is case-insensitive, so say that rather than letting the
  // owner wonder why "Nairobi Wholesalers" is a duplicate of "nairobi wholesalers".
  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: `You already have a supplier called ${row.name}.` };
    }
    return { ok: false, message: readable(error) };
  }

  revalidatePurchasing();
  return { ok: true, message: input.id ? "Supplier updated." : `Added ${row.name}.` };
}

export async function setSupplierActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { ctx, error: authError } = await requireManager();
  if (!ctx) return { ok: false, message: authError! };

  const supabase = await createClient();

  // Deactivated rather than deleted: the ledger references suppliers, and a
  // shop that stops using a wholesaler still wants last year's cost history.
  const { error } = await supabase
    .from("suppliers")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) return { ok: false, message: readable(error) };

  revalidatePurchasing();
  return { ok: true, message: isActive ? "Supplier reactivated." : "Supplier archived." };
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export interface DraftLine {
  productId: string;
  quantity: number;
  unitCostCents: number;
}

export async function createPurchaseOrder(input: {
  supplierId: string;
  lines: DraftLine[];
  expectedAt: string | null;
  note: string | null;
  send: boolean;
}): Promise<ActionResult<{ id: string; reference: string }>> {
  const { ctx, error: authError } = await requireManager();
  if (!ctx) return { ok: false, message: authError! };
  if (!input.supplierId) return { ok: false, message: "Pick a supplier first." };

  const lines = input.lines.filter((l) => l.productId && l.quantity > 0);
  if (lines.length === 0) return { ok: false, message: "Add at least one line." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase_order", {
    p_supplier_id: input.supplierId,
    // The order lands where the person placing it is standing; the location
    // switcher chooses which. Receiving credits this same location.
    p_location_id: ctx.locationId,
    p_lines: lines.map((l) => ({
      product_id: l.productId,
      quantity: l.quantity,
      unit_cost_cents: Math.max(0, Math.round(l.unitCostCents)),
    })),
    p_expected_at: input.expectedAt || null,
    p_note: input.note,
    p_send: input.send,
  });

  if (error) return { ok: false, message: readable(error) };

  const po = data as { id: string; reference: string };
  revalidatePurchasing();
  return {
    ok: true,
    message: input.send ? `${po.reference} placed.` : `${po.reference} saved as a draft.`,
    data: { id: po.id, reference: po.reference },
  };
}

export async function sendPurchaseOrder(id: string): Promise<ActionResult> {
  const { ctx, error: authError } = await requireManager();
  if (!ctx) return { ok: false, message: authError! };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_purchase_order", { p_id: id });

  if (error) return { ok: false, message: readable(error) };

  const po = data as { reference: string };
  revalidatePurchasing();
  return { ok: true, message: `${po.reference} marked as placed.` };
}

export async function receivePurchaseOrder(input: {
  id: string;
  /** Null means everything still outstanding arrived — the common case. */
  lines: { lineId: string; quantity: number }[] | null;
  note: string | null;
}): Promise<ActionResult<{ status: string; unitsOutstanding: number }>> {
  const { ctx, error: authError } = await requireManager();
  if (!ctx) return { ok: false, message: authError! };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_purchase_order", {
    p_id: input.id,
    p_lines: input.lines
      ? input.lines
          .filter((l) => l.quantity > 0)
          .map((l) => ({ line_id: l.lineId, quantity: l.quantity }))
      : null,
    p_note: input.note,
  });

  if (error) return { ok: false, message: readable(error) };

  const r = data as {
    reference: string;
    status: string;
    lines_received: number;
    units_received: number;
    units_outstanding: number;
  };

  revalidatePurchasing();

  const outstanding = Number(r.units_outstanding);
  return {
    ok: true,
    message:
      outstanding > 0
        ? `Booked in ${r.units_received} units against ${r.reference}. ${outstanding} still to come.`
        : `${r.reference} received in full. Stock and cost are updated.`,
    data: { status: r.status, unitsOutstanding: outstanding },
  };
}

export async function cancelPurchaseOrder(id: string, reason: string | null): Promise<ActionResult> {
  const { ctx, error: authError } = await requireManager();
  if (!ctx) return { ok: false, message: authError! };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_purchase_order", {
    p_id: id,
    p_reason: reason,
  });

  if (error) return { ok: false, message: readable(error) };

  const po = data as { reference: string };
  revalidatePurchasing();
  return { ok: true, message: `${po.reference} cancelled.` };
}

/** The low-stock list, shaped as order lines ready to edit. */
export async function suggestPurchaseLines(): Promise<
  ActionResult<
    {
      productId: string;
      name: string;
      onHand: number;
      reorderPoint: number;
      suggestedQty: number;
      unitCostCents: number;
    }[]
  >
> {
  const { ctx, error: authError } = await requireManager();
  if (!ctx) return { ok: false, message: authError! };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("suggest_purchase_lines", {
    p_location_id: ctx.locationId,
  });

  if (error) return { ok: false, message: readable(error) };

  const rows = (data ?? []) as {
    product_id: string;
    name: string;
    on_hand: number;
    reorder_point: number;
    suggested_qty: number;
    unit_cost_cents: number;
  }[];

  return {
    ok: true,
    message: rows.length === 0 ? "Nothing is below its reorder point." : "",
    data: rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      onHand: Number(r.on_hand),
      reorderPoint: Number(r.reorder_point),
      suggestedQty: Number(r.suggested_qty),
      unitCostCents: Number(r.unit_cost_cents),
    })),
  };
}
