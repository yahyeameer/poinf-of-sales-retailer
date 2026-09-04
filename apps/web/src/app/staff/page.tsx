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

export default async function StaffPage() {
  const ctx = await getTenantContext();
  // Staff is about who can do what in *your* shop; there's no useful preview
  // of that for a signed-out visitor.
  if (!ctx) redirect("/login?next=/staff");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, role, is_active, login_enabled, location_id, created_at, has_pin")
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[staff] query failed:", error);
  }

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
  }));

  return (
    <Shell shopName={ctx.shopName}>
      <StaffClient
        staff={staff}
        locations={ctx.locations}
        canEdit={ctx.role === "owner"}
        currentUserId={ctx.userId}
      />
    </Shell>
  );
}
