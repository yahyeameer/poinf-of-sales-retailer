"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * The root layout itself failed, so there is no Shell, no theme, and no
 * design tokens — this component renders its own <html> and <body>, and the
 * styles here are literal for that reason: `text-muted-foreground` resolves to
 * nothing when globals.css never loaded.
 *
 * This is the boundary that catches the worst failures, which makes it the one
 * that most needs to report. Same reason as error.tsx: it took `error` and
 * dropped it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center p-6 text-center font-sans">
        <h1 className="text-3xl font-bold tracking-tight">System Error</h1>
        <p className="mt-2 text-sm text-gray-500">A critical error occurred. Please try reloading.</p>
        <button
          onClick={() => reset()}
          className="mt-6 rounded-lg bg-black px-4 py-2 text-sm text-white"
        >
          Reload App
        </button>
        {error.digest && (
          <p className="mt-6 font-mono text-xs text-gray-500">
            Reference <span className="select-all">{error.digest}</span>
          </p>
        )}
      </body>
    </html>
  );
}
