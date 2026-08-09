"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { ACTIVE_LOCATION_COOKIE } from "@/lib/location";

export interface ActionResult {
  ok: boolean;
  message: string;
}

function readableError(error: { message: string; code?: string } | null): string {
  if (!error) return "Something went wrong.";
  if (error.code === "23505") return "A location with that code already exists.";
  if (error.code === "42501") return "Your account doesn't have permission to do that.";
  return error.message;
}

/** Every warehouse screen reads from the same set of pages. */
function revalidateStockPages() {
  for (const path of ["/locations", "/transfers", "/stocktake", "/stock", "/till", "/"]) {
    revalidatePath(path);
  }
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function saveLocation(input: {
  id: string | null;
  name: string;
  kind: "shop" | "warehouse" | "van";
  code: string | null;
  address: string | null;
  phone: string | null;
  isDefault: boolean;
}): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };
  if (ctx.role !== "owner") {
    return { ok: false, message: "Only an owner can manage locations." };
  }
  if (!input.name.trim()) return { ok: false, message: "Give the location a name." };

  const supabase = await createClient();

  // The unique index allows one default per tenant, so an insert that claims
  // the flag while another row holds it would fail on the constraint. Clear the
  // old one first rather than surfacing a raw 23505 to the user.
  if (input.isDefault) {
    await supabase
      .from("locations")
      .update({ is_default: false })
      .eq("tenant_id", ctx.tenantId)
      .eq("is_default", true);
  }

  const row = {
    tenant_id: ctx.tenantId,
    name: input.name.trim(),
    kind: input.kind,
    code: input.code?.trim().toUpperCase() || null,
    address: input.address?.trim() || null,
    phone: input.phone?.trim() || null,
    is_default: input.isDefault,
  };

  const { error } = input.id
    ? await supabase.from("locations").update(row).eq("id", input.id)
    : await supabase.from("locations").insert(row);

  if (error) return { ok: false, message: readableError(error) };

  revalidateStockPages();
  return { ok: true, message: input.id ? "Location updated." : `Added ${row.name}.` };
}

export async function setLocationActive(
  locationId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };
  if (ctx.role !== "owner") {
    return { ok: false, message: "Only an owner can manage locations." };
  }

  const supabase = await createClient();

  if (!isActive) {
    const { data: target } = await supabase
      .from("locations")
      .select("is_default, name")
      .eq("id", locationId)
      .single();

    // Closing the default would leave new sales with nowhere to land, and
    // closing the last one would leave the till unable to open at all.
    if (target?.is_default) {
      return {
        ok: false,
        message: "That's the default location — make another one default first.",
      };
    }

    const { count } = await supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    if ((count ?? 0) <= 1) {
      return { ok: false, message: "A shop needs at least one open location." };
    }

    // Stock stranded at a closed location would vanish from every report while
    // still counting toward the org-wide total.
    const { data: remaining } = await supabase
      .from("location_stock")
      .select("on_hand")
      .eq("location_id", locationId)
      .gt("on_hand", 0)
      .limit(1);

    if ((remaining ?? []).length > 0) {
      return {
        ok: false,
        message: `${target?.name ?? "That location"} still holds stock. Transfer it out before closing.`,
      };
    }
  }

  const { error } = await supabase
    .from("locations")
    .update({ is_active: isActive })
    .eq("id", locationId);

  if (error) return { ok: false, message: readableError(error) };

  revalidateStockPages();
  return { ok: true, message: isActive ? "Location reopened." : "Location closed." };
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export interface TransferLine {
  productId: string;
  quantity: number;
}

export async function submitTransfer(input: {
  fromLocationId: string;
  toLocationId: string;
  lines: TransferLine[];
  note: string | null;
}): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const lines = input.lines.filter((l) => l.productId && l.quantity > 0);
  if (lines.length === 0) return { ok: false, message: "Add at least one product." };
  if (input.fromLocationId === input.toLocationId) {
    return { ok: false, message: "Pick two different locations." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("transfer_stock_batch", {
    p_from_location: input.fromLocationId,
    p_to_location: input.toLocationId,
    p_lines: lines.map((l) => ({ product_id: l.productId, quantity: l.quantity })),
    p_note: input.note,
  });

  if (error) return { ok: false, message: readableError(error) };

  revalidateStockPages();
  const result = data as { lines: number; units: number };
  return {
    ok: true,
    message: `Moved ${result.units} units across ${result.lines} line${result.lines === 1 ? "" : "s"}.`,
  };
}

// ---------------------------------------------------------------------------
// Stocktake
// ---------------------------------------------------------------------------

export async function submitStocktake(input: {
  locationId: string;
  counts: { productId: string; counted: number }[];
  note: string | null;
}): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const counts = input.counts.filter((c) => c.productId && Number.isFinite(c.counted));
  if (counts.length === 0) {
    return { ok: false, message: "Count at least one product before committing." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("apply_stocktake", {
    p_location_id: input.locationId,
    p_counts: counts.map((c) => ({ product_id: c.productId, counted: c.counted })),
    p_note: input.note,
  });

  if (error) return { ok: false, message: readableError(error) };

  revalidateStockPages();
  const r = data as { lines_adjusted: number; units_missing: number; units_surplus: number };

  if (r.lines_adjusted === 0) {
    return { ok: true, message: "Everything counted matched the ledger. Nothing to correct." };
  }

  const parts: string[] = [];
  if (Number(r.units_missing) > 0) parts.push(`${r.units_missing} missing`);
  if (Number(r.units_surplus) > 0) parts.push(`${r.units_surplus} extra`);

  return {
    ok: true,
    message: `Corrected ${r.lines_adjusted} line${r.lines_adjusted === 1 ? "" : "s"}: ${parts.join(", ")}.`,
  };
}

// ---------------------------------------------------------------------------
// Which location am I acting at
// ---------------------------------------------------------------------------

export async function switchLocation(locationId: string): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  // A pinned cashier cannot move themselves between shops; that is an owner's
  // decision, made on the staff page.
  if (ctx.pinnedToLocation) {
    return { ok: false, message: "You're assigned to one location." };
  }
  if (!ctx.locations.some((l) => l.id === locationId)) {
    return { ok: false, message: "That location isn't in this shop." };
  }

  const store = await cookies();
  store.set(ACTIVE_LOCATION_COOKIE, locationId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  revalidateStockPages();
  return { ok: true, message: "Switched location." };
}
