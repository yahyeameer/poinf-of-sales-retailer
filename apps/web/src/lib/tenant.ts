import { createClient } from "@/lib/supabase/server";

export interface TenantContext {
  userId: string;
  tenantId: string;
  role: "owner" | "manager" | "cashier";
  userName: string;
  shopName: string;
  currency: string;
}

/**
 * Who is asking, and which shop are they in.
 *
 * Returns null when nobody is signed in, or when the account exists but has no
 * shop yet — the window between signup and onboarding. Callers treat both the
 * same way: there is nothing to show.
 *
 * Every write needs `tenantId` explicitly because the RLS WITH CHECK compares
 * the inserted row's tenant_id against the session's. The database would reject
 * a mismatch, but supplying it here means the failure never happens.
 */
export async function getTenantContext(): Promise<TenantContext | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("tenant_id, role, name")
    .eq("id", user.id)
    .single();

  if (!profile?.tenant_id) return null;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, currency")
    .eq("id", profile.tenant_id)
    .single();

  return {
    userId: user.id,
    tenantId: profile.tenant_id,
    role: profile.role,
    userName: profile.name ?? user.email ?? "",
    shopName: tenant?.name ?? "Your shop",
    currency: tenant?.currency ?? "USD",
  };
}
