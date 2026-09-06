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
  // The Horn-of-Africa shillings have subunits on paper and none in practice.
  // CLDR already treats SOS as zero-decimal — `Intl` renders SOS 12,346 for
  // 12345.67 — so leaving it at the default 2 put this file and the runtime's
  // own formatter in disagreement about the same currency. Somali and
  // Somaliland notes start at 50 and 500 respectively; there is no coin worth
  // printing a decimal for.
  SOS: 0,
  SLS: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

/**
 * The Somaliland shilling has no ISO 4217 code.
 *
 * Somaliland is not a UN member, so ISO has never assigned one, and `SLSH` —
 * the code people actually write on a price list — is four letters. That is
 * not a cosmetic problem: `Intl.NumberFormat` throws
 * `RangeError: Invalid currency code` on anything that is not exactly three
 * letters, so storing "SLSH" would take down every screen that formats money
 * the moment a shop selected it. `tenants.currency` is `char(3)` as well.
 *
 * So the stored code is `SLS`, the unofficial three-letter code in common use,
 * and it is displayed as `SLSH` because that is what a cashier in Hargeisa
 * expects to read. Store the ISO-shaped code; show the local one.
 */
const DISPLAY_CODE: Record<string, string> = {
  SLS: "SLSH",
};

export interface CurrencyDef {
  /** Stored in `tenants.currency`. Always three letters. */
  code: string;
  /** What a cashier reads. Differs from `code` only for the Somaliland shilling. */
  display: string;
  label: string;
}

/**
 * What the settings picker offers.
 *
 * Currency used to be a free-text box validated only as three letters, which
 * accepted `SLS` and `SLSH` alike and gave no hint that one of them breaks the
 * app. A list of the currencies this product actually sells into is both a
 * better prompt and a narrower target.
 */
export const SUPPORTED_CURRENCIES: readonly CurrencyDef[] = [
  { code: "SLS", display: "SLSH", label: "Somaliland Shilling" },
  { code: "SOS", display: "SOS", label: "Somali Shilling" },
  { code: "KES", display: "KSh", label: "Kenyan Shilling" },
  { code: "ETB", display: "ETB", label: "Ethiopian Birr" },
  { code: "DJF", display: "DJF", label: "Djiboutian Franc" },
  { code: "USD", display: "$", label: "US Dollar" },
];

export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.some((c) => c.code === code.toUpperCase());
}

/**
 * The short label a cashier reads: "$", "KSh", "SLSH", "SOS".
 *
 * Exists so no caller has to dig a symbol back out of formatted output with a
 * regex, which is both unreadable and locale-dependent.
 */
export function currencyDisplay(code: string): string {
  const upper = code.toUpperCase();
  return (
    SUPPORTED_CURRENCIES.find((c) => c.code === upper)?.display ??
    DISPLAY_CODE[upper] ??
    upper
  );
}

/** "SLSH — Somaliland Shilling". For pickers and settings summaries. */
export function currencyLabel(code: string): string {
  const def = SUPPORTED_CURRENCIES.find((c) => c.code === code.toUpperCase());
  return def ? `${def.display} \u2014 ${def.label}` : code.toUpperCase();
}

/**
 * Converts between two currencies at a given rate.
 *
 * `rate` is major units of `to` per one major unit of `from` — the number an
 * owner reads off a bureau board ("1 USD = 8,500 SLSH"), not a minor-unit
 * ratio. The two currencies can have different exponents, which is exactly the
 * case this exists for: USD is 1/100 and SLSH is whole shillings, so a naive
 * `cents * rate` is wrong by a factor of a hundred.
 *
 * Rounds half away from zero to agree with Postgres, for the same reason
 * roundHalfAwayFromZero exists at all.
 */
export function convertMinor(
  amountMinor: number,
  from: string,
  to: string,
  rate: number,
): number {
  if (from.toUpperCase() === to.toUpperCase()) return amountMinor;
  const major = amountMinor / 10 ** minorUnitExponent(from);
  return roundHalfAwayFromZero(major * rate * 10 ** minorUnitExponent(to));
}

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
  locale: string = "en-US",
): string {
  const exponent = minorUnitExponent(currency);
  const amount = cents / 10 ** exponent;
  const override = DISPLAY_CODE[currency.toUpperCase()];

  // A currency we relabel is formatted as a plain number and prefixed by hand.
  // Passing the local code to Intl is not an option — `SLSH` is four letters
  // and throws — and passing the stored code would print "SLS", which is not
  // what the shop calls its own money.
  if (override) {
    try {
      const n = new Intl.NumberFormat(locale, {
        minimumFractionDigits: exponent,
        maximumFractionDigits: exponent,
      }).format(amount);
      return `${override} ${n}`;
    } catch {
      return `${override} ${amount.toFixed(exponent)}`;
    }
  }

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
 * Cents to the plain string a text input should hold.
 *
 * The counterpart to parseMoneyToCents, and the half that was missing. Without
 * it every prefilled amount in the app wrote `(cents / 100).toFixed(2)` by
 * hand, which is right for dollars and shillings and wrong by a factor of a
 * hundred for the zero-decimal currencies this product actually sells into —
 * UGX and RWF among them. No grouping separators and no symbol: this is for
 * an <input>, not for display, and a thousands separator here would come
 * straight back through parseMoneyToCents as a decimal point in some locales.
 */
export function centsToInput(cents: number, currency: string): string {
  const exponent = minorUnitExponent(currency);
  return (cents / 10 ** exponent).toFixed(exponent);
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
