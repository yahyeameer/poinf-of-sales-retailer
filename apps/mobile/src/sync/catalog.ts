import { openLocalDb, setSyncState, getSyncState } from "@/db/local";
import { supabase } from "@/lib/supabase";

/**
 * Pulls the catalog down to the device.
 *
 * Full pull on login, incremental every few minutes after, plus a realtime
 * subscription for anything that changes in between. The incremental pass isn't
 * redundant with realtime — a phone that was asleep or out of coverage misses
 * the websocket entirely, and "belt and braces" is cheap here.
 */

const PAGE_SIZE = 1000;

interface RemoteProduct {
  id: string;
  tenant_id: string;
  name: string;
  barcode: string | null;
  sku: string | null;
  price_cents: number;
  unit: string;
  stock_on_hand: number;
  is_active: boolean;
  updated_at: string;
}

async function upsertProducts(products: RemoteProduct[]): Promise<void> {
  if (products.length === 0) return;
  const db = await openLocalDb();

  await db.withTransactionAsync(async () => {
    for (const p of products) {
      await db.runAsync(
        `INSERT INTO products
           (id, tenant_id, name, barcode, sku, price_cents, unit, stock_on_hand, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           barcode = excluded.barcode,
           sku = excluded.sku,
           price_cents = excluded.price_cents,
           unit = excluded.unit,
           stock_on_hand = excluded.stock_on_hand,
           is_active = excluded.is_active,
           updated_at = excluded.updated_at`,
        [
          p.id,
          p.tenant_id,
          p.name,
          p.barcode,
          p.sku,
          p.price_cents,
          p.unit,
          p.stock_on_hand,
          p.is_active ? 1 : 0,
          p.updated_at,
        ],
      );
    }
  });
}

/**
 * Server stock overwrites local on every pull — the server is authoritative.
 * Anything this device sold that hasn't synced yet is then re-applied, so a
 * pull mid-queue doesn't make sold stock reappear on the shelf.
 */
async function reapplyPendingDeltas(): Promise<void> {
  const db = await openLocalDb();
  await db.execAsync(`
    UPDATE products
    SET stock_on_hand = stock_on_hand + COALESCE((
      SELECT SUM(d.delta) FROM local_stock_deltas d WHERE d.product_id = products.id
    ), 0)
    WHERE id IN (SELECT product_id FROM local_stock_deltas);
  `);
}

export async function fullCatalogPull(): Promise<number> {
  let from = 0;
  let total = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("products")
      .select("id, tenant_id, name, barcode, sku, price_cents, unit, stock_on_hand, is_active, updated_at")
      .eq("is_active", true)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Catalog pull failed: ${error.message}`);
    if (!data || data.length === 0) break;

    await upsertProducts(data as RemoteProduct[]);
    total += data.length;

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  await reapplyPendingDeltas();
  await setSyncState("catalog_last_pull", new Date().toISOString());
  return total;
}

export async function incrementalCatalogPull(): Promise<number> {
  const since = await getSyncState("catalog_last_pull");
  if (!since) return fullCatalogPull();

  const { data, error } = await supabase
    .from("products")
    .select("id, tenant_id, name, barcode, sku, price_cents, unit, stock_on_hand, is_active, updated_at")
    .gt("updated_at", since)
    .order("updated_at");

  if (error) throw new Error(`Incremental pull failed: ${error.message}`);

  await upsertProducts((data ?? []) as RemoteProduct[]);
  await reapplyPendingDeltas();
  await setSyncState("catalog_last_pull", new Date().toISOString());

  return data?.length ?? 0;
}

/** Live updates while the app is open. Returns an unsubscribe function. */
export function subscribeToCatalog(tenantId: string): () => void {
  const channel = supabase
    .channel(`catalog:${tenantId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "products", filter: `tenant_id=eq.${tenantId}` },
      (payload) => {
        void upsertProducts([payload.new as RemoteProduct]).then(reapplyPendingDeltas);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
