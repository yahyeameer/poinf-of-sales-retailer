"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

/**
 * Sun and moon are stacked and cross-faded rather than swapped, so the control
 * never reflows and the transition survives a fast double-tap.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggle } = useTheme();

  // Until the effect in ThemeProvider runs, `resolvedTheme` is the placeholder
  // "light" while <html> may already be dark. Rendering the icon before then
  // would flash the wrong one, so hold an equally sized blank.
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light mode" : "Dark mode"}
      className={cn(
        "group relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg",
        "border border-border bg-card text-muted-foreground",
        "transition-all duration-200 hover:border-primary/40 hover:text-primary hover:shadow-[var(--glow-sm)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {/* Bloom that lights up under the cursor. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: "radial-gradient(60% 60% at 50% 50%, rgb(var(--glow-rgb) / 0.22), transparent 70%)",
        }}
      />
      {ready && (
        <>
          <Sun
            className={cn(
              "absolute h-4 w-4 transition-all duration-300",
              isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100",
            )}
          />
          <Moon
            className={cn(
              "absolute h-4 w-4 transition-all duration-300",
              isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0",
            )}
          />
        </>
      )}
    </button>
  );
}
