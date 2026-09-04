// Browser. Next loads this before any client code runs, which is why it is a
// top-level file rather than something imported from a layout: an error thrown
// while the first chunk evaluates still gets caught.
import * as Sentry from "@sentry/nextjs";

import { IGNORE_ERRORS, SENTRY_DSN, TRACES_SAMPLE_RATE, beforeSend, sentryEnabled } from "@/lib/sentry-shared";

if (sentryEnabled) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    ignoreErrors: IGNORE_ERRORS,
    beforeSend,
    sendDefaultPii: false,
    // No Session Replay. It records the DOM, and the DOM here includes the till
    // keypad, customer phone numbers on receipts, and every price and cost in
    // the catalogue. Enabling it is a decision for the shop to make knowingly,
    // not a default they inherit from a monitoring setup.
  });
}

/** Instrumentation for client-side navigations, so a route change that fails
 *  is attributed to the route it was going to rather than the one it left. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
