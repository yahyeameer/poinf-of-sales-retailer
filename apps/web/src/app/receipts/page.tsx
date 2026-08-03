import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { ReceiptsClient } from "./ReceiptsClient";

export const dynamic = "force-dynamic";

const DEMO_RECEIPTS = [
  {
    id: "rcpt-1001",
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    payment_method: "cash",
    total_cents: 1450,
    items: [
      { name: "Basmati Rice 5kg", qty: 1, price_cents: 1250 },
      { name: "Whole Milk 1L", qty: 1, price_cents: 200 },
    ],
  },
  {
    id: "rcpt-1002",
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    payment_method: "mobile_money",
    total_cents: 380,
    items: [{ name: "Sunflower Oil 1L", qty: 1, price_cents: 380 }],
  },
  {
    id: "rcpt-1003",
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    payment_method: "cash",
    total_cents: 300,
    items: [{ name: "Coca-Cola 500ml", qty: 2, price_cents: 150 }],
  },
];

export default async function ReceiptsPage() {
  let receipts = DEMO_RECEIPTS;
  let shopName = "Demo Retail Shop";
  let currency = "USD";

  try {
    const supabase = await createClient();
    const { data: tenant } = await supabase.from("tenants").select("name, currency").single();
    if (tenant) {
      shopName = tenant.name ?? shopName;
      currency = tenant.currency ?? currency;
    }
  } catch {
    // Demo fallback for local preview
  }

  return (
    <Shell shopName={shopName}>
      <ReceiptsClient initialReceipts={receipts} currency={currency} shopName={shopName} />
    </Shell>
  );
}
