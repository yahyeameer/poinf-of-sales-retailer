"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A sheet is a Radix dialog that arrives from an edge instead of the centre.
 * It exists because the two things this app does on a phone — pick a route from
 * a long list, and review a cart before charging — are both bad modals and good
 * sheets: thumb-reachable, dismissible with a swipe-sized target, and able to
 * hold a scrolling list without covering the whole screen.
 *
 * Only `bottom` and `left` are offered. Every use here is one of those two, and
 * an unused side would mean keyframes nothing renders.
 */

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/55 backdrop-blur-sm",
      "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  [
    "fixed z-50 flex flex-col gap-4 border-border bg-popover text-popover-foreground glow-lg",
    // The panel itself scrolls; the page behind it must not.
    "overflow-y-auto",
  ],
  {
    variants: {
      side: {
        bottom: [
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t p-5 safe-b lit-edge",
          "data-[state=open]:animate-slide-up data-[state=closed]:animate-slide-down",
        ],
        left: [
          "inset-y-0 left-0 h-full w-[85%] max-w-sm border-r p-5",
          "data-[state=open]:animate-slide-in-left data-[state=closed]:animate-slide-out-left",
        ],
      },
    },
    defaultVariants: { side: "bottom" },
  },
);

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** Hides the corner close button — for sheets whose own footer closes them. */
  hideClose?: boolean;
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "bottom", hideClose = false, className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
      {side === "bottom" && (
        // Grabber. Purely a signifier — Radix has no swipe gesture — but it is
        // what tells a thumb this panel is dismissible.
        <div aria-hidden className="mx-auto -mt-1 h-1 w-10 shrink-0 rounded-full bg-border-strong" />
      )}
      {children}
      {!hideClose && (
        <SheetPrimitive.Close
          className={cn(
            "absolute right-4 top-4 rounded-md p-1 text-muted-foreground",
            "transition-colors hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      )}
    </SheetPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = SheetPrimitive.Content.displayName;

function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 text-left", className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-auto flex flex-col gap-2", className)} {...props} />;
}

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-base font-semibold tracking-tight", className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
