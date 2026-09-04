/**
 * Shared geometry for the hand-rolled SVG charts.
 *
 * No charting dependency on purpose: the three dashboard charts are small, and
 * adding a library to this monorepo has a history of React-version duplication
 * pain. These helpers keep the marks honest — clean tick numbers and a bar path
 * that is rounded at the data end and square on the baseline, per the design
 * system's mark specs.
 */

import { minorUnitExponent } from "@ai-pos/shared";

/**
 * Money for an axis tick or a compact label: "$1.2K", "$800", not
 * "$1,234.00" — a full amount does not fit under a column. Pinned en-US and
 * wrapped in try/catch for the same trimmed-ICU reason formatMoney is.
 *
 * minimumFractionDigits: 0 is doing real work. With only a maximum set, Node's
 * ICU pads compact notation back out to one decimal — every axis tick rendered
 * "$0.0", "$125.0", "$500.0" — while the browser's ICU dropped it. So the axis
 * was wrong in the server HTML, right after hydration, and different enough
 * between the two that React discarded the tree. Setting the minimum makes
 * both runtimes agree on the shorter form, which is the one this was always
 * meant to produce.
 */
export function compactMoney(cents: number, currency: string): string {
  const amount = cents / 10 ** minorUnitExponent(currency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

/** Rounds a maximum up to a clean value so axis ticks read 0 / 5k / 10k, not 0 / 4,873. */
export function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Evenly spaced tick values from 0 to a nice ceiling, inclusive. */
export function ticks(max: number, count = 4): number[] {
  const top = niceCeil(max);
  if (top === 0) return [0];
  return Array.from({ length: count + 1 }, (_, i) => Math.round((top / count) * i));
}

/**
 * A bar/column rounded only at the data end and left square on the baseline —
 * SVG `rect` can't round two corners alone, so this is a path. `r` is clamped so
 * a short bar never turns into a lozenge. `dir` is which way the bar grows: a
 * column grows "up", a horizontal bar grows "right".
 */
export function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  dir: "up" | "right" = "up",
): string {
  if (w <= 0 || h <= 0) return "";
  if (dir === "up") {
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
  }
  // grows right: square on the left (baseline), rounded on the right end
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
}
