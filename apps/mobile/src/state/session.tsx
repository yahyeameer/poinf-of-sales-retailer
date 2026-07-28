import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AppState } from "react-native";

import type { Tenant } from "@ai-pos/shared";

import { clearCatalogOnSignOut, countPendingSales } from "@/db/local";
import { supabase, tenantIdFromSession } from "@/lib/supabase";
import { fullCatalogPull, incrementalCatalogPull, subscribeToCatalog } from "@/sync/catalog";
import { drainQueue, pruneSyncedSales } from "@/sync/queue";

const INCREMENTAL_INTERVAL_MS = 5 * 60 * 1000;

interface SessionState {
  session: Session | null;
  tenantId: string | null;
  tenant: Tenant | null;
  pendingCount: number;
  ready: boolean;
  refreshPending: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [ready, setReady] = useState(false);
  const unsubscribeCatalog = useRef<(() => void) | null>(null);

  const tenantId = tenantIdFromSession(session?.access_token);

  async function refreshPending() {
    setPendingCount(await countPendingSales());
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Catalog lifecycle, tied to having a shop rather than to having a session:
  // a user who has signed up but not onboarded has one and not the other.
  useEffect(() => {
    if (!tenantId) {
      setTenant(null);
      return;
    }

    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("tenants")
        .select("id, name, currency, tax_rate, tax_inclusive, plan, min_margin_pct, allow_oversell")
        .single();

      if (cancelled || !data) return;

      setTenant({
        id: data.id,
        name: data.name,
        currency: data.currency,
        taxRate: Number(data.tax_rate),
        taxInclusive: data.tax_inclusive,
        plan: data.plan,
        minMarginPct: Number(data.min_margin_pct),
        allowOversell: data.allow_oversell,
      });

      // Errors here are survivable: a stale catalog still sells, and the queue
      // keeps sales safe. Never block the sale screen on a network call.
      try {
        await fullCatalogPull();
      } catch (err) {
        console.warn("Initial catalog pull failed; using what's on the device", err);
      }

      await drainQueue();
      await pruneSyncedSales();
      await refreshPending();

      unsubscribeCatalog.current = subscribeToCatalog(tenantId);
    })();

    const timer = setInterval(() => {
      void incrementalCatalogPull().catch(() => {});
      void drainQueue().then(refreshPending);
    }, INCREMENTAL_INTERVAL_MS);

    // Coming back from the background is the most likely moment for
    // connectivity to have returned, so drain then too.
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void drainQueue().then(refreshPending);
      }
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      appStateSub.remove();
      unsubscribeCatalog.current?.();
      unsubscribeCatalog.current = null;
    };
  }, [tenantId]);

  async function signOut() {
    // Queued sales are money that already changed hands. Refuse to sign out
    // while any are unsynced rather than stranding them behind a login screen.
    const pending = await countPendingSales();
    if (pending > 0) {
      throw new Error(
        `${pending} sale(s) haven't synced yet. Get online and let them through before signing out.`,
      );
    }

    await supabase.auth.signOut();
    await clearCatalogOnSignOut();
  }

  const value = useMemo<SessionState>(
    () => ({ session, tenantId, tenant, pendingCount, ready, refreshPending, signOut }),
    [session, tenantId, tenant, pendingCount, ready],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
