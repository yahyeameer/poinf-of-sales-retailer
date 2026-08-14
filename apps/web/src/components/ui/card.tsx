import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Glow is a `cva` variant rather than something you pass through `className`.
 * `tailwind-merge` has no idea these custom utilities conflict, so a call site
 * that passed `glow-lg` would end up with two `box-shadow` rules and whichever
 * one the stylesheet happened to emit last would win.
 */
const cardVariants = cva(
  [
    // `relative` is required by `lit-edge`, which no longer sets a position of
    // its own so that it can also be used on fixed surfaces.
    "relative rounded-xl border border-border bg-card text-card-foreground",
    "transition-[box-shadow,border-color,transform] duration-200",
  ],
  {
    variants: {
      glow: {
        none: "shadow-none",
        sm: "glow-sm hover:glow-md",
        md: "glow-md",
        lg: "glow-lg",
      },
      /** The hairline of light along the top edge. Off for nested surfaces. */
      lit: { true: "lit-edge", false: "" },
    },
    defaultVariants: { glow: "sm", lit: true },
  },
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, glow, lit, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ glow, lit }), className)} {...props} />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-5", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-base font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-5 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  cardVariants,
};
