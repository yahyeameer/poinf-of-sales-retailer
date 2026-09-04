"use client";

import { useSyncExternalStore } from "react";
import { formatDate, formatDateTime, formatLongDate, formatTime } from "@ai-pos/shared";

const FORMATTERS = {
  datetime: formatDateTime,
  date: formatDate,
  time: formatTime,
  long: formatLongDate,
} as const;

type Props = {
  value: string | number | Date;
  /** Which of the shared formatters to use. Defaults to date + time. */
  format?: keyof typeof FORMATTERS;
  className?: string;
};

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function useIsMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function LocalTime({ value, format = "datetime", className }: Props) {
  const local = useIsMounted();

  const date = new Date(value);
  const iso = Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  const text = FORMATTERS[format](value, local ? undefined : "UTC");

  return (
    // Pinning the locale (see datetime.ts) removes almost all server/client
    // disagreement, but not all of it: Node and the browser ship different ICU
    // builds, and their CLDR data can differ on the same locale and options.
    // en-GB "long" is one such case — Node's ICU 78 renders "Friday, 4 Sept
    // 2026" and Chromium renders "Friday 4 Sept 2026". Identical inputs, one
    // comma apart, and React threw away the whole dashboard tree over it.
    //
    // suppressHydrationWarning is the sanctioned answer for exactly this: a
    // text node whose two renders are both correct. It is scoped to this
    // element, so a genuine mismatch anywhere else still surfaces.
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
