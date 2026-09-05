"use client";

import { useState } from "react";
import { formatMoney } from "@ai-pos/shared";

import { LocalTime } from "@/components/LocalTime";
import { barPath, compactMoney, niceCeil } from "./svg";

export interface ProfitPoint {
  day: string; // ISO date
  gross_margin_cents: number;
  expenses_cents: number;
  net_profit_cents: number;
}

const W = 700;
const H = 260;
const PAD = { top: 20, right: 14, bottom: 28, left: 56 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/**
 * What was left, day by day.
 *
 * The measure has polarity — a day is above water or under it — so this is a
 * diverging encoding: two hues either side of a real zero line, not a ramp and
 * not a rainbow. The colours are the same --chart-margin / --chart-cost pair
 * MarginTrend uses, kept rather than invented because they already pass the
 * palette checks in both light and dark (lightness band, chroma floor, CVD
 * separation, contrast against each surface).
 *
 * Sign is carried twice: by which side of the baseline a bar sits on, and by
 * its colour. That redundancy is the point — a reader who cannot separate the
 * two hues still reads every bar correctly from its position, which is what
 * makes the pair safe to use at all.
 *
 * One axis. Margin and expenses are different measures and would need two
 * scales to share this space, so they are in the tooltip rather than plotted
 * against a second axis that would imply a relationship the numbers do not
 * have.
 */
export function ProfitTrend({
  data,
  currency,
}: {
  data: ProfitPoint[];
  currency: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const values = data.map((d) => d.net_profit_cents);
  const maxPos = Math.max(0, ...values);
  const maxNeg = Math.min(0, ...values);

  // The scale is symmetric only when it needs to be. A month with no losses
  // should not waste half the panel on empty space below the line.
  const top = niceCeil(maxPos) || 0;
  const bottom = -(niceCeil(Math.abs(maxNeg)) || 0);
  const span = top - bottom || 1;

  const y = (cents: number) => PAD.top + ((top - cents) / span) * PLOT_H;
  const zeroY = y(0);
  const band = PLOT_W / Math.max(data.length, 1);
  const barW = Math.min(26, band * 0.62);

  if (data.length === 0) {
    return (
      <div className="grid h-[220px] place-items-center px-6 text-center text-sm text-muted-foreground">
        Nothing to show yet. Record a sale or an expense and this fills in.
      </div>
    );
  }

  const point = hover === null ? null : data[hover];

  // Roughly eight ticks, and a date rather than a weekday once weekdays start
  // repeating and stop identifying anything.
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const useWeekday = data.length <= 8;
  const tickLabel = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      ...(useWeekday ? { weekday: "short" } : { day: "numeric", month: "short" }),
    });

  const gridValues = [top, top / 2, 0, bottom / 2, bottom].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 px-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: "var(--chart-margin)" }}
            aria-hidden
          />
          <span className="text-muted-foreground">Kept</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: "var(--chart-cost)" }}
            aria-hidden
          />
          <span className="text-muted-foreground">Lost</span>
        </span>
      </div>

      {/* Readable width on a phone, scrolled rather than shrunk. */}
      <div className="overflow-x-auto">
        <div className="relative min-w-[600px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label={`Net profit per day over ${data.length} days`}
            onMouseLeave={() => setHover(null)}
          >
            {gridValues.map((v) => {
              const gy = y(v);
              const isZero = v === 0;
              return (
                <g key={v}>
                  <line
                    x1={PAD.left}
                    x2={W - PAD.right}
                    y1={gy}
                    y2={gy}
                    className={isZero ? "stroke-[var(--muted-foreground)]" : "stroke-[var(--border)]"}
                    strokeWidth={1}
                    // The zero line is the one a reader measures against, so it
                    // is the only rule that is not recessive.
                    opacity={isZero ? 0.5 : 1}
                  />
                  <text
                    x={PAD.left - 8}
                    y={gy}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-[var(--muted-foreground)]"
                    fontSize={11}
                  >
                    {compactMoney(v, currency)}
                  </text>
                </g>
              );
            })}

            {data.map((d, i) => {
              const cx = PAD.left + band * i + band / 2;
              const bx = cx - barW / 2;
              const v = d.net_profit_cents;
              const vy = y(v);
              const h = Math.abs(vy - zeroY);
              const up = v >= 0;

              const active = hover === i;
              const dim = hover !== null && !active ? 0.45 : 1;

              return (
                <g key={d.day}>
                  {h > 0.5 && (
                    <path
                      // Rounded end away from the baseline, square against it.
                      d={barPath(bx, up ? vy : zeroY, barW, h, 4, up ? "up" : "down")}
                      fill={up ? "var(--chart-margin)" : "var(--chart-cost)"}
                      opacity={dim}
                    />
                  )}

                  {i % labelEvery === 0 && (
                    <text
                      x={cx}
                      y={H - 8}
                      textAnchor="middle"
                      className="fill-[var(--muted-foreground)]"
                      fontSize={11}
                    >
                      {tickLabel(d.day)}
                    </text>
                  )}

                  {/* Full-height hit target: a thin bar is hard to hover, and a
                      day with almost no profit has almost no bar to aim at. */}
                  <rect
                    x={PAD.left + band * i}
                    y={PAD.top}
                    width={band}
                    height={PLOT_H}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                  />
                </g>
              );
            })}
          </svg>

          {point && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg"
              style={{
                left: `${((PAD.left + band * (hover ?? 0) + band / 2) / W) * 100}%`,
                top: `${(Math.min(y(point.net_profit_cents), zeroY) / H) * 100}%`,
              }}
            >
              <div className="font-semibold text-foreground">
                <LocalTime value={point.day} format="date" />
              </div>
              <div className="mt-1 space-y-0.5">
                <Row label="Kept on goods" value={formatMoney(point.gross_margin_cents, currency)} />
                <Row label="Spent" value={`− ${formatMoney(point.expenses_cents, currency)}`} />
                <div className="mt-1 flex justify-between gap-4 border-t border-border pt-1">
                  <span className="text-muted-foreground">Left over</span>
                  <span
                    className="font-semibold"
                    style={{
                      color:
                        point.net_profit_cents < 0
                          ? "var(--chart-cost)"
                          : "var(--chart-margin)",
                    }}
                  >
                    {formatMoney(point.net_profit_cents, currency)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      {/* Text stays in ink tokens; the colour beside it carries identity. */}
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
