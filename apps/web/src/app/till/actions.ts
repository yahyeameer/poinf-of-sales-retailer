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
 * The RPCs raise custom SQLSTATEs with messages already written for a shop
 * owner, so the message is usually the right thing to show. The codes are
 * mapped only where the raw text would leak schema detail.
 */
function readable(error: { message: string; code?: string } | null): string {
  if (!error) return "Something went wrong.";
  switch (error.code) {
    case "PS401": return "Your session expired. Sign in again.";
    case "PS403": return error.message;
    case "PS404": return error.message;
    case "PS405": return error.message;
    case "PS422": return error.message;
    case "23505": return "That looks like a duplicate — it may already have gone through.";
    case "42501": return "Your account doesn't have permission to do that.";
    default: return error.message;
  }
}

export interface CartItem {
  productId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface TenderInput {
  method: "cash" | "mobile_money" | "card";
  amountCents: number;
  tenderedCents?: number | null;
  reference?: string | null;
}

// --- shift ----------------------------------------------------------------

export async function openShift(floatCents: number): Promise<ActionResult<{ id: string }>> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_shift", {
    p_opening_float_cents: Math.max(0, Math.round(floatCents)),
  });

  if (error) return { ok: false, message: readable(error) };

  revalidatePath("/till");
  return { ok: true, message: "Shift open.", data: { id: (data as { id: string }).id } };
}

export async function closeShift(
  shiftId: string,
  countedCents: number,
  note: string | null,
): Promise<ActionResult<{ variance: number; expected: number }>> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_shift", {
    p_shift_id: shiftId,
    p_counted_cash_cents: Math.max(0, Math.round(countedCents)),
    p_note: note,
  });

  if (error) return { ok: false, message: readable(error) };

  const shift = data as { variance_cents: number; expected_cash_cents: number };
  revalidatePath("/till");
  revalidatePath("/shifts");
  return {
    ok: true,
    message: "Shift closed.",
    data: { variance: shift.variance_cents, expected: shift.expected_cash_cents },
  };
}

export async function recordCashMovement(
  shiftId: string,
  kind: "pay_in" | "pay_out" | "drop",
  amountCents: number,
  reason: string,
): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_cash_movement", {
    p_shift_id: shiftId,
    p_kind: kind,
    p_amount_cents: Math.round(amountCents),
    p_reason: reason,
  });

  if (error) return { ok: false, message: readable(error) };

  revalidatePath("/till");
  return { ok: true, message: "Recorded." };
}

export async function getShiftReport(shiftId: string): Promise<ActionResult<unknown>> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("shift_report", { p_shift_id: shiftId });

  if (error) return { ok: false, message: readable(error) };
  return { ok: true, message: "", data };
}

// --- the sale -------------------------------------------------------------

export async function completeSale(input: {
  clientId: string;
  items: CartItem[];
  payments: TenderInput[];
  discountCents: number;
  shiftId: string | null;
  note: string | null;
}): Promise<ActionResult<{ saleId: string; totalCents: number; changeCents: number }>> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };
  if (input.items.length === 0) return { ok: false, message: "The cart is empty." };
  if (input.payments.length === 0) return { ok: false, message: "Take a payment first." };

  const supabase = await createClient();

  // client_id is generated on the device before the first attempt and reused on
  // every retry, so a response lost to a dropped connection replays into the
  // same row rather than charging the customer twice.
  const { data, error } = await supabase.rpc("process_sale", {
    p_client_id: input.clientId,
    p_items: input.items.map((i) => ({
      product_id: i.productId,
      quantity: i.quantity,
      unit_price_cents: i.unitPriceCents,
    })),
    p_payment_method: input.payments.length === 1 ? input.payments[0]!.method : "mixed",
    p_discount_cents: input.discountCents,
    p_note: input.note,
    p_shift_id: input.shiftId,
    p_payments: input.payments.map((p) => ({
      method: p.method,
      amount_cents: p.amountCents,
      tendered_cents: p.tenderedCents ?? null,
      reference: p.reference ?? null,
    })),
  });

  if (error) return { ok: false, message: readable(error) };

  const sale = data as { id: string; total_cents: number };

  const cashTendered = input.payments
    .filter((p) => p.method === "cash")
    .reduce((sum, p) => sum + (p.tenderedCents ?? p.amountCents), 0);
  const cashDue = input.payments
    .filter((p) => p.method === "cash")
    .reduce((sum, p) => sum + p.amountCents, 0);

  revalidatePath("/till");
  revalidatePath("/");
  revalidatePath("/receipts");
  revalidatePath("/stock");

  return {
    ok: true,
    message: "Sale complete.",
    data: {
      saleId: sale.id,
      totalCents: sale.total_cents,
      changeCents: Math.max(0, cashTendered - cashDue),
    },
  };
}

