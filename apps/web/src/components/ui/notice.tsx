import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The inline result of something the user just did — a save that worked, an
 * import that partly failed, a shift that closed short.
 *
 * Extracted because this markup was hand-written in thirteen files, each with
 * its own hex pair and its own idea of which icon meant what. `DemoBanner` is
 * deliberately not built on this: it warns that the *whole page* is fiction,
 * and it is supposed to be louder than an ordinary result line.
 */
const noticeVariants = cva(
  "flex items-start gap-3 rounded-xl border p-3.5 text-sm",
  {
    variants: {
      tone: {
        info: "border-border bg-muted text-foreground",
        success: "border-success/25 bg-success/10 text-success",
        warning: "border-warning/25 bg-warning/10 text-warning",
        error: "border-destructive/25 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

const TONE_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle,
} as const;

export interface NoticeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof noticeVariants> {
  /** Suppresses the leading icon for notices that carry their own. */
  hideIcon?: boolean;
}

function Notice({ tone = "info", hideIcon, className, children, ...props }: NoticeProps) {
  const Icon = TONE_ICON[tone ?? "info"];

  return (
    <div
      // Announced without stealing focus: a cashier mid-sale should not be
      // yanked out of the barcode field to hear that a save succeeded.
      role="status"
      aria-live="polite"
      className={cn(noticeVariants({ tone }), className)}
      {...props}
    >
      {!hideIcon && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Server actions across this app all return `{ ok, message }`, so this is the
 * shape almost every call site actually has.
 */
function ActionNotice({
  result,
  className,
}: {
  result: { ok: boolean; message: string } | null;
  className?: string;
}) {
  if (!result) return null;
  return (
    <Notice tone={result.ok ? "success" : "error"} className={className}>
      {result.message}
    </Notice>
  );
}

export { Notice, ActionNotice, noticeVariants };
