/** Shared Grafana/Zabbix-style chart styling for monitoring dashboards. */

export const CHART_PALETTE = [
  "#34d399", // emerald
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#fb7185", // rose
  "#fbbf24", // amber
  "#2dd4bf", // teal
  "#818cf8", // indigo
  "#f472b6", // pink
] as const;

export const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#84cc16",
  info: "#38bdf8",
  warning: "#fbbf24",
  error: "#ef4444",
  debug: "#71717a",
};

export const CHART_GRID = "#27272a";
export const CHART_AXIS = "#52525b";
export const CHART_AXIS_TICK = { fill: "#71717a", fontSize: 10 };
export const CHART_TOOLTIP_STYLE = {
  background: "#18181b",
  border: "1px solid #3f3f46",
  borderRadius: 8,
  fontSize: 12,
  color: "#fafafa",
  boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
};

export function severityColor(key: string, fallbackIndex = 0): string {
  return SEVERITY_COLORS[key.toLowerCase()] ?? CHART_PALETTE[fallbackIndex % CHART_PALETTE.length];
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}k`;
  return n.toLocaleString();
}

export function formatAxisTime(iso: string, compact = true): string {
  if (!compact) return iso.slice(0, 16).replace("T", " ");
  // Show MM-DD HH:00 for hourly, MM-DD for daily
  const d = iso.slice(5, 16);
  return d.endsWith("00:00") ? iso.slice(5, 10) : d;
}

export function truncateLabel(s: string, max = 22): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
