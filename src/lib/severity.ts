export type SeverityTone = "default" | "warning" | "danger" | "success" | "info";

export function severityTone(s: string): SeverityTone {
  const x = s.toLowerCase();
  if (x.includes("critical") || x.includes("crit") || x.includes("high") || x.includes("error")) return "danger";
  if (x.includes("medium") || x.includes("warn")) return "warning";
  if (x.includes("low") || x.includes("info")) return "info";
  if (x.includes("ok") || x.includes("success")) return "success";
  return "default";
}
