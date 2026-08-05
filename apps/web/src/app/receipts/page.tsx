import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
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
];

interface SaleItemRow {
  name_at_sale: string;
  quantity: number;
  unit_price_cents: number;
}

interface SaleRow {
  id: string;
  created_at: string;
  payment_method: string;
  total_cents: number;
  status: string;
  sale_items: SaleItemRow[] | null;
}

export default async function ReceiptsPage() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return (
      <Shell shopName="Demo Retail Shop">
        <ReceiptsClient
          initialReceipts={DEMO_RECEIPTS}
          currency="USD"
          shopName="Demo Retail Shop"
          demoReason="You're not signed in, so this is a sample receipt."
        />
      </Shell>
    );
  }

  const supabase = await createClient();

  // This page previously fetched only the shop name and rendered three
  // hardcoded receipts, so a shop with hundreds of real sales still saw
  // rcpt-1001. Pull the actual sales and their lines.
  const { data: sales, error } = await supabase
    .from("sales")
    .select(
      "id, created_at, payment_method, total_cents, status, sale_items(name_at_sale, quantity, unit_price_cents)",
    )
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    console.error("[receipts] sales query failed:", error);
  }

  const receipts = ((sales ?? []) as SaleRow[]).map((sale) => ({
    // Short, readable on a thermal receipt, and still unique enough to search.
    id: sale.id.slice(0, 8).toUpperCase(),
    created_at: sale.created_at,
    payment_method: sale.payment_method,
    total_cents: sale.total_cents,
    voided: sale.status === "voided",
    items: (sale.sale_items ?? []).map((item) => ({
      name: item.name_at_sale,
      qty: Number(item.quantity),
      price_cents: item.unit_price_cents,
    })),
  }));

  return (
    <Shell shopName={ctx.shopName}>
      <ReceiptsClient
        initialReceipts={error ? DEMO_RECEIPTS : receipts}
        currency={ctx.currency}
        shopName={ctx.shopName}
        demoReason={error ? `Couldn't load your sales: ${error.message}` : null}
      />
    </Shell>
  );
}
