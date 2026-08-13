"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Plain <label> rather than @radix-ui/react-label — the Radix package isn't a
 * dependency here and its only advantage is forwarding to a non-native control,
 * which nothing in this app does.
 */
const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none text-slate-700 dark:text-slate-300",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = "Label";

export { Label };
