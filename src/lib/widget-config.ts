import type { DashboardWidget } from "./monitoring-types";

/** Display + query options stored in widget `config` JSON. */
export type WidgetDisplayConfig = {
  range?: string;
  bucket?: string;
  limit?: number;
  pot_id?: string;
  /** Show panel title bar. Default true. */
  show_header?: boolean;
  /** When false, widget keeps its own range even if dashboard global range is set. */
  use_global_range?: boolean;
  /** Compact KPI layout (comparison_24h). */
  compact?: boolean;
};

export const TIME_RANGE_OPTIONS = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "14d", label: "14 days" },
  { value: "30d", label: "30 days" },
  { value: "31d", label: "31 days" },
] as const;

export const BUCKET_OPTIONS = [
  { value: "hour", label: "Hourly" },
  { value: "day", label: "Daily" },
] as const;

export function parseWidgetConfig(raw: Record<string, unknown> | null): WidgetDisplayConfig {
  const c = raw ?? {};
  return {
    range: typeof c.range === "string" ? c.range : undefined,
    bucket: typeof c.bucket === "string" ? c.bucket : undefined,
    limit: typeof c.limit === "number" ? c.limit : undefined,
    pot_id: typeof c.pot_id === "string" ? c.pot_id : undefined,
    show_header: c.show_header === false ? false : true,
    use_global_range: c.use_global_range === false ? false : true,
    compact: c.compact === true,
  };
}

export function toWidgetConfig(parsed: WidgetDisplayConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (parsed.range) out.range = parsed.range;
  if (parsed.bucket) out.bucket = parsed.bucket;
  if (parsed.limit != null) out.limit = parsed.limit;
  if (parsed.pot_id) out.pot_id = parsed.pot_id;
  if (parsed.show_header === false) out.show_header = false;
  if (parsed.use_global_range === false) out.use_global_range = false;
  if (parsed.compact === true) out.compact = true;
  return out;
}

export function effectiveQueryConfig(
  raw: Record<string, unknown> | null,
  globalRange: string | null,
): Record<string, unknown> {
  const parsed = parseWidgetConfig(raw);
  const base = { ...(raw ?? {}) };

  if (globalRange && parsed.use_global_range !== false) {
    if ("range" in base || raw == null || parsed.range != null) {
      base.range = globalRange;
    }
  }

  return base;
}

export function widgetSupportsRange(widgetType: string): boolean {
  return !["comparison_24h", "table_recent", "log_stream"].includes(widgetType);
}

export function widgetSupportsBucket(widgetType: string): boolean {
  return widgetType === "timeseries_line";
}

export function widgetSupportsLimit(widgetType: string): boolean {
  return [
    "donut_source",
    "bar_source",
    "bar_event_type",
    "horizontal_types",
    "top_pots",
    "table_recent",
    "log_stream",
    "stacks_bar",
  ].includes(widgetType);
}

export function widgetSupportsPotFilter(widgetType: string): boolean {
  return widgetType !== "comparison_24h";
}

export function widgetConfigSummary(w: DashboardWidget, globalRange: string | null): string {
  const parsed = parseWidgetConfig(w.config);
  const parts: string[] = [];
  const q = effectiveQueryConfig(w.config, globalRange);
  if (typeof q.range === "string") parts.push(q.range);
  if (typeof q.bucket === "string") parts.push(q.bucket);
  if (typeof q.limit === "number") parts.push(String(q.limit));
  if (parsed.pot_id) parts.push("scoped");
  return parts.join(" · ");
}
