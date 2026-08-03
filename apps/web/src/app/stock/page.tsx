import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { StockClient } from "./StockClient";

export const dynamic = "force-dynamic";

const DEMO_MOVEMENTS = [
  { id: "m1", product_id: "2", change: 20, reason: "Restock / Supplier Delivery", created_at: new Date(Date.now() - 3600000 * 2).toISOString(), products: { name: "Basmati Rice 5kg" } },
  { id: "m2", product_id: "3", change: -2, reason: "Damaged / Expired Stock", created_at: new Date(Date.now() - 3600000 * 5).toISOString(), products: { name: "Sunflower Oil 1L" } },
  { id: "m3", product_id: "1", change: 50, reason: "Restock", created_at: new Date(Date.now() - 3600000 * 24).toISOString(), products: { name: "Coca-Cola 500ml" } },
];

const DEMO_LOW_STOCK = [
  { product_id: "6", name: "Wheat Flour 2kg", stock_on_hand: 0, reorder_point: 10 },
  { product_id: "5", name: "Whole Milk 1L", stock_on_hand: 2, reorder_point: 8 },
  { product_id: "3", name: "Sunflower Oil 1L", stock_on_hand: 4, reorder_point: 5 },
  { product_id: "2", name: "Basmati Rice 5kg", stock_on_hand: 8, reorder_point: 15 },
];

const DEMO_PRODUCTS = [
  { id: "1", name: "Coca-Cola 500ml", stock_on_hand: 45 },
  { id: "2", name: "Basmati Rice 5kg", stock_on_hand: 8 },
  { id: "3", name: "Sunflower Oil 1L", stock_on_hand: 4 },
  { id: "4", name: "White Sugar 1kg", stock_on_hand: 30 },
  { id: "5", name: "Whole Milk 1L", stock_on_hand: 2 },
  { id: "6", name: "Wheat Flour 2kg", stock_on_hand: 0 },
];

export default async function StockPage() {
  let movements = DEMO_MOVEMENTS;
  let lowStock = DEMO_LOW_STOCK;
  let products = DEMO_PRODUCTS;
  let shopName = "Demo Retail Shop";

  try {
    const supabase = await createClient();
    const { data: tenant } = await supabase.from("tenants").select("name").single();
    if (tenant?.name) shopName = tenant.name;

    const [{ data: dbMovements }, { data: dbLowStock }, { data: dbProducts }] = await Promise.all([
      supabase
        .from("stock_movements")
        .select("id, product_id, change, reason, created_at, products(name)")
        .order("created_at", { ascending: false })
        .limit(50),

      supabase
        .from("v_low_stock")
        .select("product_id, name, stock_on_hand, reorder_point")
        .order("stock_on_hand", { ascending: true }),

      supabase.from("products").select("id, name, stock_on_hand").order("name", { ascending: true }),
    ]);

    if (dbMovements && dbMovements.length > 0) movements = dbMovements;
    if (dbLowStock) lowStock = dbLowStock;
    if (dbProducts && dbProducts.length > 0) products = dbProducts;
  } catch {
    // Demo fallback for local development preview
  }

  return (
    <Shell shopName={shopName}>
      <StockClient
        initialMovements={movements}
        lowStock={lowStock}
        products={products}
      />
    </Shell>
  );
}
