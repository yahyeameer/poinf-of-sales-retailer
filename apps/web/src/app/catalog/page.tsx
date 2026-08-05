import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { CatalogClient, type Product } from "./CatalogClient";

export const dynamic = "force-dynamic";

const DEMO_PRODUCTS: Product[] = [
  { id: "1", name: "Coca-Cola 500ml", barcode: "5449000000996", price_cents: 150, stock_on_hand: 45, reorder_point: 10, is_active: true },
  { id: "2", name: "Basmati Rice 5kg", barcode: "8901058000123", price_cents: 1250, stock_on_hand: 8, reorder_point: 15, is_active: true },
  { id: "3", name: "Sunflower Oil 1L", barcode: "6001234567890", price_cents: 380, stock_on_hand: 4, reorder_point: 5, is_active: true },
  { id: "4", name: "White Sugar 1kg", barcode: "6009876543210", price_cents: 210, stock_on_hand: 30, reorder_point: 10, is_active: true },
  { id: "5", name: "Whole Milk 1L", barcode: "6001112223334", price_cents: 180, stock_on_hand: 2, reorder_point: 8, is_active: true },
  { id: "6", name: "Wheat Flour 2kg", barcode: "6005556667778", price_cents: 340, stock_on_hand: 0, reorder_point: 10, is_active: true },
  { id: "7", name: "Dark Chocolate 100g", barcode: "7622210001112", price_cents: 290, stock_on_hand: 18, reorder_point: 5, is_active: false },
];

export default async function CatalogPage() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return (
      <Shell shopName="Demo Retail Shop">
        <CatalogClient
          initialProducts={DEMO_PRODUCTS}
          currency="USD"
          canEdit={false}
          demoReason="You're not signed in, so this is a preview of what the catalog looks like."
        />
      </Shell>
    );
  }

  const supabase = await createClient();

  // `is_active`, not `is_archived` — the latter has never existed on this table.
  // PostgREST rejected the whole query over it, the error was swallowed, and the
  // page served the demo list forever. Real products would never have appeared.
  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, barcode, price_cents, stock_on_hand, reorder_point, is_active")
    .order("name", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[catalog] product query failed:", error);
  }

  return (
    <Shell shopName={ctx.shopName}>
      <CatalogClient
        initialProducts={error ? DEMO_PRODUCTS : (products ?? [])}
        currency={ctx.currency}
        canEdit={ctx.role === "owner" || ctx.role === "manager"}
        demoReason={error ? `Couldn't load your catalog: ${error.message}` : null}
      />
    </Shell>
  );
}
