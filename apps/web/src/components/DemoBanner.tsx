/**
 * Shown whenever a page is rendering sample data instead of the shop's own.
 *
 * The fallback is genuinely useful for previewing without a database, but
 * unlabelled it is the worst failure mode a POS can have: invented revenue,
 * formatted exactly like real revenue, with the underlying error swallowed. An
 * owner checking yesterday's takings would have no way to tell.
 */
export function DemoBanner({ reason }: { reason: string }) {
  return (
    <div className="demo-banner" role="status">
      <strong>Sample data — not your shop.</strong>
      <span>{reason}</span>
    </div>
  );
}
