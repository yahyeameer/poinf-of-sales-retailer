import { AlertTriangle } from "lucide-react";

/**
 * Shown whenever a page is rendering sample data instead of the shop's own.
 *
 * The fallback is genuinely useful for previewing without a database, but
 * unlabelled it is the worst failure mode a POS can have: invented revenue,
 * formatted exactly like real revenue, with the underlying error swallowed. An
 * owner checking yesterday's takings would have no way to tell.
 *
 * Deliberately louder than an ordinary notice — it has to survive being
 * glanced past.
 */
export function DemoBanner({ reason }: { reason: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-rose-300 border-l-4 border-l-rose-500
                 bg-rose-50 p-4 text-sm
                 dark:border-rose-900 dark:border-l-rose-600 dark:bg-rose-950/40"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong className="font-semibold text-rose-800 dark:text-rose-300">
          Sample data — not your shop.
        </strong>
        <span className="text-rose-700/80 dark:text-rose-400/80">{reason}</span>
      </div>
    </div>
  );
}
