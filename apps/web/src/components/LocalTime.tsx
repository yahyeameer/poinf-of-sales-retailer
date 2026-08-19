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
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