// --- parked sales ---------------------------------------------------------

export async function parkSale(label: string, cart: unknown): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();
  const { error } = await supabase.from("parked_sales").insert({
    tenant_id: ctx.tenantId,
    parked_by: ctx.userId,
    label: label.trim() || "Held sale",
    cart: cart as never,
  });

  if (error) return { ok: false, message: readable(error) };

  revalidatePath("/till");
  return { ok: true, message: "Held. Pick it up from the Held tab." };
}

export async function deleteParkedSale(id: string): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();
  const { error } = await supabase.from("parked_sales").delete().eq("id", id);

  if (error) return { ok: false, message: readable(error) };

  revalidatePath("/till");
  return { ok: true, message: "Removed." };
}

// --- voids ----------------------------------------------------------------

/**
 * Cancel a sale outright, as opposed to refunding part of it.
 *
 * The distinction matters at the drawer. A refund is its own document with its
 * own negative total, which is what you want when a customer brings something
 * back tomorrow. A void says the sale should never have been rung up at all —
 * the wrong button, a double scan, a customer who changed their mind while the
 * cash was still in the cashier's hand — and leaving it as a sale plus a refund
 * makes a day's takings read as two transactions that never happened.
 *
 * void_sale() decides who may: owners and managers for the whole day, a cashier
 * for five minutes and only on their own sale. It writes compensating ledger
 * entries rather than deleting anything, and it is idempotent, so a double-tap
 * on a slow connection cannot double-restock.
 */
export async function voidSale(
  saleId: string,
  reason: string | null,
): Promise<ActionResult<{ saleId: string }>> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };
  if (!saleId) return { ok: false, message: "Pick a sale first." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("void_sale", {
    p_sale_id: saleId,
    p_reason: reason?.trim() || null,
  });

  // PS403 ("you can only void your own sales") and PS405 ("older than five
  // minutes — ask the owner") arrive with the sentence the cashier should read,
  // and `readable` passes both straight through.
  if (error) return { ok: false, message: readable(error) };

  const sale = data as { id: string };

  revalidatePath("/receipts");
  revalidatePath("/till");
  revalidatePath("/");
  revalidatePath("/stock");

  return { ok: true, message: "Sale voided. The stock has gone back.", data: { saleId: sale.id } };
}

// --- refunds --------------------------------------------------------------

export async function refundSale(input: {
  originalSaleId: string;
  clientId: string;
  lines: { saleItemId: string; quantity: number }[] | null;
  reason: string | null;
  method: "cash" | "mobile_money" | "card" | null;
  restock: boolean;
}): Promise<ActionResult<{ totalCents: number }>> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();

  // Attach the refund to the open shift if there is one, so cash handed back
  // lands in the drawer reconciliation rather than going missing at close.
  const { data: openShift } = await supabase
    .from("shifts")
    .select("id")
    .eq("status", "open")
    .maybeSingle();

  const { data, error } = await supabase.rpc("refund_sale", {
    p_original_sale_id: input.originalSaleId,
    p_client_id: input.clientId,
    p_lines: input.lines
      ? input.lines.map((l) => ({ sale_item_id: l.saleItemId, quantity: l.quantity }))
      : null,
    p_reason: input.reason,
    p_method: input.method,
    p_shift_id: openShift?.id ?? null,
    p_restock: input.restock,
  });

  if (error) return { ok: false, message: readable(error) };

  const refund = data as { total_cents: number };
  revalidatePath("/receipts");
  revalidatePath("/till");
  revalidatePath("/");
  revalidatePath("/stock");

  return {
    ok: true,
    message: "Refunded.",
    data: { totalCents: refund.total_cents },
  };
}
