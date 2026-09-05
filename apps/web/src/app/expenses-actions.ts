"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export const EXPENSE_CATEGORIES = [
  "rent",
  "wages",
  "stock_transport",
  "utilities",
  "supplies",
  "maintenance",
  "fees",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  rent: "Rent",
  wages: "Wages",
  stock_transport: "Transport",
  utilities: "Utilities",
  supplies: "Supplies",
  maintenance: "Maintenance",
  fees: "Fees",
  other: "Other",
};

function readable(error: { message: string; code?: string } | null): string {
  if (!error) return "Something went wrong.";
  if (error.code === "42501") return "Only an owner or manager can do that.";
  return error.message;
}

function revalidateExpenses() {
  // The dashboard and analytics both show profit now, so a new expense changes
  // more than this one page.
  for (const path of ["/expenses", "/analytics", "/"]) revalidatePath(path);
}

/**
 * Record money going out.
 *
 * The amount arrives as minor units already — parsing the typed string is the
 * client's job, using the same parseMoneyToCents every other amount in this app
 * goes through, so a shop in a zero-decimal currency behaves correctly here too.
 */
export async function recordExpense(input: {
  category: ExpenseCategory;
  amountCents: number;
  spentOn: string;
  note: string;
  locationId: string | null;
}): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, message: "Enter an amount greater than zero." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_expense", {
    p_category: input.category,
    p_amount_cents: input.amountCents,
    p_spent_on: input.spentOn || null,
    p_note: input.note.trim() || null,
    p_location_id: input.locationId,
  });

  if (error) return { ok: false, message: readable(error) };

  revalidateExpenses();
  return { ok: true, message: "Expense recorded." };
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();
  // RLS decides whether this row is theirs to delete; a cashier matches no rows
  // rather than being refused, which is the same outcome from their side.
  const { error } = await supabase.from("expenses").delete().eq("id", id);

  if (error) return { ok: false, message: readable(error) };

  revalidateExpenses();
  return { ok: true, message: "Expense removed." };
}
