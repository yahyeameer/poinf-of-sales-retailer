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
      className="flex items-start gap-3 rounded-xl border border-destructive/40 border-l-4
                 border-l-destructive bg-destructive/10 p-4 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong className="font-semibold">Sample data — not your shop.</strong>
        <span className="opacity-80">{reason}</span>
      </div>
    </div>
  );
}
