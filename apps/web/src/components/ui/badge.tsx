import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Tinted rather than solid: a badge sits inside dense tables and lists, and a
 * row of saturated pills fights the primary action for attention. The tint is
 * an alpha of the semantic colour, so it reads correctly on both grounds
 * without a hand-written `dark:` pair.
 */
const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5",
    "text-xs font-semibold whitespace-nowrap transition-colors",
    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
  ],
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary/12 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-destructive/25 bg-destructive/12 text-destructive",
        warning: "border-warning/25 bg-warning/12 text-warning",
        success: "border-success/25 bg-success/12 text-success",
        outline: "border-border text-foreground",
        /* Solid, glowing — for the one status per screen that must be read
           first (a live shift, an over-count, an unsynced sale). */
        solid: "border-transparent bg-primary text-primary-foreground glow-btn",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
