"use client";

import { useState } from "react";
import { formatMoney } from "@ai-pos/shared";

import { LocalTime } from "@/components/LocalTime";
import { barPath, compactMoney, niceCeil, ticks } from "./svg";

export interface TrendPoint {
  day: string; // ISO date
  revenue_cents: number;
  transactions: number;
}

// One fixed coordinate space; the SVG scales to its container via viewBox.
const W = 700;
const H = 250;
const PAD = { top: 18, right: 14, bottom: 28, left: 52 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const BASELINE = PAD.top + PLOT_H;

/**
 * A week of daily takings as columns — magnitude over time, one series, so the
 * card title names it and there is no legend. Emerald is the brand's single
 * series colour and swaps for dark on its own. Hover anywhere over a day for the
 * exact figure; the tallest day is labelled directly so the peak reads without
 * hovering.
 */
export function RevenueTrend({ data, currency }: { data: TrendPoint[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(0, ...data.map((d) => d.revenue_cents));
  const top = niceCeil(max) || 1;
  const y = (cents: number) => BASELINE - (cents / top) * PLOT_H;
  const band = PLOT_W / Math.max(data.length, 1);
  const barW = Math.min(24, band * 0.6);
  const peak = data.reduce((best, d, i) => (d.revenue_cents > (data[best]?.revenue_cents ?? -1) ? i : best), 0);

  if (data.length === 0 || max === 0) {
    return (
      <div className="grid h-[220px] place-items-center text-sm text-muted-foreground">
        No sales yet this week — the trend fills in as the till takes payments.
      </div>
    );
  }

  return (
    // The 700-wide coordinate space scaled to a 390px phone put the axis
    // labels at about five pixels — present, but not readable, which is worse
    // than absent because it looks like the chart is working. Scrolling a
    // readable chart beats shrinking an unreadable one, and it is the same
    // answer this codebase already gives for wide tables.
    //
    // `relative` moves inward with the min-width, because the hover tooltip
    // positions itself as a percentage of the SVG's box — anchoring it to the
    // scroll container instead would drift it off the bar it describes.
    <div className="overflow-x-auto">
      <div className="relative min-w-[600px]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Daily revenue for the last ${data.length} days`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Gridlines + y ticks. Recessive, hairline, solid. */}
        {ticks(max, 4).map((t) => {
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
          const by = y(d.revenue_cents);
          const active = hover === i;
          return (
            <g key={d.day}>
              <path
                d={barPath(bx, by, barW, BASELINE - by, 4, "up")}
                className="fill-[var(--primary)]"
                opacity={hover === null || active ? 1 : 0.45}
              />
              {/* Weekday tick under each column. */}
              <text
                x={cx}
                y={H - 8}
                textAnchor="middle"
                className="fill-[var(--muted-foreground)]"
                fontSize={11}
              >
                {new Date(d.day).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
              </text>
              {/* Direct label on the peak only — sparing, per the mark specs. */}
              {i === peak && (
                <text
                  x={cx}
                  y={by - 6}
                  textAnchor="middle"
                  className="fill-[var(--foreground)]"
                  fontSize={11}
                  fontWeight={600}
                >
                  {compactMoney(d.revenue_cents, currency)}
                </text>
              )}
              {/* Full-height transparent hit target — easier to hover than the bar. */}
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

      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${((PAD.left + band * hover + band / 2) / W) * 100}%`,
            top: `${(y(data[hover].revenue_cents) / H) * 100}%`,
          }}
        >
          <div className="font-semibold text-foreground">
            <LocalTime value={data[hover].day} format="date" />
          </div>
          <div className="mt-0.5 text-primary">{formatMoney(data[hover].revenue_cents, currency)}</div>
          <div className="text-muted-foreground">{data[hover].transactions} sales</div>
        </div>
      )}
      </div>
    </div>
  );
}
