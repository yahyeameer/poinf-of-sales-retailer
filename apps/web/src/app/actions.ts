"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Postgres raises these; the message is already written for a shop owner. */
function readableError(error: { message: string; code?: string } | null): string {
  if (!error) return "Something went wrong.";
  if (error.code === "23505") return "A product with that barcode or SKU already exists.";
  if (error.code === "42501") return "Your account doesn't have permission to do that.";
  return error.message;
}

/**
 * Add a product, and record its opening stock as a ledger entry rather than
 * writing stock_on_hand directly — that column is a trigger-maintained cache of
 * the ledger, so setting it by hand would put the two out of step immediately.
 */
export async function createProduct(input: {
  name: string;
  barcode: string | null;
  priceCents: number;
  openingStock: number;
  reorderPoint: number;
}): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();

  const { data: product, error } = await supabase
    .from("products")
    .insert({
      tenant_id: ctx.tenantId,
      name: input.name.trim(),
      barcode: input.barcode?.trim() || null,
      price_cents: input.priceCents,
      reorder_point: input.reorderPoint,
    })
    .select("id, name")
    .single();

  if (error) return { ok: false, message: readableError(error) };

  if (input.openingStock > 0) {
    const { error: ledgerError } = await supabase.from("stock_movements").insert({
      tenant_id: ctx.tenantId,
      product_id: product.id,
      delta: input.openingStock,
      reason: "adjustment",
      note: "Opening balance",
      created_by: ctx.userId,
    });

    // The product is already saved. Report the partial outcome rather than
    // implying the whole thing failed and inviting a duplicate submission.
    if (ledgerError) {
      return {
        ok: true,
        message: `Saved ${product.name}, but the opening stock of ${input.openingStock} didn't record: ${readableError(ledgerError)}`,
      };
    }
  }

  revalidatePath("/catalog");
  revalidatePath("/stock");
  revalidatePath("/");
  return { ok: true, message: `Saved ${product.name}.` };
}

const REASON_MAP = {
  restock: "restock",
  stocktake: "stocktake",
  damaged: "adjustment",
  return: "adjustment",
} as const;

export type AdjustmentReason = keyof typeof REASON_MAP;

/**
 * Restocks go through restock_product() so the weighted average cost is folded
 * in and the margin alert comes back. Everything else is a plain ledger entry —
 * the ledger trigger updates the cached balance either way.
 */
export async function recordStockAdjustment(input: {
  productId: string;
  delta: number;
  reason: AdjustmentReason;
  unitCostCents: number | null;
  note: string | null;
}): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };
  if (!input.productId) return { ok: false, message: "Pick a product first." };
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    return { ok: false, message: "Enter a quantity other than zero." };
  }

  const supabase = await createClient();

  if (input.reason === "restock") {
    if (input.delta < 0) {
      return { ok: false, message: "A restock adds stock — use a positive quantity." };
    }
    if (input.unitCostCents === null || input.unitCostCents < 0) {
      return { ok: false, message: "Enter what you paid per unit so the cost average stays right." };
    }

    const { data, error } = await supabase.rpc("restock_product", {
      p_product_id: input.productId,
      p_quantity: input.delta,
      p_unit_cost_cents: input.unitCostCents,
      p_note: input.note,
    });

    if (error) return { ok: false, message: readableError(error) };

    revalidatePath("/stock");
    revalidatePath("/catalog");
    revalidatePath("/");

    const result = data as { stock_on_hand: number; margin_pct: number; margin_alert: boolean };
    return {
      ok: true,
      message: result?.margin_alert
        ? `Restocked. Careful — margin is now ${result.margin_pct}%, below your minimum.`
        : `Restocked. ${result?.stock_on_hand ?? ""} on hand.`,
    };
  }

  const { error } = await supabase.from("stock_movements").insert({
    tenant_id: ctx.tenantId,
    product_id: input.productId,
    delta: input.delta,
    reason: REASON_MAP[input.reason],
    note: input.note,
    created_by: ctx.userId,
  });

  if (error) return { ok: false, message: readableError(error) };

  revalidatePath("/stock");
  revalidatePath("/catalog");
  revalidatePath("/");
  return { ok: true, message: "Adjustment recorded." };
}

export interface ImportRow {
  name: string;
  barcode: string | null;
  priceCents: number;
  stock: number;
}

/**
 * Bulk import. Products go in one statement so a mid-list failure doesn't leave
 * half a catalog behind; opening balances follow as ledger entries.
 */
export async function importProducts(rows: ImportRow[]): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };
  if (rows.length === 0) return { ok: false, message: "Nothing to import." };

  const supabase = await createClient();

  const { data: inserted, error } = await supabase
    .from("products")
    .insert(
      rows.map((r) => ({
        tenant_id: ctx.tenantId,
        name: r.name.trim(),
        barcode: r.barcode?.trim() || null,
        price_cents: r.priceCents,
        reorder_point: 5,
      })),
    )
    .select("id, name");

  if (error) return { ok: false, message: readableError(error) };

  const openingBalances = (inserted ?? [])
    .map((product, i) => ({ product, stock: rows[i]?.stock ?? 0 }))
    .filter(({ stock }) => stock > 0)
    .map(({ product, stock }) => ({
      tenant_id: ctx.tenantId,
      product_id: product.id,
      delta: stock,
      reason: "adjustment" as const,
      note: "Opening balance (CSV import)",
      created_by: ctx.userId,
    }));

  let stockNote = "";
  if (openingBalances.length > 0) {
    const { error: ledgerError } = await supabase.from("stock_movements").insert(openingBalances);
    stockNote = ledgerError
      ? ` Opening stock didn't record: ${readableError(ledgerError)}`
      : ` Opening stock recorded for ${openingBalances.length}.`;
  }

  revalidatePath("/catalog");
  revalidatePath("/stock");
  revalidatePath("/");
  return {
    ok: true,
    message: `Imported ${inserted?.length ?? 0} products.${stockNote}`,
  };
}
