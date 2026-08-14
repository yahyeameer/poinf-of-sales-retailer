import * as React from "react";

import { cn } from "@/lib/utils";

type IconComponent = React.ComponentType<{ className?: string }>;

/**
 * What a list shows when it has nothing to show. Says what would be here and,
 * where there is one, offers the action that would put something here — an
 * empty table with no explanation reads as a failed load.
 */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: IconComponent;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      {Icon && (
        <span className="mb-1 grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </span>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
