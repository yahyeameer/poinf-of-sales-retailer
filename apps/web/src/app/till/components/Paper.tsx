import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A slip of till roll — the sale summary and the X report.
 *
 * `printable` adds the `.receipt` class, which is the hook the print
 * stylesheet uses to hide everything else on the page. Without it `window.print()`
 * from these dialogs produced a blank sheet, since the rule only ever matched
 * the customer receipt component.
 */
function Paper({
  printable,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { printable?: boolean }) {
  return (
    <div
      className={cn(
        "space-y-1 rounded-lg border border-dashed border-border bg-muted/50 p-4",
        "font-mono text-xs tabular-nums",
        printable && "receipt",
        className,
      )}
      {...props}
    />
  );
}

function PaperRow({
  label,
  value,
  strong,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "font-bold")}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0">{value}</span>
    </div>
  );
}

function PaperRule() {
  return <div className="my-1.5 border-t border-dashed border-border" />;
}

export { Paper, PaperRow, PaperRule };
