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
        "peer h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-slate-300",
        "bg-white transition-colors",
        "checked:border-emerald-600 checked:bg-emerald-600",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-slate-700 dark:bg-slate-950",
        className,
      )}
      {...props}
    />
    <Check
      className="pointer-events-none absolute h-3 w-3 text-white opacity-0 peer-checked:opacity-100"
      strokeWidth={3}
    />
  </span>
));
Checkbox.displayName = "Checkbox";

export { Checkbox };
