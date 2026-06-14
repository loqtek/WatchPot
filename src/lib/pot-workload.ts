import type { PotContainer, Stack } from "@/lib/types";

export type ContainerRuntimeStatus = "running" | "stopped" | "paused" | "other";

export type StackWorkloadStatus = "up" | "partial" | "down" | "ready" | "draft";

export type StackGroup = {
  stack: Stack;
  containers: PotContainer[];
  status: StackWorkloadStatus;
};

export function classifyContainer(c: PotContainer): ContainerRuntimeStatus {
  const s = `${c.state} ${c.status}`.toLowerCase();
  if (s.includes("running") || s.startsWith("up ") || s.includes(" up")) return "running";
  if (s.includes("paused")) return "paused";
  if (s.includes("exited") || s.includes("dead") || s.includes("created") || s.includes("stopped")) return "stopped";
  return "other";
}

export function classifyStack(stack: Stack, containers: PotContainer[]): StackWorkloadStatus {
  if (!stack.latest_revision) return "draft";
  if (containers.length === 0) return "ready";
  const statuses = containers.map(classifyContainer);
  const running = statuses.filter((x) => x === "running").length;
  if (running === containers.length) return "up";
  if (running === 0) return "down";
  return "partial";
}

export function groupWorkload(stacks: Stack[], containers: PotContainer[]): {
  groups: StackGroup[];
  orphan: PotContainer[];
  counts: { running: number; stopped: number; paused: number; other: number; total: number };
  stackCounts: { up: number; partial: number; down: number; ready: number; draft: number };
} {
  const assigned = new Set<string>();
  const groups: StackGroup[] = stacks.map((stack) => {
    const mine = containers.filter((c) => c.stack_id === stack.id);
    mine.forEach((c) => assigned.add(c.id + c.name));
    return { stack, containers: mine, status: classifyStack(stack, mine) };
  });

  const orphan = containers.filter((c) => !assigned.has(c.id + c.name));

  const counts = { running: 0, stopped: 0, paused: 0, other: 0, total: containers.length };
  for (const c of containers) {
    const k = classifyContainer(c);
    counts[k] += 1;
  }

  const stackCounts = { up: 0, partial: 0, down: 0, ready: 0, draft: 0 };
  for (const g of groups) stackCounts[g.status] += 1;

  return { groups, orphan, counts, stackCounts };
}

export const STACK_STATUS_LABELS: Record<StackWorkloadStatus, string> = {
  up: "Up",
  partial: "Partial",
  down: "Down",
  ready: "Ready",
  draft: "No revision",
};

export const CONTAINER_STATUS_LABELS: Record<ContainerRuntimeStatus, string> = {
  running: "Running",
  stopped: "Stopped",
  paused: "Paused",
  other: "Other",
};
