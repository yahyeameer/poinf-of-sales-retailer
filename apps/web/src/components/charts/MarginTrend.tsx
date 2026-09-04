"use client";

import { useState } from "react";
import { formatMoney } from "@ai-pos/shared";

import { LocalTime } from "@/components/LocalTime";
import { barPath, compactMoney, niceCeil, ticks } from "./svg";

export interface MarginPoint {
  day: string; // ISO date
  revenue_cents: number;
  margin_cents: number;
}

const W = 700;
const H = 260;
const PAD = { top: 22, right: 14, bottom: 28, left: 52 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const BASELINE = PAD.top + PLOT_H;

/** Segments are separated by a surface-coloured gap rather than a stroke, so
 *  the boundary reads at any zoom without adding a second colour. */
const SEGMENT_GAP = 2;

/**
 * Revenue split into what it cost and what was kept.
 *
 * Revenue on its own is the number that flatters. A shop can take more money
 * every week and be going backwards, and this schema has always known the
 * difference — sale_items snapshot unit_cost_cents at the moment of sale, so
 * v_product_performance can report margin as it actually was rather than at
 * today's purchase price. Nothing had ever shown it.
 *
 * Stacked rather than two lines: cost and margin sum to revenue, so the column
 * height stays the takings figure people already recognise while the split
 * inside it answers the better question. Two series on one axis — never two
 * y-scales, which would let the shapes imply a relationship the numbers do not
 * have.
 */
export function MarginTrend({
  data,
  currency,
}: {
  data: MarginPoint[];
  currency: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(0, ...data.map((d) => d.revenue_cents));
  const top = niceCeil(max) || 1;
  const y = (cents: number) => BASELINE - (cents / top) * PLOT_H;
  const band = PLOT_W / Math.max(data.length, 1);
  const barW = Math.min(26, band * 0.62);

  if (data.length === 0 || max === 0) {
    return (
      <div className="grid h-[220px] place-items-center px-6 text-center text-sm text-muted-foreground">
        No completed sales in this period, so there is no margin to break down yet.
      </div>
    );
  }

  const point = hover === null ? null : data[hover];

  // Label density, not label-every-bar. At 30 days a weekday under every
  // column runs together into "ThuFriSatSunMon" — and a repeating weekday name
  // stops identifying anything once the series is longer than a week anyway.
  // Aim for roughly eight ticks and switch to a date once weekdays repeat.
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const useWeekday = data.length <= 8;
  const tickLabel = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      ...(useWeekday ? { weekday: "short" } : { day: "numeric", month: "short" }),
    });

  return (
    <div className="space-y-3">
      {/* Two series, so a legend is always present — identity is never carried
          by colour alone. */}
      <div className="flex flex-wrap items-center gap-4 px-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: "var(--chart-margin)" }}
            aria-hidden
          />
          <span className="text-muted-foreground">Kept (margin)</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: "var(--chart-cost)" }}
            aria-hidden
          />
          <span className="text-muted-foreground">Cost of goods</span>
        </span>
      </div>

      {/* Readable width on a phone, scrolled rather than shrunk — the same
          answer this codebase gives for wide tables. */}
      <div className="overflow-x-auto">
        <div className="relative min-w-[600px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label={`Daily revenue split into cost and margin over ${data.length} days`}
            onMouseLeave={() => setHover(null)}
          >
            {ticks(top, 4).map((t) => {
              const gy = y(t);
              return (
                <g key={t}>
                  <line
                    x1={PAD.left}
                    x2={W - PAD.right}
                    y1={gy}
                    y2={gy}
                    className="stroke-[var(--border)]"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD.left - 8}
                    y={gy}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-[var(--muted-foreground)]"
                    fontSize={11}
                  >
                    {compactMoney(t, currency)}
                  </text>
                </g>
              );
            })}

            {data.map((d, i) => {
              const cx = PAD.left + band * i + band / 2;
              const bx = cx - barW / 2;

              // Margin can go negative — a line sold under cost. Clamped for
              // drawing so the stack never inverts, but the tooltip reports the
              // real figure, because a loss is exactly what you opened this for.
              const margin = Math.max(0, d.margin_cents);
              const cost = Math.max(0, d.revenue_cents - margin);

              const stackTop = y(d.revenue_cents);
              const costTop = y(cost);
              const costH = Math.max(0, BASELINE - costTop);
              const marginH = Math.max(0, costTop - stackTop - SEGMENT_GAP);

              const active = hover === i;
              const dim = hover !== null && !active ? 0.45 : 1;

              return (
                <g key={d.day}>
                  {/* Cost sits on the baseline, square-topped: the rounded end
                      belongs to the top of the whole column, not to a joint. */}
                  {costH > 0 && (
                    <rect
                      x={bx}
                      y={costTop}
                      width={barW}
                      height={costH}
                      fill="var(--chart-cost)"
                      opacity={dim}
                    />
                  )}
                  {marginH > 0 && (
                    <path
                      d={barPath(bx, stackTop, barW, marginH, 4, "up")}
                      fill="var(--chart-margin)"
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

                  {/* Full-height hit target: a thin column is hard to hover, and
                      the whole band is unambiguously "that day". */}
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
                top: `${(y(point.revenue_cents) / H) * 100}%`,
              }}
            >
              <div className="font-semibold text-foreground">
                <LocalTime value={point.day} format="date" />
              </div>
              <div className="mt-1 space-y-0.5">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Took</span>
                  <span className="font-medium text-foreground">
                    {formatMoney(point.revenue_cents, currency)}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Kept</span>
                  <span
                    className={
                      point.margin_cents < 0 ? "font-medium text-destructive" : "font-medium"
                    }
                    style={point.margin_cents < 0 ? undefined : { color: "var(--chart-margin)" }}
                  >
                    {formatMoney(point.margin_cents, currency)}
                    {point.revenue_cents > 0 && (
                      <span className="ml-1 text-muted-foreground">
                        ({Math.round((point.margin_cents / point.revenue_cents) * 100)}%)
                      </span>
                    )}
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
