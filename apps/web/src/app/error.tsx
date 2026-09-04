"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * This boundary used to take `error` in its props type and then not bind it —
 * the error was destructured away and lost. Every unhandled failure in the app
 * showed this screen and left no trace anywhere: not in a log, not in a
 * dashboard, not in anything the shop could quote back. The only signal was a
 * customer waiting at a counter.
 */
export default function Error({
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
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        An unexpected error occurred while processing your request.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-6 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none"
      >
        Try again
      </button>
      {/* Next's digest for a server-side throw. It is the same string
          onRequestError reports, so someone reading it off a phone at a counter
          is enough to find the exact event — no reproduction needed. */}
      {error.digest && (
        <p className="mt-6 font-mono text-xs text-muted-foreground">
          Reference <span className="select-all">{error.digest}</span>
        </p>
      )}
    </main>
  );
}
