import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { ACTIVE_LOCATION_COOKIE } from "@/lib/location";

export interface ShopLocation {
  id: string;
  name: string;
  kind: "shop" | "warehouse" | "van";
  is_default: boolean;
}

export interface TenantContext {
  userId: string;
  tenantId: string;
  role: "owner" | "manager" | "cashier";
  userName: string;
  shopName: string;
  currency: string;

  /** Every location this user may see. One entry for a pinned cashier. */
  locations: ShopLocation[];
  /** Where writes land unless told otherwise. */
  locationId: string | null;
  locationName: string;
  /** True when staff are tied to a single location and cannot switch. */
  pinnedToLocation: boolean;
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
    .select("tenant_id, role, name, location_id")
    .eq("id", user.id)
    .single();

  if (!profile?.tenant_id) return null;

  const [{ data: tenant }, { data: locations }] = await Promise.all([
    supabase.from("tenants").select("name, currency").eq("id", profile.tenant_id).single(),
    supabase
      .from("locations")
      .select("id, name, kind, is_default")
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true }),
  ]);

  const all = (locations ?? []) as ShopLocation[];

  // A pinned user sees only their own location. RLS enforces this on the data;
  // filtering here just keeps the switcher honest about what it offers.
  const pinned = profile.location_id != null;
  const visible = pinned ? all.filter((l) => l.id === profile.location_id) : all;

  // Precedence: a pinned assignment always wins, then whatever the user last
  // switched to, then the shop's default. The cookie is looked up against the
  // visible list rather than trusted directly, so a stale or forged value falls
  // back to the default instead of pointing writes at another shop.
  const store = await cookies();
  const chosenId = store.get(ACTIVE_LOCATION_COOKIE)?.value;

  const active =
    visible.find((l) => l.id === profile.location_id) ??
    visible.find((l) => l.id === chosenId) ??
    visible.find((l) => l.is_default) ??
    visible[0] ??
    null;

  return {
    userId: user.id,
    tenantId: profile.tenant_id,
    role: profile.role,
    userName: profile.name ?? user.email ?? "",
    shopName: tenant?.name ?? "Your shop",
    currency: tenant?.currency ?? "USD",
    locations: visible,
    locationId: active?.id ?? null,
    locationName: active?.name ?? "No location",
    pinnedToLocation: pinned,
  };
}
