/**
 * Dates for display.
 *
 * `toLocaleString()` with no locale takes one from whatever is running it — the
 * Node container on the server, the device in the browser. Those disagree on
 * script, digits, separators and AM/PM, so a timestamp rendered on both sides
 * of hydration produces two different strings and React throws the server tree
 * away:
 *
 *   + 14‏/8‏/2026، 2:17:31 ص      (client, an Arabic device)
 *   - 8/14/2026, 2:17:31 AM       (server)
 *
 * So the locale is pinned here, exactly as formatMoney() pins its own.
 */

/**
 * Deliberately not formatMoney()'s "en-US". A receipt timestamp has to be
 * unambiguous to someone reading it back later, which means day-first and a
 * 24-hour clock: 14/08/2026, 02:17 rather than 8/14/2026, 2:17 AM.
 */
export const DISPLAY_LOCALE = "en-GB";

type DateInput = string | number | Date;

/**
 * Falls back to the ISO string if the runtime's ICU data can't do the job —
 * same trade as formatMoney(). A wrong-looking timestamp is recoverable; a
 * RangeError thrown mid-render is not.
 */
function format(value: DateInput, options: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  try {
    return new Intl.DateTimeFormat(DISPLAY_LOCALE, options).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Date and time together — the default for anything that happened at a moment:
 * a sale, a stock movement, a shift opening.
 *
 * `timeZone` left undefined means "whatever zone this runtime is in", which is
 * what you want in the browser and what you must NOT rely on across hydration.
 * Pass "UTC" explicitly for the server-rendered pass; see <LocalTime>.
 */
export function formatDateTime(value: DateInput, timeZone?: string): string {
  return format(value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

/** Just the day, for grouping and for headings. */
export function formatDate(value: DateInput, timeZone?: string): string {
  return format(value, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone,
  });
}

/** Just the clock time, for rows already grouped under a date. */
export function formatTime(value: DateInput, timeZone?: string): string {
  return format(value, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

/** Long form with the weekday, for the dashboard's "today" badge. */
export function formatLongDate(value: DateInput, timeZone?: string): string {
  return format(value, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone,
  });
}
