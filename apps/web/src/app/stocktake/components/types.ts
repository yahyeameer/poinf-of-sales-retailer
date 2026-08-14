/** Shapes shared by the stocktake screen and its sections. */

export interface CountLine {
  product_id: string;
  product_name: string;
  barcode: string | null;
  on_hand: number;
  cost_cents: number;
}

export interface StocktakeDoc {
  reference_id: string;
  counted_at: string;
  location_name: string;
  lines_adjusted: number;
  units_missing: number | null;
  units_surplus: number | null;
}

/** What the count adds up to before anyone commits it. */
export interface CountSummary {
  /** Units the shelf is short of what the ledger claims. */
  missing: number;
  /** Units found beyond what the ledger claims. */
  surplus: number;
  /** Net value of the correction, at cost. Negative means the shop lost money. */
  valueCents: number;
  /** Lines whose count differs from the ledger, so would write a correction. */
  changed: number;
}

export type Notice = { ok: boolean; message: string } | null;
