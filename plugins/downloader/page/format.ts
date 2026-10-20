// How the Downloads popover writes sizes, speeds and times.

import type { Translate } from "@pear/sdk/i18n";

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];
const STEP = 1024;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** "3.4 MiB": binary units, one decimal from KiB up. */
export function formatBytes(bytes: number) {
  let value = bytes;
  let unit = 0;
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit++;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

export const formatSpeed = (bytesPerSecond: number) => `${formatBytes(bytesPerSecond)}/s`;

/** "45 s", "3 min", "1 h 5 min". */
export function formatTimeLeft(seconds: number, t: Translate) {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < SECONDS_PER_MINUTE) return t("plugins.downloader.popover.time.seconds", "{{count}} s", { count: whole });
  if (whole < SECONDS_PER_HOUR) {
    return t("plugins.downloader.popover.time.minutes", "{{count}} min", { count: Math.round(whole / SECONDS_PER_MINUTE) });
  }
  const hours = Math.floor(whole / SECONDS_PER_HOUR);
  const minutes = Math.round((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return t("plugins.downloader.popover.time.hours", "{{hours}} h {{minutes}} min", { hours, minutes });
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Older than this, a date reads better than "12 days ago". */
const RELATIVE_LIMIT_MS = 7 * DAY_MS;

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** "5 minutes ago", "yesterday", or a date once it is a week old. */
export function formatWhen(time: number, now = Date.now()) {
  const ago = Math.max(0, now - time);
  if (ago < HOUR_MS) return RELATIVE.format(-Math.round(ago / MINUTE_MS), "minute");
  if (ago < DAY_MS) return RELATIVE.format(-Math.round(ago / HOUR_MS), "hour");
  if (ago < RELATIVE_LIMIT_MS) return RELATIVE.format(-Math.round(ago / DAY_MS), "day");
  return DATE.format(time);
}
