/**
 * Domain types, hand-written to mirror the schema.
 *
 * `npm run db:types` regenerates database.types.ts from a live database; these
 * are the friendlier surface the apps actually use. When the two disagree, the
 * generated file is right and this one is stale.
 */

export type ShopRole = "owner" | "manager" | "cashier";
export type PlanTier = "free" | "starter" | "pro" | "self_hosted";
export type ProductUnit = "each" | "kg" | "g" | "l" | "ml" | "pack";
export type PaymentMethod = "cash" | "mobile_money" | "card" | "mixed";
export type SaleStatus = "completed" | "voided";
export type MovementReason = "sale" | "restock" | "adjustment" | "void" | "stocktake";

export interface Tenant {
  id: string;
  name: string;
  currency: string;
  taxRate: number;
  taxInclusive: boolean;
  plan: PlanTier;
  minMarginPct: number;
  allowOversell: boolean;
}

export interface ShopUser {
  id: string;
  tenantId: string | null;
  email: string | null;
  name: string | null;
  role: ShopRole;
  isActive: boolean;
}

export interface Product {
  id: string;
  tenantId: string;
  categoryId: string | null;
  sku: string | null;
  name: string;
  barcode: string | null;
  priceCents: number;
  costCents: number;
  unit: ProductUnit;
  stockOnHand: number;
  reorderPoint: number;
  isActive: boolean;
}

export interface Sale {
  id: string;
  tenantId: string;
  cashierId: string | null;
  clientId: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  taxInclusive: boolean;
  hasOversell: boolean;
  createdAt: string;
}

/** How a product got into the cart. Worth recording — it's the headline metric
 *  for whether the vision work is earning its keep. */
export type MatchSource = "barcode" | "vision" | "search" | "manual";

export interface RecognitionCandidate {
  productId: string;
  name: string;
  priceCents: number;
  similarity: number;
}

/**
 * Thresholds for the sale screen. Tuned against the >75% top-1 target in the
 * PRD; expect to revisit once real shops have uploaded real photos.
 */
export const VISION_THRESHOLDS = {
  /** Below this, don't even show the candidate. */
  show: 0.75,
  /** Above this, add to the cart without asking. */
  autoAdd: 0.9,
  /** Two candidates closer together than this are a tie worth escalating. */
  tieMargin: 0.05,
} as const;
