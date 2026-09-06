import { cookies } from "next/headers";

import { cache } from "react";

import { withDeadline } from "@/lib/deadline";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_LOCATION_COOKIE } from "@/lib/location";
import type { LocationKind, NavAccess } from "@/components/nav-items";

export interface ShopLocation {
  id: string;
  name: string;
  kind: LocationKind;
  is_default: boolean;
}

export interface TenantContext {
  userId: string;
  tenantId: string;
  role: "owner" | "manager" | "cashier";
  userName: string;
  shopName: string;
  currency: string;

  /**
   * The money the counter actually takes, when it differs from the money the
   * shop prices in. Null for a single-currency shop, which is most of them.
   * `exchangeRate` is major units of secondaryCurrency per 1 major unit of
   * `currency` — the number off a bureau board, not a minor-unit ratio.
   */
  secondaryCurrency: string | null;
  exchangeRate: number | null;

  /** Every location this user may see. One entry for a pinned cashier. */
  locations: ShopLocation[];
  /** Where writes land unless told otherwise. */
  locationId: string | null;
  locationName: string;
  /**
   * What kind of place that is. Mirrors `public.current_location_kind()`, which
   * exists for exactly this: the app has to route a warehouse picker somewhere
   * other than the retail dashboard, and it has to decide that on every request.
   */
  locationKind: LocationKind | null;
  /** True when staff are tied to a single location and cannot switch. */
  pinnedToLocation: boolean;
  /** IANA zone. Decides where the shop's day starts, for every report and
   *  every date range. 'UTC' until an owner sets it, which is what the
   *  reports assumed before the column existed. */
  timezone: string;
}

/** Bounds the whole load — the auth check plus the three queries after it —
 *  so a slow database costs one slow page rather than a function timeout. */
const TENANT_BUDGET_MS = 8_000;

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
 *
 * cache() dedupes this across a single render.
 *
 * A page and its Shell (and, on the dashboard, several cards) each call this,
 * and every one of them was doing its own auth check and its own three
 * queries — the same four round-trips repeated four or five times per page.
 * That was invisible while the database was fast and merciless when it was
 * not: against an unresponsive Supabase the dashboard spent 8 seconds per
 * call and took 39 to render, because that budget is per call and there
 * were five of them.
 *
 * Deduping is the fix for both. One load per request, so the budget means what
 * it says, and the healthy path drops from ~20 queries to 4.
 */
export const getTenantContext = cache(async (): Promise<TenantContext | null> => {
  try {
    return await withDeadline(loadTenantContext(), TENANT_BUDGET_MS, "tenant context");
  } catch (error) {
    // Never let this throw. Every page in the app calls it before rendering
    // anything, so an exception here is not "this page failed" — it is the
    // whole app replaced by the error boundary, which is what a cold Supabase
    // or a paused project used to do. The middleware has always taken this
    // view of a failed auth check; this brings the pages into line with it.
    //
    // Returning null means callers fall back to the state they already have
    // for "nobody is signed in", which is the honest answer: if we cannot
    // reach the database we genuinely do not know who this is.
    console.error("[tenant] could not load context, treating as signed out:", error);
    return null;
  }
});

async function loadTenantContext(): Promise<TenantContext | null> {
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
    supabase
      .from("tenants")
      .select("name, currency, timezone, secondary_currency, exchange_rate")
      .eq("id", profile.tenant_id)
      .single(),
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
    // Both or neither: the column pair is constrained that way, and a rate
    // without a currency would have the till converting into nothing.
    secondaryCurrency: tenant?.secondary_currency ?? null,
    exchangeRate: tenant?.exchange_rate == null ? null : Number(tenant.exchange_rate),
    timezone: tenant?.timezone ?? "UTC",
    locations: visible,
    locationId: active?.id ?? null,
    locationName: active?.name ?? "No location",
    locationKind: active?.kind ?? null,
    pinnedToLocation: pinned,
  };
}

/**
 * The slice of the context that route visibility depends on.
 *
 * Narrowing here rather than passing the whole context keeps `nav-items` free of
 * `next/headers`, which matters because the sidebar and the tab bar that read it
 * are client components.
 */
export function navAccess(ctx: TenantContext): NavAccess {
  return {
    role: ctx.role,
    locationKind: ctx.locationKind,
    pinnedToLocation: ctx.pinnedToLocation,
  };
}
