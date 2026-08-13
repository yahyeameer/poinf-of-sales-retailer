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
  pin_hash: string | null;
}

export default async function StaffPage() {
  const ctx = await getTenantContext();
  // Staff is about who can do what in *your* shop; there's no useful preview
  // of that for a signed-out visitor.
  if (!ctx) redirect("/login?next=/staff");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, role, is_active, login_enabled, location_id, created_at, pin_hash")
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[staff] query failed:", error);
  }

  // pin_hash never reaches the browser. Whether someone *has* a PIN is what the
  // page needs; the hash itself is not the client's business, and shipping it
  // would put a bcrypt digest per employee into the page source.
  const staff: StaffMember[] = ((data ?? []) as StaffRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    is_active: row.is_active,
    login_enabled: row.login_enabled,
    has_pin: row.pin_hash !== null,
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
