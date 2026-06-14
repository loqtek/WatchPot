"use client";

import { useCallback, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import type { WidgetPayload } from "@/lib/monitoring-types";
import { useAsyncData } from "@/hooks/use-async-data";

function buildQuery(widgetType: string, config: Record<string, unknown> | null): string {
  const c = config ?? {};
  const range = typeof c.range === "string" ? c.range : "24h";
  const bucket = typeof c.bucket === "string" ? c.bucket : "hour";
  const limit = typeof c.limit === "number" ? c.limit : 10;
  const potId = typeof c.pot_id === "string" && c.pot_id ? c.pot_id : "";
  const params = new URLSearchParams();
  params.set("type", widgetType);
  params.set("range", range);
  params.set("bucket", bucket);
  params.set("limit", String(limit));
  if (potId) params.set("pot_id", potId);
  return `/analytics/widget?${params.toString()}`;
}

export function useWidgetData(
  widgetType: string,
  config: Record<string, unknown> | null,
  refreshInterval = 0,
) {
  const configKey = useMemo(() => JSON.stringify(config ?? {}), [config]);
  const fetcher = useCallback(
    () => apiFetch<WidgetPayload>(buildQuery(widgetType, JSON.parse(configKey) as Record<string, unknown>)),
    [widgetType, configKey],
  );
  return useAsyncData(fetcher, { refreshInterval });
}
