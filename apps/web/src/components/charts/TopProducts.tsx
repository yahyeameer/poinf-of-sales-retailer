import { formatMoney } from "@ai-pos/shared";

export interface Mover {
  name: string;
  units: number;
  revenue: number;
}

/**
 * Best sellers as ranked horizontal bars — magnitude by identity, one measure
 * (revenue), so one hue (the brand emerald) and the exact figure on the row
 * rather than a number crammed onto every bar end. The bar length is the
 * comparison; the label is the value.
 */
export function TopProducts({ data, currency }: { data: Mover[]; currency: string }) {
  const max = Math.max(1, ...data.map((m) => m.revenue));

  return (
    <ol className="space-y-3.5 p-4">
      {data.map((m, i) => (
        <li key={m.name}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-foreground">
              <span className="text-muted-foreground">{i + 1}.</span> {m.name}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-primary">
              {formatMoney(m.revenue, currency)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2.5">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[var(--primary)]"
                style={{ width: `${(m.revenue / max) * 100}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {m.units} u
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
