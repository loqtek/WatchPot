/** Shared Grafana/Zabbix-style chart styling for monitoring dashboards. */

export const CHART_PALETTE = [
  "#E23D12",
  "#047857",
  "#0284C7",
  "#7C3AED",
  "#D97706",
  "#0F766E",
  "#BE123C",
  "#4F46E5",
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

const LIGHT_FRAME = {
  grid: "#e6e2da",
  axis: "#8c877e",
  tick: { fill: "#6f6b64", fontSize: 11 },
  tooltip: {
    background: "#ffffff",
    border: "1px solid rgba(25,25,24,0.08)",
    borderRadius: 12,
    fontSize: 12,
    color: "#1c1b18",
    boxShadow: "0 12px 32px rgba(25,25,24,0.08)",
  },
  pieStroke: "#ffffff",
  legend: "#6f6b64",
  polar: "#d6d1c7",
};

const DARK_FRAME = {
  grid: "rgba(244,241,234,0.1)",
  axis: "#746f66",
  tick: { fill: "#8a847a", fontSize: 11 },
  tooltip: {
    background: "#1c1b18",
    border: "1px solid rgba(244,241,234,0.1)",
    borderRadius: 12,
    fontSize: 12,
    color: "#f4f1ea",
    boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
  },
  pieStroke: "#1c1b18",
  legend: "#8a847a",
  polar: "#3a3732",
};

export function chartFrame(theme: "light" | "dark") {
  return theme === "dark" ? DARK_FRAME : LIGHT_FRAME;
}

/** @deprecated Prefer chartFrame(theme) so charts follow the active theme. */
export const CHART_GRID = LIGHT_FRAME.grid;
export const CHART_AXIS = LIGHT_FRAME.axis;
export const CHART_AXIS_TICK = LIGHT_FRAME.tick;
export const CHART_TOOLTIP_STYLE = LIGHT_FRAME.tooltip;

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
