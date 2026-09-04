// Node runtime. Loaded by src/instrumentation.ts, which Next calls once per
// server process before any request is handled.
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
    // Off deliberately. The server sees the Supabase session cookie and every
    // request body the till posts; sendDefaultPii would attach both.
    sendDefaultPii: false,
    // Local runs stay quiet. Turn this on by hand when debugging the setup
    // itself, not by default — it prints an envelope per event.
    debug: false,
  });
}
