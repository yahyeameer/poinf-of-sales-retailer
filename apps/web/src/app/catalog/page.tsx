import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { CatalogClient } from "./CatalogClient";

export const dynamic = "force-dynamic";

const DEMO_PRODUCTS = [
  { id: "1", name: "Coca-Cola 500ml", barcode: "5449000000996", price_cents: 150, stock_on_hand: 45, reorder_point: 10, is_archived: false },
  { id: "2", name: "Basmati Rice 5kg", barcode: "8901058000123", price_cents: 1250, stock_on_hand: 8, reorder_point: 15, is_archived: false },
  { id: "3", name: "Sunflower Oil 1L", barcode: "6001234567890", price_cents: 380, stock_on_hand: 4, reorder_point: 5, is_archived: false },
  { id: "4", name: "White Sugar 1kg", barcode: "6009876543210", price_cents: 210, stock_on_hand: 30, reorder_point: 10, is_archived: false },
  { id: "5", name: "Whole Milk 1L", barcode: "6001112223334", price_cents: 180, stock_on_hand: 2, reorder_point: 8, is_archived: false },
  { id: "6", name: "Wheat Flour 2kg", barcode: "6005556667778", price_cents: 340, stock_on_hand: 0, reorder_point: 10, is_archived: false },
  { id: "7", name: "Dark Chocolate 100g", barcode: "7622210001112", price_cents: 290, stock_on_hand: 18, reorder_point: 5, is_archived: true },
];

export default async function CatalogPage() {
  let products = DEMO_PRODUCTS;
  let currency = "USD";
  let shopName = "Demo Retail Shop";

  try {
    const supabase = await createClient();
    const { data: tenant } = await supabase.from("tenants").select("name, currency").single();
    if (tenant) {
      shopName = tenant.name ?? shopName;
      currency = tenant.currency ?? currency;
    }

    const { data: dbProducts } = await supabase
      .from("products")
      .select("id, name, barcode, price_cents, stock_on_hand, reorder_point, is_archived")
      .order("name", { ascending: true })
      .limit(200);

    if (dbProducts && dbProducts.length > 0) {
      products = dbProducts;
    }
  } catch {
    // Demo fallback for local development preview
  }

  return (
    <Shell shopName={shopName}>
      <CatalogClient initialProducts={products} currency={currency} />
    </Shell>
  );
}
