/** Shapes shared by the transfers screen and its sections. */

export interface StockAtLocation {
  location_id: string;
  product_id: string;
  product_name: string;
  on_hand: number;
}

export interface TransferDoc {
  reference_id: string;
  moved_at: string;
  from_location: string | null;
  to_location: string | null;
  lines: number;
  units: number;
  net_delta: number;
}

/**
 * One row of the draft. `key` is a client-side identity, not the product —
 * two blank rows have to stay distinguishable while someone fills them in.
 */
export interface Draft {
  key: number;
  productId: string;
  quantity: string;
}

export type Notice = { ok: boolean; message: string } | null;
