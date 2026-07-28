/**
 * Cart totals.
 *
 * These must agree with process_sale() in
 * packages/db/supabase/migrations/20260728000600_rpc.sql, line for line. The
 * cart shows the customer a number before the sale is posted; if the server
 * computes a different one the receipt contradicts the till, and the cashier
 * gets to explain it. Change one, change the other, and update
 * packages/shared/src/cart.test.ts.
 */
import { roundHalfAwayFromZero } from "./money.ts";
import type { PaymentMethod, ProductUnit } from "./types.ts";

export interface CartLine {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  unit: ProductUnit;
  /** Present only when the line came from vision rather than a barcode. */
  matchConfidence?: number;
}

export interface CartTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export interface TaxConfig {
  /** A rate, not a percentage: 0.15 is 15%. */
  rate: number;
  /** True when the shelf price already contains the tax. */
  inclusive: boolean;
}

export function lineTotalCents(line: CartLine): number {
  return roundHalfAwayFromZero(line.quantity * line.unitPriceCents);
}

export function computeTotals(
  lines: readonly CartLine[],
  tax: TaxConfig,
  requestedDiscountCents = 0,
): CartTotals {
  const subtotalCents = lines.reduce((sum, line) => sum + lineTotalCents(line), 0);

  // Clamped the same way the RPC clamps it, so a stale discount can't produce
  // a negative total on one side and a rejection on the other.
  const discountCents = Math.min(Math.max(requestedDiscountCents, 0), subtotalCents);
  const taxable = subtotalCents - discountCents;

  if (tax.inclusive) {
    // Back the tax out of the price rather than adding it on top.
    return {
      subtotalCents,
      discountCents,
      taxCents: roundHalfAwayFromZero((taxable * tax.rate) / (1 + tax.rate)),
      totalCents: taxable,
    };
  }

  const taxCents = roundHalfAwayFromZero(taxable * tax.rate);
  return { subtotalCents, discountCents, taxCents, totalCents: taxable + taxCents };
}

/**
 * Adds a scan to the cart. Scanning the same barcode twice bumps the quantity
 * instead of adding a second line — staff scan repeats constantly and a cart of
 * fourteen identical rows is unreadable on a phone.
 *
 * Weighed goods are the exception: two bags of rice are two weighings, and
 * silently merging them would lose the second one's weight.
 */
export function addScan(lines: readonly CartLine[], incoming: CartLine): CartLine[] {
  const mergeable = incoming.unit === "each" || incoming.unit === "pack";
  const existing = mergeable
    ? lines.findIndex(
        (l) => l.productId === incoming.productId && l.unitPriceCents === incoming.unitPriceCents,
      )
    : -1;

  if (existing === -1) return [...lines, incoming];

  return lines.map((line, i) =>
    i === existing ? { ...line, quantity: line.quantity + incoming.quantity } : line,
  );
}

export function setQuantity(
  lines: readonly CartLine[],
  productId: string,
  quantity: number,
): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.productId !== productId);
  return lines.map((l) => (l.productId === productId ? { ...l, quantity } : l));
}

/** The payload shape process_sale() expects. */
export function toSalePayload(
  lines: readonly CartLine[],
  clientId: string,
  paymentMethod: PaymentMethod,
  discountCents = 0,
  createdAt = new Date(),
) {
  return {
    client_id: clientId,
    payment_method: paymentMethod,
    discount_cents: discountCents,
    created_at: createdAt.toISOString(),
    items: lines.map((l) => ({
      product_id: l.productId,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
    })),
  };
}
