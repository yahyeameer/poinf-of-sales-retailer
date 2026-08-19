import { formatMoney } from "@ai-pos/shared";

/**
 * How the week's takings split across tender types — a part-to-whole, shown as
 * one segmented bar rather than a pie. Three categorical colours from the
 * validated palette (blue / orange / aqua), distinct under colour-blindness;
 * the percentage rides the legend, which also covers the light-mode contrast
 * relief the aqua slot needs. Text stays in ink tokens — identity comes from
 * the swatch beside it, never from colouring the number.
 */
const METHODS = [
  { key: "cash", label: "Cash", bar: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  { key: "mobile", label: "Mobile money", bar: "bg-[#eb6834] dark:bg-[#d95926]" },
  { key: "card", label: "Card", bar: "bg-[#1baf7a] dark:bg-[#199e70]" },
] as const;

export function PaymentMix({
  cash,
  mobile,
  card,
  currency,
}: {
  cash: number;
  mobile: number;
  card: number;
  currency: string;
}) {
  const totals = { cash, mobile, card };
  const total = cash + mobile + card;

  if (total === 0) {
    return (
      <div className="grid h-[220px] place-items-center px-6 text-center text-sm text-muted-foreground">
        No takings yet this week. The cash / mobile / card split appears here once
        the till rings something up.
      </div>
    );
  }

  const pct = (v: number) => Math.round((v / total) * 100);

  return (
    <div className="space-y-4">
      {/* The bar. gap-0.5 (2px) is the surface gap that separates the segments. */}
      <div
        className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label="Share of revenue by payment method"
      >
        {METHODS.map((m) => {
          const value = totals[m.key];
          if (value === 0) return null;
          return (
            <div
              key={m.key}
              className={m.bar}
              style={{ flexGrow: value, flexBasis: 0 }}
              title={`${m.label}: ${formatMoney(value, currency)} (${pct(value)}%)`}
            />
          );
        })}
      </div>

      <ul className="space-y-2.5">
        {METHODS.map((m) => (
          <li key={m.key} className="flex items-center gap-2.5 text-sm">
            <span className={`size-2.5 shrink-0 rounded-sm ${m.bar}`} aria-hidden />
            <span className="text-muted-foreground">{m.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-foreground">
              {pct(totals[m.key])}%
            </span>
            <span className="w-24 text-right tabular-nums text-muted-foreground">
              {formatMoney(totals[m.key], currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
