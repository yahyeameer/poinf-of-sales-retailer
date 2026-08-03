import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { BarcodeClient } from "./BarcodeClient";

export const dynamic = "force-dynamic";

const DEMO_PRODUCTS = [
  { id: "1", name: "Coca-Cola 500ml", barcode: "5449000000996", price_cents: 150 },
  { id: "2", name: "Basmati Rice 5kg", barcode: "8901058000123", price_cents: 1250 },
  { id: "3", name: "Sunflower Oil 1L", barcode: "6001234567890", price_cents: 380 },
  { id: "4", name: "White Sugar 1kg", barcode: "6009876543210", price_cents: 210 },
  { id: "5", name: "Whole Milk 1L", barcode: "6001112223334", price_cents: 180 },
];

export default async function BarcodeStudioPage() {
  let products = DEMO_PRODUCTS;
  let shopName = "Demo Retail Shop";
  let currency = "USD";

  try {
    const supabase = await createClient();
    const { data: tenant } = await supabase.from("tenants").select("name, currency").single();
    if (tenant) {
      shopName = tenant.name ?? shopName;
      currency = tenant.currency ?? currency;
    }

    const { data: dbProducts } = await supabase
      .from("products")
      .select("id, name, barcode, price_cents")
      .order("name", { ascending: true })
      .limit(100);

    if (dbProducts && dbProducts.length > 0) {
      products = dbProducts as any;
    }
  } catch {
    // Demo fallback for local preview
  }

  return (
    <Shell shopName={shopName}>
      <BarcodeClient initialProducts={products} currency={currency} />
    </Shell>
  );
}
