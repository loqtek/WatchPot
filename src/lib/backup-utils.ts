export function formatBytes(n: number | null | undefined): string {
  if (n == null || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function backupTypeLabel(t: string): string {
  switch (t) {
    case "container":
      return "Container";
    case "pot":
      return "Pot (all containers)";
    case "host":
      return "Host";
    default:
      return t;
  }
}

export function backupStatusTone(
  s: string,
): "default" | "success" | "warning" | "danger" | "info" {
  switch (s) {
    case "completed":
      return "success";
    case "running":
      return "info";
    case "pending":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "default";
  }
}

export function storageLocationLabel(loc: string): string {
  switch (loc) {
    case "agent":
      return "Pot agent";
    case "server":
      return "WatchPot server";
    case "external":
      return "External store";
    case "mixed":
      return "Mixed locations";
    default:
      return loc;
  }
}

export function storageLocationTone(
  loc: string,
): "default" | "success" | "warning" | "info" {
  switch (loc) {
    case "server":
      return "success";
    case "agent":
      return "info";
    case "external":
      return "warning";
    default:
      return "default";
  }
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

export function intervalLabel(hours: number): string {
  if (hours < 24) return `Every ${hours}h`;
  if (hours === 24) return "Daily";
  if (hours % 24 === 0) return `Every ${hours / 24}d`;
  return `Every ${hours}h`;
}
