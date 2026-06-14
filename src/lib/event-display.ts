import type { EventRow } from "@/lib/types";
import type { EventEnrichment } from "@/lib/enrichment-types";
import { ATTACK_TYPE_LABELS } from "@/lib/enrichment-types";
import { DEFAULT_TIMEZONE, formatDateTime, formatRelativeTime } from "@/lib/format-datetime";

export type SeverityTone = "default" | "warning" | "danger" | "success" | "info";
export type ChannelTone = "default" | "warning" | "danger" | "success" | "info";

const EVENT_TITLES: Record<string, string> = {
  "watchpot.agent.container_logs": "Container logs",
  "watchpot.agent.infra_snapshot": "Infra snapshot",
  "watchpot.pot.created": "Pot created",
  "watchpot.pot.updated": "Pot updated",
  "watchpot.pot.agent_key_rotated": "Agent key rotated",
  "watchpot.stack.created": "Stack created",
  "watchpot.stack.updated": "Stack updated",
  "watchpot.stack.deleted": "Stack deleted",
  "watchpot.stack.revision_pushed": "Stack revision pushed",
  "watchpot.stack.restart_requested": "Stack restart requested",
};

export function severityTone(s: string): SeverityTone {
  const x = s.toLowerCase();
  if (x.includes("high") || x.includes("crit") || x === "error") return "danger";
  if (x.includes("medium") || x.includes("warn") || x === "warning") return "warning";
  if (x.includes("low") || x.includes("info")) return "info";
  if (x.includes("ok") || x.includes("success")) return "success";
  return "default";
}

export function channelTone(ch: string): ChannelTone {
  if (ch === "infra") return "info";
  if (ch === "control") return "warning";
  return "default";
}

