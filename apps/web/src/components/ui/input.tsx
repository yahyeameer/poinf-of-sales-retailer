import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * Focus is a glow, not just a ring: on a phone propped on a counter the ring
 * alone is easy to lose. The border warms to primary at the same time so the
 * field reads as active even at a glance.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground",
        "transition-[box-shadow,border-color] duration-200",
        "placeholder:text-muted-foreground/70",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "focus-visible:outline-none focus-visible:border-primary/60 focus-visible:glow-md",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-destructive/60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
