"use client";

import { useEffect, useState } from "react";
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

/**
 * A timestamp that survives hydration and still shows the device's own clock.
 *
 * Those two wants pull against each other: hydration needs the server and the
 * client's first render to emit identical text, and "the device's own clock"
 * is by definition something the server cannot know. Pinning the locale (see
 * DISPLAY_LOCALE) settles the formatting half, but not the timezone — a
 * container running UTC and a shop three hours east disagree on the hour, and
 * on the date either side of midnight.
 *
 * So the first render is deliberately *wrong but agreed*: both sides format in
 * UTC and produce the same string, hydration matches, and nothing is thrown
 * away. The mount effect then re-renders in the browser's real zone. React only
 * compares the first pass, so the correction costs nothing.
 *
 * Rendering a bare `new Date(x).toLocaleString()` in JSX is what caused the
 * mismatch this replaces — reach for this instead. In an event handler, where
 * there is no server render to disagree with, call formatDateTime() directly.
 */
/**
 * False through the server render and the client's hydration pass, true from
 * the mount effect onward.
 *
 * Exported because a timestamp is not always an element: ReceiptsClient bakes
 * one into a WhatsApp `href`, which is rendered on the server too and so has
 * exactly the same problem in attribute form. Gate on this and format with
 * `timeZone: "UTC"` until it flips.
 */
export function useIsMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function LocalTime({ value, format = "datetime", className }: Props) {
  const local = useIsMounted();

  // toISOString() throws on an unparseable date where the formatters just
  // return "", so the dateTime attribute is dropped rather than taking the
  // whole page down over one bad row.
  const date = new Date(value);
  const iso = Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  const text = FORMATTERS[format](value, local ? undefined : "UTC");

  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
