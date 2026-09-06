import type { CartLine } from "@ai-pos/shared";

export interface TillProduct {
  id: string;
  name: string;
  barcode: string | null;
  price_cents: number;
  stock_on_hand: number;
  unit: CartLine["unit"];
}

export interface ParkedSale {
  id: string;
  label: string;
  cart: CartLine[];
  created_at: string;
}

export interface OpenShift {
  id: string;
  opened_at: string;
  opening_float_cents: number;
}

export type Method = "cash" | "mobile_money" | "card";

export const METHOD_LABEL: Record<Method, string> = {
  cash: "Cash",
  mobile_money: "Mobile money",
  card: "Card",
};

/** Amounts are strings while being typed — parsing on every keystroke fights
 *  the cashier over a half-entered "12." */
export interface Tender {
  method: Method;
  amount: string;
  tendered: string;
  /**
   * The customer is settling this leg in the counter currency.
   *
   * `amount` stays in the shop's currency even then — it is what the sale is
   * worth, and letting it drift would break the rule that tenders must equal
   * the total exactly. What changes is that `tendered` is read as counter
   * currency and change is given in it.
   */
  inSecondary?: boolean;
}

/** What the shop takes at the counter besides its own money. */
export interface CounterCurrency {
  code: string;
  rate: number;
}

export interface SaleReceipt {
  saleId: string;
  totalCents: number;
  changeCents: number;
  lines: CartLine[];
}

export type Notice = { ok: boolean; message: string } | null;

export type CashKind = "pay_in" | "pay_out" | "drop";
