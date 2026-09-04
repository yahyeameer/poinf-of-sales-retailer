import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

/**
 * Who is standing at the till right now, as opposed to whose browser session
 * this is.
 *
 * A shop phone is shared. One Supabase account is signed in all day and staff
 * take turns on it, so `auth.uid()` identifies the device, not the person who
 * rang the sale up. process_sale has always had the other half of this —
 * `p_cashier_id`, added by 20260808000100_staff_without_logins.sql, which
 * accepts any active staff member of the caller's own shop and falls back to
 * the session user. What was missing is the part that establishes *which*
 * staff member, and proves it.
 *
 * The proof is a PIN, checked by verify_staff_pin(). That function is SECURITY
 * DEFINER precisely so `pin_hash` never has to be selectable by a client, and
 * it is tenant-scoped, so it will not verify a PIN belonging to another shop.
 *
 * The result is kept in an httpOnly cookie. That matters: the browser can
 * neither read nor write it, so a client cannot nominate a cashier without
 * going through the PIN. The id is still re-checked against till_staff() on
 * every read rather than trusted — a staff member deactivated mid-shift should
 * stop being able to ring up sales the moment the owner says so, not whenever
 * the cookie happens to expire.
 */
export const TILL_CASHIER_COOKIE = "aipos_till_cashier";

/** A shift, not a week. Long enough to cover a day on the floor; short enough
 *  that a phone left on a counter overnight does not stay unlocked. */
export const TILL_SESSION_MAX_AGE = 60 * 60 * 14;

export interface TillCashier {
  id: string;
  name: string;
  role: "owner" | "manager" | "cashier";
}

interface TillStaffRow {
  id: string;
  name: string | null;
  role: TillCashier["role"];
}

/**
 * Staff who can take over the till: active, in this shop, and with a PIN set.
 * till_staff() is the schema's own answer to that question and had no caller
 * until now.
 */
export async function listTillStaff(locationId: string | null): Promise<TillCashier[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("till_staff", { p_location_id: locationId });

  if (error) {
    console.error("[till] could not list staff:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as TillStaffRow[]).map((r) => ({
    id: r.id,
    name: r.name ?? "Unnamed",
    role: r.role,
  }));
}

/**
 * The unlocked cashier, or null.
 *
 * Resolved against the live staff list rather than taken from the cookie at
 * face value, so a deactivated or PIN-cleared staff member falls out
 * immediately.
 */
export async function getTillCashier(locationId: string | null): Promise<TillCashier | null> {
  const store = await cookies();
  const id = store.get(TILL_CASHIER_COOKIE)?.value;
  if (!id) return null;

  const staff = await listTillStaff(locationId);
  return staff.find((s) => s.id === id) ?? null;
}
