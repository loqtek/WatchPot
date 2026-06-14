/** All API timestamps are UTC ISO strings; display in the operator's chosen IANA timezone. */

export const DEFAULT_TIMEZONE = "America/New_York";

const DEFAULT_DATETIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

const DEFAULT_DATE: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

const DEFAULT_TIME: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

/** Parse API ISO timestamps; treat missing offset as UTC. */
export function parseUtcDate(iso: string): Date {
  const trimmed = iso.trim();
  if (!trimmed) return new Date(NaN);
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed);
  }
  return new Date(`${trimmed}Z`);
}

export function formatDateTime(
  iso: string,
  timezone: string = DEFAULT_TIMEZONE,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATETIME,
): string {
  const d = parseUtcDate(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: timezone }).format(d);
}

export function formatDate(
  iso: string,
  timezone: string = DEFAULT_TIMEZONE,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE,
): string {
  return formatDateTime(iso, timezone, options);
}

export function formatTime(
  iso: string,
  timezone: string = DEFAULT_TIMEZONE,
  options: Intl.DateTimeFormatOptions = DEFAULT_TIME,
): string {
  return formatDateTime(iso, timezone, options);
}

export function formatRelativeTime(
  iso: string,
  timezone: string = DEFAULT_TIMEZONE,
): { short: string; full: string } {
  const d = parseUtcDate(iso);
  const full = formatDateTime(iso, timezone);
  if (Number.isNaN(d.getTime())) return { short: "—", full };

  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  let short: string;
  if (diffSec < 45) short = "just now";
  else if (diffMin < 60) short = `${diffMin}m ago`;
  else if (diffHr < 24) short = `${diffHr}h ago`;
  else if (diffDay < 7) short = `${diffDay}d ago`;
  else
    short = formatDateTime(iso, timezone, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return { short, full };
}

/** Curated list for settings UI (full IANA set is long). */
export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern — America/New_York" },
  { value: "America/Chicago", label: "Central — America/Chicago" },
  { value: "America/Denver", label: "Mountain — America/Denver" },
  { value: "America/Los_Angeles", label: "Pacific — America/Los_Angeles" },
  { value: "America/Anchorage", label: "Alaska — America/Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Pacific/Honolulu" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Berlin", label: "Europe/Berlin" },
  { value: "Europe/Paris", label: "Europe/Paris" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "Asia/Singapore", label: "Asia/Singapore" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
];

export function timezoneLabel(tz: string): string {
  return COMMON_TIMEZONES.find((o) => o.value === tz)?.label ?? tz;
}