export function formatEventTitle(eventType: string): string {
  if (EVENT_TITLES[eventType]) return EVENT_TITLES[eventType];
  const stripped = eventType.replace(/^watchpot\.(agent|pot|stack|control)\./, "");
  return stripped
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatEventTime(iso: string, timezone: string = DEFAULT_TIMEZONE): { short: string; full: string } {
  return formatRelativeTime(iso, timezone);
}

function getEnrichment(ev: EventRow): EventEnrichment | null {
  const p = ev.payload;
  if (!p || typeof p.enrichment !== "object" || p.enrichment === null) return null;
  return p.enrichment as EventEnrichment;
}

export function hasEnrichmentMatch(ev: EventRow): boolean {
  const enr = getEnrichment(ev);
  return enr?.status === "matched" || enr?.status === "low_confidence";
}

export function enrichmentSummary(ev: EventRow): string | null {
  const enr = getEnrichment(ev);
  if (!enr || enr.status === "none" || enr.status === "pending") return null;
  const parts: string[] = [];
  for (const a of enr.attack_types ?? []) {
    parts.push(ATTACK_TYPE_LABELS[a] ?? a);
  }
  for (const t of enr.tools ?? []) parts.push(t);
  for (const c of enr.cve_ids ?? []) parts.push(c);
  return parts.length ? parts.join(" · ") : enr.status ?? null;
}

export function enrichmentDetailRows(
  ev: EventRow,
  timezone: string = DEFAULT_TIMEZONE,
): { label: string; value: string }[] {
  const enr = getEnrichment(ev);
  if (!enr) return [];
  const rows: { label: string; value: string }[] = [];
  if (enr.status) rows.push({ label: "Enrichment", value: enr.status });
  if (enr.confidence != null) rows.push({ label: "Confidence", value: `${Math.round(enr.confidence * 100)}%` });
  if (enr.attack_types?.length)
    rows.push({
      label: "Attack types",
      value: enr.attack_types.map((a) => ATTACK_TYPE_LABELS[a] ?? a).join(", "),
    });
  if (enr.tools?.length) rows.push({ label: "Tools", value: enr.tools.join(", ") });
  if (enr.techniques?.length) rows.push({ label: "MITRE", value: enr.techniques.join(", ") });
  if (enr.cve_ids?.length) rows.push({ label: "CVE IDs", value: enr.cve_ids.join(", ") });
  if (enr.rule_names?.length) rows.push({ label: "Rules", value: enr.rule_names.join(", ") });
  if (enr.enriched_at) rows.push({ label: "Enriched at", value: formatDateTime(enr.enriched_at, timezone) });
  if (enr.source_ips?.length) rows.push({ label: "Source IPs", value: enr.source_ips.join(", ") });
  if (enr.cve_details?.length) {
    for (const c of enr.cve_details.slice(0, 3)) {
      rows.push({ label: c.cve_id, value: c.summary.slice(0, 120) + (c.summary.length > 120 ? "…" : "") });
    }
  }
  return rows;
}

function str(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export function eventOneLiner(ev: EventRow): string | null {
  const p = ev.payload;

  switch (ev.event_type) {
    case "watchpot.agent.container_logs": {
      const image = p ? str(p.image) : null;
      const project = p ? str(p.compose_project) : null;
      const container = ev.service_name ?? (p ? str(p.container) : null);
      return [container, image, project].filter(Boolean).join(" · ") || null;
    }
    case "watchpot.agent.infra_snapshot": {
      if (!p) return null;
      const host = str(p.hostname);
      const dockerOk = p.docker_ps_ok === true && p.docker_info_ok === true;
      const dockerStatus =
        p.docker_ps_ok == null && p.docker_info_ok == null
          ? null
          : dockerOk
            ? "Docker OK"
            : "Docker issues";
      const count = Array.isArray(p.containers) ? p.containers.length : null;
      return [host, dockerStatus, count != null ? `${count} containers` : null].filter(Boolean).join(" · ") || null;
    }
    case "watchpot.pot.created":
    case "watchpot.pot.updated":
      return p ? [str(p.name), str(p.reason)].filter(Boolean).join(" · ") || null : null;
    case "watchpot.stack.created":
    case "watchpot.stack.updated":
    case "watchpot.stack.deleted":
    case "watchpot.stack.revision_pushed":
    case "watchpot.stack.restart_requested":
      return p ? [str(p.name), str(p.note)].filter(Boolean).join(" · ") || null : null;
    default:
      break;
  }

  if (p) {
    for (const key of ["message", "action", "name", "status", "error", "reason", "container"]) {
      const val = str(p[key]);
      if (val) return val;
    }
  }

  return ev.service_name || (ev.source ? ev.source.replace(/^watchpot\./, "") : null);
}

function formatLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (Array.isArray(v)) return `${v.length} items`;
  return JSON.stringify(v);
}

const PAYLOAD_SKIP = new Set(["containers", "docker_hint", "system", "Labels", "enrichment"]);

export function payloadDetailRows(ev: EventRow): { label: string; value: string }[] {
  const p = ev.payload;
  if (!p || Object.keys(p).length === 0) return [];

  const rows: { label: string; value: string }[] = [];

  for (const [key, value] of Object.entries(p)) {
    if (PAYLOAD_SKIP.has(key)) continue;
    const formatted = formatValue(value);
    if (formatted === "—" || formatted === "") continue;
    if (formatted.length > 200) {
      rows.push({ label: formatLabel(key), value: `${formatted.slice(0, 200)}…` });
    } else {
      rows.push({ label: formatLabel(key), value: formatted });
    }
  }

  if (ev.event_type === "watchpot.agent.infra_snapshot") {
    if (Array.isArray(p.containers)) {
      rows.unshift({ label: "Containers", value: `${p.containers.length} reported` });
    }
    if (typeof p.docker_ps_ok === "boolean") {
      rows.push({ label: "Docker ps", value: p.docker_ps_ok ? "OK" : "Failed" });
    }
    if (typeof p.docker_info_ok === "boolean") {
      rows.push({ label: "Docker info", value: p.docker_info_ok ? "OK" : "Failed" });
    }
    const host = str(p.hostname);
    if (host) rows.unshift({ label: "Hostname", value: host });
  }

  if (ev.service_name && !rows.some((r) => r.label === "Container")) {
    rows.unshift({ label: "Container", value: ev.service_name });
  }

  if (ev.stack_id) {
    rows.push({ label: "Stack", value: ev.stack_id.slice(0, 8) + "…" });
  }

  return rows;
}

export function isContainerLogEvent(ev: EventRow): boolean {
  return ev.event_type === "watchpot.agent.container_logs";
}

export function containerLabel(ev: EventRow): string | null {
  if (ev.service_name) return ev.service_name;
  const p = ev.payload as { container?: string } | null;
  return p?.container ?? null;
}

export function hasExpandableContent(ev: EventRow): boolean {
  return Boolean(
    ev.raw_log ||
      (ev.payload && Object.keys(ev.payload).length > 0) ||
      ev.stack_id ||
      ev.service_name,
  );
}
