/**
 * Money is integer minor units (cents) everywhere in this codebase. No float
 * ever holds a price. If you find yourself writing `* 100` outside this file,
 * something has gone wrong.
 */

/** Currencies whose minor unit isn't 1/100. Enough of them to matter here. */
const MINOR_UNIT_EXPONENT: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  UGX: 0,
  RWF: 0,
  DJF: 0,
  KMF: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENT[currency.toUpperCase()] ?? 2;
}

/**
 * Formats for display. Falls back to a plain decimal if the runtime's ICU data
 * doesn't know the currency — some Android builds ship a trimmed ICU, and a
 * thrown RangeError in the middle of a checkout is not an acceptable trade.
 */
export function formatMoney(
  cents: number,
  currency: string,
  locale?: string,
): string {
  const exponent = minorUnitExponent(currency);
  const amount = cents / 10 ** exponent;

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(exponent)}`;
  }
}

/** Parses owner input ("1,500", "$12.50", "12·50") into cents. Null if unparseable. */
export function parseMoneyToCents(input: string, currency: string): number | null {
  const exponent = minorUnitExponent(currency);

  const cleaned = input
    .replace(/[^\d.,\-]/g, "")
    .replace(/,(?=\d{3}\b)/g, "") // thousands separator
    .replace(",", "."); // decimal comma

  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  return Math.round(value * 10 ** exponent);
}

/**
 * Rounds half away from zero, matching Postgres `round()`.
 *
 * JavaScript's Math.round breaks ties toward +Infinity, so it disagrees with
 * the database on exactly the negative halves — and the client's total has to
 * match what process_sale() computes, or the cart shows one number and the
 * receipt another.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
