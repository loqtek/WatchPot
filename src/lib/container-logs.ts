import { apiFetch } from "@/lib/api";
import type { EventRow } from "@/lib/types";

export function normalizeContainerName(name: string): string {
  return name.replace(/^\//, "");
}

export function eventMatchesContainer(event: EventRow, container: string): boolean {
  const name = normalizeContainerName(container);
  const svc = normalizeContainerName(event.service_name ?? "");
  const payload = event.payload as { container?: string } | null;
  const pc = normalizeContainerName(payload?.container ?? "");
  return svc === name || pc === name || svc.includes(name) || name.includes(svc);
}

export type CachedContainerLogs = {
  container: string;
  raw_log: string;
  received_at: string;
  cached: boolean;
};

/** Latest ingested docker log tail from the agent event stream (instant, may be slightly stale). */
export async function fetchCachedContainerLogs(
  potId: string,
  container: string,
): Promise<CachedContainerLogs | null> {
  const name = normalizeContainerName(container);
  const events = await apiFetch<EventRow[]>(
    `/events?pot_id=${potId}&event_type_prefix=watchpot.agent.container_logs&limit=40&include_raw=true`,
  );
  const match = events.find((e) => eventMatchesContainer(e, name));
  if (!match?.raw_log) return null;
  return {
    container: name,
    raw_log: match.raw_log,
    received_at: match.received_at,
    cached: true,
  };
}
