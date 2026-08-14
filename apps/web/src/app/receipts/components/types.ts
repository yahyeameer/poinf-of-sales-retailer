/**
 * Shapes shared by the receipts screen and its dialogs.
 *
 * `Receipt` here is a row of sale history, not the printed document — that is
 * `@/components/Receipt`, and the two get aliased apart wherever both appear.
 */

export interface ReceiptItem {
  saleItemId: string;
  name: string;
  qty: number;
  price_cents: number;
}

export interface Receipt {
  saleId: string;
  id: string;
  created_at: string;
  payment_method: string;
  total_cents: number;
  items: ReceiptItem[];
  voided?: boolean;
  isRefund?: boolean;
  refundedUnits?: number;
}

/** One line of a refund: how many of a given sale item are coming back. */
export interface RefundLine {
  saleItemId: string;
  quantity: number;
}

export type Notice = { ok: boolean; message: string } | null;

/**
 * Both dialogs on this screen act on a specific receipt, so open state carries
 * the row with it rather than being a boolean plus a separately-set payload —
 * that pairing is how a dialog ends up open against a stale row.
 */
export type ReceiptsDialog =
  | { name: "view"; receipt: Receipt }
  | { name: "refund"; receipt: Receipt }
  | null;
