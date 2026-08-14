import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
    "rounded-lg font-semibold tracking-[-0.01em]",
    "transition-[box-shadow,background-color,color,border-color,transform] duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    // Presses in rather than jumping. Reads as physical on a touchscreen.
    "active:translate-y-px active:scale-[0.985]",
    // Any icon passed as a child is sized here so no call site has to.
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        /* The lit primary. The gradient is a single hue at two brightnesses —
           two different hues would read as a novelty button rather than the
           app's main action. */
        default: [
          "bg-linear-to-b from-primary-bright to-primary text-primary-foreground",
          "shadow-[var(--glow-btn)] hover:shadow-[var(--glow-btn-hover)]",
          "hover:brightness-110",
        ],
        destructive: [
          "bg-destructive text-destructive-foreground",
          "shadow-[0_4px_14px_-6px_var(--destructive)] hover:brightness-110",
          "hover:shadow-[0_8px_24px_-6px_var(--destructive)]",
        ],
        outline: [
          "border border-border bg-card text-foreground",
          "hover:border-primary/45 hover:bg-primary-soft hover:text-primary",
          "hover:shadow-[var(--glow-sm)]",
        ],
        secondary: "bg-secondary text-secondary-foreground hover:brightness-95 dark:hover:brightness-125",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        /* Cash / card / mobile-money keys at the till. Reads as a lit chip so a
           cashier can hit the right one without reading it twice. */
        tender: [
          "border border-primary/30 bg-primary-soft text-primary",
          "hover:border-primary/60 hover:shadow-[var(--glow-md)]",
        ],
      },
      size: {
        default: "h-10 px-4 text-sm",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-xl px-7 text-[0.95rem]",
        /* Retail-sized. Used for Charge, and for anything a cashier hits while
           holding the phone one-handed across a counter. */
        till: "min-h-14 rounded-xl px-8 text-base",
        icon: "size-10",
        "icon-sm": "size-8 rounded-md",
      },
      /** Full width on phones, intrinsic from `sm` up. */
      block: {
        true: "w-full sm:w-auto",
        always: "w-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, block, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
