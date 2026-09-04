/**
 * Shared by the server page and the client component, so it lives in neither.
 *
 * This started life inside AnalyticsClient. Next turns every export of a
 * "use client" module into a client reference, so the server component
 * importing it got a proxy rather than the object and `RANGES[range].days`
 * threw on undefined. Values crossing that boundary belong in a module that
 * declares neither side.
 */
export const RANGES = {
  "7d": { days: 7, label: "7 days" },
  "30d": { days: 30, label: "30 days" },
  "90d": { days: 90, label: "90 days" },
} as const;

export type RangeKey = keyof typeof RANGES;
