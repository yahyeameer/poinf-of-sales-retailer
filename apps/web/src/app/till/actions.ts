"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import {
  TILL_CASHIER_COOKIE,
  TILL_SESSION_MAX_AGE,
  getTillCashier,
  listTillStaff,
} from "@/lib/till-session";

export interface ActionResult<T = undefined> {
  ok: boolean;
  message: string;
  data?: T;
  /** Set when the caller needs to do something specific rather than just show
   *  the message. Currently only "must_change_pin", which is a correct PIN
   *  that cannot be used until it is replaced. */
  code?: "must_change_pin";
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

// --- who is on the till ---------------------------------------------------

/**
 * Take over the till by PIN.
 *
 * A shop phone is shared: one account stays signed in and staff swap on it, so
 * `auth.uid()` names the device rather than the person. verify_staff_pin() is
 * the schema's answer and is SECURITY DEFINER so `pin_hash` is never
 * selectable by a client; it is also tenant-scoped, so a PIN from another shop
 * cannot verify here.
 *
 * On success the cashier's id goes into an httpOnly cookie, which the browser
 * can neither read nor write — so nobody can nominate a cashier without the
 * PIN.
 */
export async function unlockTill(userId: string, pin: string): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };
  if (!userId) return { ok: false, message: "Pick who is on the till." };
  if (!/^[0-9]{4,8}$/.test(pin)) return { ok: false, message: "A PIN is 4 to 8 digits." };

  // Confirm the person is on this shop's till roster before spending a PIN
  // check on them, so an id that was never eligible fails as "not on the till"
  // rather than as a wrong PIN.
  const staff = await listTillStaff(ctx.locationId);
  const member = staff.find((s) => s.id === userId);
  if (!member) return { ok: false, message: "That person can't take the till here." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("verify_staff_pin", {
    p_user_id: userId,
    p_pin: pin,
  });

  if (error) return { ok: false, message: readable(error) };

  // Deliberately the same message whether the PIN was wrong or the account is
  // not eligible: a till stands where customers can see it, and a response
  // that distinguishes the two turns the keypad into a way to enumerate staff.
  if (data !== true) return { ok: false, message: "That PIN didn't match." };

  // Correct PIN, but it was issued by someone else and has not been replaced.
  // The cookie is deliberately not set: whoever issued it also knows it, so a
  // shift must not start until it has been changed. The gate takes this as its
  // cue to ask for a new one, having just proved the old one.
  if (member.mustChangePin) {
    return {
      ok: false,
      code: "must_change_pin",
      message: "That PIN was issued to you. Choose your own to carry on.",
    };
  }

  const store = await cookies();
  store.set(TILL_CASHIER_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: TILL_SESSION_MAX_AGE,
  });

  revalidatePath("/till");
  return { ok: true, message: `${member.name} is on the till.` };
}

/**
 * Replace your own PIN, from the till, and take over in the same step.
 *
 * change_own_staff_pin() takes the current PIN as its authorisation, so this
 * needs no manager and no elevated role — which is the point. A cashier who
 * has just been handed a one-time PIN can make it theirs at the counter
 * instead of waiting for someone with a login.
 *
 * The unlock is folded in because the alternative is asking for the new PIN
 * twice in a row: once to set it, once to log in with it.
 */
export async function changeOwnTillPin(
  userId: string,
  currentPin: string,
  newPin: string,
): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };
  if (!/^[0-9]{4,8}$/.test(newPin)) {
    return { ok: false, message: "A PIN is 4 to 8 digits." };
  }
  if (newPin === currentPin) {
    return { ok: false, message: "Pick a PIN different from the one you were given." };
  }

  const staff = await listTillStaff(ctx.locationId);
  const member = staff.find((s) => s.id === userId);
  if (!member) return { ok: false, message: "That person can't take the till here." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_own_staff_pin", {
    p_user_id: userId,
    p_current_pin: currentPin,
    p_new_pin: newPin,
  });

  if (error) return { ok: false, message: readable(error) };

  const store = await cookies();
  store.set(TILL_CASHIER_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: TILL_SESSION_MAX_AGE,
  });

  revalidatePath("/till");
  return { ok: true, message: `PIN changed. ${member.name} is on the till.` };
}

/** Hand the till back. Does not close the shift — the drawer is still open. */
export async function lockTill(): Promise<ActionResult> {
  const store = await cookies();
  store.delete(TILL_CASHIER_COOKIE);
  revalidatePath("/till");
  return { ok: true, message: "Till locked." };
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

  // Whoever unlocked the till by PIN gets the credit, falling back to the
  // signed-in account when nobody has. Read here rather than accepted from the
  // caller: the cookie is httpOnly and set only by unlockTill(), so a client
  // cannot attribute a sale to someone else. process_sale re-checks that the
  // id is active staff of this shop regardless.
  const cashier = await getTillCashier(ctx.locationId);

  // client_id is generated on the device before the first attempt and reused on
  // every retry, so a response lost to a dropped connection replays into the
  // same row rather than charging the customer twice.
  const { data, error } = await supabase.rpc("process_sale", {
    p_cashier_id: cashier?.id ?? null,
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
