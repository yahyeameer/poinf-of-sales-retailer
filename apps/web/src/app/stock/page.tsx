import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { StockClient, type Movement, type LowStockItem, type ProductOption } from "./StockClient";

export const dynamic = "force-dynamic";

const DEMO_MOVEMENTS: Movement[] = [
  { id: "m1", product_id: "2", delta: 20, reason: "restock", note: null, created_at: new Date(Date.now() - 3600000 * 2).toISOString(), products: { name: "Basmati Rice 5kg" } },
  { id: "m2", product_id: "3", delta: -2, reason: "adjustment", note: "Damaged", created_at: new Date(Date.now() - 3600000 * 5).toISOString(), products: { name: "Sunflower Oil 1L" } },
  { id: "m3", product_id: "1", delta: 50, reason: "restock", note: null, created_at: new Date(Date.now() - 3600000 * 24).toISOString(), products: { name: "Coca-Cola 500ml" } },
];

const DEMO_LOW_STOCK: LowStockItem[] = [
  { product_id: "6", name: "Wheat Flour 2kg", stock_on_hand: 0, reorder_point: 10 },
  { product_id: "5", name: "Whole Milk 1L", stock_on_hand: 2, reorder_point: 8 },
];

const DEMO_PRODUCTS: ProductOption[] = [
  { id: "1", name: "Coca-Cola 500ml", stock_on_hand: 45 },
  { id: "2", name: "Basmati Rice 5kg", stock_on_hand: 8 },
];

export default async function StockPage() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return (
      <Shell shopName="Demo Retail Shop">
        <StockClient
          initialMovements={DEMO_MOVEMENTS}
          lowStock={DEMO_LOW_STOCK}
          products={DEMO_PRODUCTS}
          currency="USD"
          canEdit={false}
          demoReason="You're not signed in, so this is a preview of what the ledger looks like."
        />
      </Shell>
    );
  }

  const supabase = await createClient();

  const [{ data: movements, error: movementsError }, { data: lowStock }, { data: products }] =
    await Promise.all([
      // `delta`, not `change`. The old column name made PostgREST reject this
      // query outright, which is why the ledger only ever showed demo rows.
      supabase
        .from("stock_movements")
        .select("id, product_id, delta, reason, note, created_at, products(name)")
        .order("created_at", { ascending: false })
        .limit(50),

      supabase
        .from("v_low_stock")
        .select("product_id, name, stock_on_hand, reorder_point")
        .order("stock_on_hand", { ascending: true }),

      supabase
        .from("products")
        .select("id, name, stock_on_hand")
        .eq("is_active", true)
        .order("name", { ascending: true }),
    ]);

  if (movementsError) {
    console.error("[stock] movement query failed:", movementsError);
  }

  return (
    <Shell shopName={ctx.shopName}>
      <StockClient
        initialMovements={movementsError ? DEMO_MOVEMENTS : ((movements ?? []) as Movement[])}
        lowStock={(lowStock ?? []) as LowStockItem[]}
        products={(products ?? []) as ProductOption[]}
        currency={ctx.currency}
        canEdit
        demoReason={movementsError ? `Couldn't load the ledger: ${movementsError.message}` : null}
      />
    </Shell>
  );
}
