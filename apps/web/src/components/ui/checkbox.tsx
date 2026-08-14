"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Native input rather than @radix-ui/react-checkbox, which isn't a dependency
 * here. A real checkbox keeps form submission, the label association and
 * keyboard behaviour for free; the visual is a sibling overlay so the input
 * itself stays in the accessibility tree.
 */
const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(({ className, ...props }, ref) => (
  <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "peer h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-border-strong",
        "bg-card transition-[background-color,border-color,box-shadow]",
        "checked:border-primary checked:bg-primary checked:glow-btn",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
    <Check
      className="pointer-events-none absolute h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
      strokeWidth={3}
    />
  </span>
));
Checkbox.displayName = "Checkbox";

export { Checkbox };
