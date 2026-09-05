"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export type StaffRole = "owner" | "manager" | "cashier";

/**
 * Postgres already raises these with messages written for a shop owner, so pass
 * them through rather than replacing them with something vaguer. The custom
 * SQLSTATEs are the contract: PS403 not permitted, PS404 not found, PS422 bad input.
 */
function readableError(error: { message: string; code?: string } | null): string {
  if (!error) return "Something went wrong.";
  if (error.code === "42501") return "You are not allowed to do that.";
  return error.message;
}

function revalidateStaff() {
  for (const path of ["/staff", "/till", "/"]) revalidatePath(path);
}

export async function saveStaff(input: {
  id: string | null;
  name: string;
  role: StaffRole;
  locationId: string | null;
  email: string | null;
}): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };
  if (!input.name.trim()) return { ok: false, message: "Give the staff member a name." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_staff", {
    p_id: input.id,
    p_name: input.name,
    p_role: input.role,
    p_location_id: input.locationId,
    p_email: input.email,
  });

  if (error) return { ok: false, message: readableError(error) };

  revalidateStaff();
  return {
    ok: true,
    message: input.id ? `Updated ${input.name.trim()}.` : `Added ${input.name.trim()}.`,
  };
}

export async function setStaffActive(id: string, active: boolean): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_staff_active", { p_id: id, p_active: active });

  if (error) return { ok: false, message: readableError(error) };

  revalidateStaff();
  return { ok: true, message: active ? "Staff member reactivated." : "Staff member deactivated." };
}

export async function setStaffPin(id: string, pin: string): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };
  if (!/^[0-9]{4,8}$/.test(pin)) {
    return { ok: false, message: "A PIN is 4 to 8 digits." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_staff_pin", { p_user_id: id, p_pin: pin });

  if (error) return { ok: false, message: readableError(error) };

  revalidateStaff();
  // Never echo the PIN back, not even in a success message — it would land in
  // logs, screenshots and anyone reading over the owner's shoulder.
  return { ok: true, message: "PIN set. They can now unlock the till." };
}

export async function clearStaffPin(id: string): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_staff_pin", { p_user_id: id });

  if (error) return { ok: false, message: readableError(error) };

  revalidateStaff();
  return { ok: true, message: "PIN removed. They can no longer unlock the till." };
}

/**
 * "I think someone watched them type it."
 *
 * Leaves the PIN working so a shift in progress is not interrupted, and makes
 * the till ask for a new one at the next unlock.
 */
export async function requireStaffPinChange(id: string): Promise<ActionResult> {
  const ctx = await getTenantContext();
  if (!ctx) return { ok: false, message: "You need to sign in first." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("require_staff_pin_change", { p_user_id: id });

  if (error) return { ok: false, message: readableError(error) };

  revalidateStaff();
  return {
    ok: true,
    message: "They'll be asked to choose a new PIN next time they open the till.",
  };
}
