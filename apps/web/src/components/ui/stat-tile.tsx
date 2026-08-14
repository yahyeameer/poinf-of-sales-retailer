import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

// This build of lucide-react exports LucideIcon as a namespace, not a type, so
// importing it as one fails. The component type is what we actually need.
type IconComponent = React.ComponentType<{ className?: string }>;

export interface StatTileProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  label: string;
  /** Pre-formatted. Currency and unit decisions belong to the caller. */
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: IconComponent;
  /** Period-over-period change, as a percentage. Omit when there's no baseline. */
  delta?: number;
  deltaLabel?: string;
  /**
   * Flips which direction is good. Revenue up is good; variance and shrinkage
   * up are not, and colouring those green would actively mislead.
   */
  invertDelta?: boolean;
  /** A `Sparkline`, usually. Rendered under the value, full width. */
  children?: React.ReactNode;
}

/**
 * The glowing metric card. One per figure a shop owner checks without reading
 * the rest of the screen, so the numeral carries the emphasis and everything
 * else stays quiet.
 */
const StatTile = React.forwardRef<HTMLDivElement, StatTileProps>(
  (
    { label, value, hint, icon: Icon, delta, deltaLabel, invertDelta, children, className, ...props },
    ref,
  ) => {
    const hasDelta = typeof delta === "number" && Number.isFinite(delta);
    // Treat a rounding-noise change as flat rather than claiming a direction.
    const flat = hasDelta && Math.abs(delta) < 0.05;
    const rising = hasDelta && delta > 0;
    const good = invertDelta ? !rising : rising;
    const DeltaIcon = flat ? Minus : rising ? ArrowUpRight : ArrowDownRight;

    return (
      <div
        ref={ref}
        className={cn(
          "group relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border",
          "bg-card p-5 text-card-foreground glow-sm lit-edge",
          "transition-[box-shadow,border-color] duration-200 hover:border-primary/30 hover:glow-md",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          {Icon ? (
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
              <Icon className="size-4" />
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-gradient text-3xl font-bold leading-none tracking-tight">
            {value}
          </span>
          {hasDelta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-semibold",
                flat ? "text-muted-foreground" : good ? "text-success" : "text-destructive",
              )}
            >
              <DeltaIcon className="size-3.5" aria-hidden />
              {flat ? "flat" : `${Math.abs(delta).toFixed(1)}%`}
              {deltaLabel ? (
                <span className="font-normal text-muted-foreground"> {deltaLabel}</span>
              ) : null}
            </span>
          ) : null}
        </div>

        {children}

        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    );
  },
);
StatTile.displayName = "StatTile";

export { StatTile };
