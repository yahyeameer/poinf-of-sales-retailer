// Edge runtime — middleware.ts and anything with `export const runtime = "edge"`.
// A separate file because the edge runtime has no Node APIs, so Sentry ships a
// different build and Next loads it through its own instrumentation branch.
import * as Sentry from "@sentry/nextjs";

import { IGNORE_ERRORS, SENTRY_DSN, TRACES_SAMPLE_RATE, beforeSend, sentryEnabled } from "@/lib/sentry-shared";

if (sentryEnabled) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    ignoreErrors: IGNORE_ERRORS,
    beforeSend,
    sendDefaultPii: false,
  });
}
