"use client";

import { useMemo } from "react";
import {
  DEFAULT_TIMEZONE,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatTime,
} from "@/lib/format-datetime";
import { useAuthContext } from "@/contexts/auth-context";

export function useFormatDateTime() {
  const { user } = useAuthContext();
  const timezone = user?.timezone ?? DEFAULT_TIMEZONE;

  return useMemo(
    () => ({
      timezone,
      formatDateTime: (iso: string, options?: Intl.DateTimeFormatOptions) =>
        formatDateTime(iso, timezone, options),
      formatDate: (iso: string, options?: Intl.DateTimeFormatOptions) =>
        formatDate(iso, timezone, options),
      formatTime: (iso: string, options?: Intl.DateTimeFormatOptions) =>
        formatTime(iso, timezone, options),
      formatRelative: (iso: string) => formatRelativeTime(iso, timezone),
    }),
    [timezone],
  );
}
