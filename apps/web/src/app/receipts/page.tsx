import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { getShopBranding } from "@/lib/shop";
import { getTenantContext } from "@/lib/tenant";
import { ReceiptsClient } from "./ReceiptsClient";
import type { ReceiptShop } from "@/components/Receipt";

/** Sensible defaults for the signed-out preview, where there is no shop row. */
const DEMO_SHOP: ReceiptShop = {
  name: "Demo Retail Shop",
  logoUrl: null,
  phone: null,
  address: null,
  taxNumber: null,
  receiptHeader: null,
  receiptFooter: null,
  receiptShowLogo: false,
  receiptShowTaxLine: true,
  receiptPaperMm: 80,
};

export const dynamic = "force-dynamic";

const DEMO_RECEIPTS = [
  {
    saleId: "demo-1",
    id: "RCPT1001",
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    payment_method: "cash",
    total_cents: 1450,
    voided: false,
    isRefund: false,
    refundedUnits: 0,
    items: [
      { saleItemId: "demo-i1", name: "Basmati Rice 5kg", qty: 1, price_cents: 1250 },
      { saleItemId: "demo-i2", name: "Whole Milk 1L", qty: 1, price_cents: 200 },
    ],
  },
];

interface SaleItemRow {
  id: string;
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
  kind: string;
  original_sale_id: string | null;
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
          shop={DEMO_SHOP}
          canRefund={false}
          demoReason="You're not signed in, so this is a sample receipt."
        />
      </Shell>
    );
  }

  const supabase = await createClient();
  const branding = await getShopBranding(ctx.tenantId);

  // This page previously fetched only the shop name and rendered three
  // hardcoded receipts, so a shop with hundreds of real sales still saw
  // rcpt-1001. Pull the actual sales and their lines.
  const { data: sales, error } = await supabase
    .from("sales")
    .select(
      "id, created_at, payment_method, total_cents, status, kind, original_sale_id, " +
        "sale_items(id, name_at_sale, quantity, unit_price_cents)",
    )
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    console.error("[receipts] sales query failed:", error);
  }

  // How much of each line has already gone back, so the refund dialog can cap
  // what it offers rather than relying on the RPC to reject an impossible ask.
  const { data: priorRefunds } = await supabase
    .from("sales")
    .select("original_sale_id, sale_items(product_id, quantity)")
    .eq("kind", "refund")
    .eq("status", "completed");

  const refundedByOriginal = new Map<string, number>();
  for (const r of priorRefunds ?? []) {
    const key = (r as { original_sale_id: string | null }).original_sale_id;
    if (!key) continue;
    const qty = ((r as { sale_items: { quantity: number }[] | null }).sale_items ?? []).reduce(
      (sum, i) => sum + Math.abs(Number(i.quantity)),
      0,
    );
    refundedByOriginal.set(key, (refundedByOriginal.get(key) ?? 0) + qty);
  }

  // Cast through unknown: the select string is built by concatenation, so the
  // client's literal-type inference can't see the shape and falls back to an
  // error type. SaleRow above is the contract instead.
  const receipts = ((sales ?? []) as unknown as SaleRow[]).map((sale) => ({
    saleId: sale.id,
    // Short, readable on a thermal receipt, and still unique enough to search.
    id: sale.id.slice(0, 8).toUpperCase(),
    created_at: sale.created_at,
    payment_method: sale.payment_method,
    total_cents: sale.total_cents,
    voided: sale.status === "voided",
    isRefund: sale.kind === "refund",
    refundedUnits: refundedByOriginal.get(sale.id) ?? 0,
    items: (sale.sale_items ?? []).map((item) => ({
      saleItemId: item.id,
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
        shop={branding ? { ...branding } : DEMO_SHOP}
        canRefund={ctx.role === "owner" || ctx.role === "manager"}
        demoReason={error ? `Couldn't load your sales: ${error.message}` : null}
      />
    </Shell>
  );
}
