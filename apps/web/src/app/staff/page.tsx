import { redirect } from "next/navigation";

import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { StaffClient, type StaffMember } from "./StaffClient";

export const dynamic = "force-dynamic";

interface StaffRow {
  id: string;
  name: string | null;
  email: string | null;
  role: StaffMember["role"];
  is_active: boolean;
  login_enabled: boolean;
  location_id: string | null;
  created_at: string;
  has_pin: boolean;
}

/**
 * v_staff_pin_status (20260905000100) is the schema's own answer to "what may
 * this row's buttons offer", and can_manage there uses the same rule the RPCs
 * enforce. Deriving it in the browser instead would let the UI show an action
 * that is going to fail — a manager offered a "Change PIN" button on the
 * owner's row, for instance.
 */
interface PinStatusRow {
  id: string;
  pin_set_at: string | null;
  pin_last_used_at: string | null;
  must_change_pin: boolean;
  pin_never_used: boolean;
  can_manage: boolean;
}

interface PinEventRow {
  id: string;
  actor_id: string | null;
  target_id: string;
  action: string;
  created_at: string;
}

export default async function StaffPage() {
  const ctx = await getTenantContext();
  // Staff is about who can do what in *your* shop; there's no useful preview
  // of that for a signed-out visitor.
  if (!ctx) redirect("/login?next=/staff");

  const supabase = await createClient();

  const [{ data, error }, { data: pinStatus }, { data: pinEvents }] = await Promise.all([
    supabase
      .from("users")
      .select("id, name, email, role, is_active, login_enabled, location_id, created_at, has_pin")
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("v_staff_pin_status")
      .select("id, pin_set_at, pin_last_used_at, must_change_pin, pin_never_used, can_manage"),
    // Only owners and managers can read this at all; a cashier gets nothing
    // back rather than an error, so no branch is needed here.
    supabase
      .from("staff_pin_events")
      .select("id, actor_id, target_id, action, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (error) {
    console.error("[staff] query failed:", error);
  }

  const statusById = new Map(
    ((pinStatus ?? []) as unknown as PinStatusRow[]).map((r) => [r.id, r]),
  );

  // has_pin is a generated column (20260904000100_protect_pin_hash.sql). The
  // hash itself is no longer selectable at all — `authenticated` holds column
  // grants on public.users that leave pin_hash out — so this page asks the
  // only question it ever had: is a PIN set.
  const staff: StaffMember[] = ((data ?? []) as StaffRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    is_active: row.is_active,
    login_enabled: row.login_enabled,
    has_pin: row.has_pin,
    location_id: row.location_id,
    created_at: row.created_at,
    pin_set_at: statusById.get(row.id)?.pin_set_at ?? null,
    pin_last_used_at: statusById.get(row.id)?.pin_last_used_at ?? null,
    must_change_pin: statusById.get(row.id)?.must_change_pin ?? false,
    pin_never_used: statusById.get(row.id)?.pin_never_used ?? false,
    // Absent status row means the view returned nothing for them, which is the
    // safe direction to fail: no buttons rather than buttons that error.
    can_manage_pin: statusById.get(row.id)?.can_manage ?? false,
  }));

  const nameById = new Map(staff.map((s) => [s.id, s.name ?? "Someone"]));
  const events = ((pinEvents ?? []) as unknown as PinEventRow[]).map((e) => ({
    id: e.id,
    action: e.action,
    created_at: e.created_at,
    actor: e.actor_id ? (nameById.get(e.actor_id) ?? "A removed account") : "A removed account",
    target: nameById.get(e.target_id) ?? "A removed account",
  }));

  return (
    <Shell shopName={ctx.shopName}>
      <StaffClient
        staff={staff}
        locations={ctx.locations}
        canEdit={ctx.role === "owner"}
        // Managers can now issue cashiers' PINs even though they cannot edit
        // staff records, so the two permissions are no longer the same thing.
        canManageAnyPin={staff.some((s) => s.can_manage_pin)}
        pinEvents={events}
        currentUserId={ctx.userId}
      />
    </Shell>
  );
}
