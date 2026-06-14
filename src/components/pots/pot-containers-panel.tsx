"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Box,
  ChevronDown,
  FileCode2,
  FileText,
  Layers,
  Play,
  RotateCw,
  Square,
  Terminal,
  Trash2,
  RefreshCw,
  Circle,
  ChevronRight,
  WrapText,
  AlignJustify,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { fetchCachedContainerLogs } from "@/lib/container-logs";
import {
  CONTAINER_STATUS_LABELS,
  STACK_STATUS_LABELS,
  classifyContainer,
  groupWorkload,
  type ContainerRuntimeStatus,
  type StackWorkloadStatus,
} from "@/lib/pot-workload";
import type { PotContainer, PotInfra, Stack } from "@/lib/types";
import { usePotCommand } from "@/hooks/use-pot-command";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/ui/data-table";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { cn } from "@/lib/utils";

type PotContainersPanelProps = {
  potId: string;
  stacks: Stack[];
  potOnline: boolean;
  infraVersion?: number;
  onMessage: (msg: string, ok?: boolean) => void;
  onRefreshInfra?: () => void;
  infraRefreshing?: boolean;
};

type StatusFilter = "all" | ContainerRuntimeStatus;
type ViewMode = "stacks" | "table";

function stackTone(s: StackWorkloadStatus): "success" | "warning" | "danger" | "info" | "default" {
  switch (s) {
    case "up":
      return "success";
    case "partial":
      return "warning";
    case "down":
      return "danger";
    case "ready":
      return "info";
    default:
      return "default";
  }
}

function containerTone(s: ContainerRuntimeStatus): "success" | "warning" | "danger" | "default" {
  switch (s) {
    case "running":
      return "success";
    case "paused":
      return "warning";
    case "stopped":
      return "default";
    default:
      return "danger";
  }
}

function StatusDot({ tone }: { tone: "success" | "warning" | "danger" | "info" | "default" }) {
  const colors = {
    success: "bg-emerald-500 shadow-emerald-500/50",
    warning: "bg-amber-500 shadow-amber-500/50",
    danger: "bg-red-500 shadow-red-500/50",
    info: "bg-sky-500 shadow-sky-500/50",
    default: "bg-zinc-500 shadow-zinc-500/50",
  };
  return <span className={cn("inline-block h-2 w-2 rounded-full shadow-sm", colors[tone])} aria-hidden />;
}

function SummaryTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "success" | "warning" | "danger" | "info" | "default";
}) {
  return (
    <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/40 px-4 py-3 min-w-[7rem]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-xl font-semibold tabular-nums text-zinc-100">
        {tone ? <StatusDot tone={tone} /> : null}
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-[11px] text-zinc-600">{sub}</p> : null}
    </div>
  );
}

export function PotContainersPanel({
  potId,
  stacks,
  potOnline,
  infraVersion = 0,
  onMessage,
  onRefreshInfra,
  infraRefreshing,
}: PotContainersPanelProps) {
  const { formatTime } = useFormatDateTime();
  const fetchInfra = useCallback(
    () => apiFetch<PotInfra>(`/pots/${potId}/infra?bust=${infraVersion}`),
    [potId, infraVersion],
  );
  const { data: infra, loading, refetch } = useAsyncData(fetchInfra);
  const { runCommand, waitForCommand, infraRefreshActions } = usePotCommand(potId);

  const [busy, setBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("stacks");
  const [collapsedStacks, setCollapsedStacks] = useState<Record<string, boolean>>({});

  const [selected, setSelected] = useState<PotContainer | null>(null);
  const [logsText, setLogsText] = useState("");
  const [logsTail, setLogsTail] = useState(150);
  const [shellContainer, setShellContainer] = useState<PotContainer | null>(null);
  const [shellCmd, setShellCmd] = useState("id && uname -a");
  const [logWrap, setLogWrap] = useState(true);

  const containers = useMemo(() => infra?.containers ?? [], [infra?.containers]);
  const workload = useMemo(() => groupWorkload(stacks, containers), [stacks, containers]);

  const filteredContainers = useMemo(() => {
    if (statusFilter === "all") return containers;
    return containers.filter((c) => classifyContainer(c) === statusFilter);
  }, [containers, statusFilter]);

  const filteredGroups = useMemo(() => {
    return workload.groups
      .map((g) => ({
        ...g,
        containers:
          statusFilter === "all"
            ? g.containers
            : g.containers.filter((c) => classifyContainer(c) === statusFilter),
      }))
      .filter((g) => statusFilter === "all" || g.containers.length > 0 || g.status === "ready" || g.status === "draft");
  }, [workload.groups, statusFilter]);

  async function doAction(
    key: string,
    body: { action: string; container?: string; stack_id?: string; tail?: number; command?: string },
  ) {
    setBusy(key);
    try {
      const result = await runCommand(body);
      if (result.status === "failed") {
        onMessage(result.error || result.output || "Command failed", false);
        return result;
      }
      if (infraRefreshActions.has(body.action)) {
        try {
          const res = await apiFetch<{ command_id: string }>(`/pots/${potId}/refresh-infra`, { method: "POST" });
          await waitForCommand(res.command_id, 60_000);
        } catch {
          /* agent may have already posted a fresh snapshot */
        }
      }
      await refetch();
      onMessage(`${body.action} completed`, true);
      return result;
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Command failed", false);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function refreshSnapshot() {
    if (onRefreshInfra) {
      onRefreshInfra();
      return;
    }
    setBusy("infra");
    try {
      const res = await apiFetch<{ command_id: string }>(`/pots/${potId}/refresh-infra`, { method: "POST" });
      await waitForCommand(res.command_id, 60_000);
      await refetch();
      onMessage("Docker snapshot updated", true);
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Refresh failed", false);
    } finally {
      setBusy(null);
    }
  }

  async function showLogs(c: PotContainer) {
    setSelected(c);
    setShellContainer(null);
    setBusy(`logs-${c.id}`);
    let shown = "";
    const id = encodeURIComponent(c.name || c.id);
    try {
      const cached = await apiFetch<{ raw_log: string | null }>(
        `/pots/${potId}/containers/${id}/logs/cached`,
      ).catch(() => fetchCachedContainerLogs(potId, c.name || c.id));
      if (cached?.raw_log) {
        shown = cached.raw_log;
        setLogsText(shown);
      }
    } catch {
      /* ignore */
    }
    try {
      const result = await runCommand({ action: "logs", container: c.name || c.id, tail: logsTail });
      setLogsText(result.output || result.error || shown || "(empty)");
    } catch (e) {
      if (!shown) setLogsText(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      setBusy(null);
    }
  }

  function clearContainerSelection(c: PotContainer) {
    const key = c.name || c.id;
    if (selected && (selected.name === key || selected.id === c.id)) {
      setSelected(null);
      setLogsText("");
    }
    if (shellContainer && (shellContainer.name === key || shellContainer.id === c.id)) {
      setShellContainer(null);
    }
  }

  async function deleteContainer(c: PotContainer) {
    const name = c.name || c.id;
    const rt = classifyContainer(c);
    const running = rt === "running";
    const stackNote = c.stack_name
      ? ` It belongs to stack “${c.stack_name}”.`
      : "";
    if (
      !confirm(
        `Delete container "${name}"?${stackNote}${running ? " It will be force-stopped and removed from Docker." : " This permanently removes it from Docker."}`,
      )
    ) {
      return;
    }
    const result = await doAction(`rm-${c.id}`, { action: "rm", container: name });
    if (result?.status === "completed") clearContainerSelection(c);
  }

  function ContainerActions({ c, compact }: { c: PotContainer; compact?: boolean }) {
    const rt = classifyContainer(c);
    const isRunning = rt === "running";
    return (
      <div className={cn("flex flex-wrap gap-1", compact && "justify-end")}>
        <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => void showLogs(c)} title="Logs">
          {busy === `logs-${c.id}` ? <Spinner size="sm" /> : <FileText className="h-3.5 w-3.5" />}
          {!compact ? <span className="ml-1">Logs</span> : null}
        </Button>
        {!isRunning ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!!busy}
            onClick={() => void doAction(`start-${c.id}`, { action: "start", container: c.name || c.id })}
            title="Start"
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!!busy}
            onClick={() => void doAction(`stop-${c.id}`, { action: "stop", container: c.name || c.id })}
            title="Stop"
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!!busy}
          onClick={() => void doAction(`restart-${c.id}`, { action: "restart", container: c.name || c.id })}
          title="Restart"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!!busy}
          onClick={() => {
            setShellContainer(c);
            setSelected(c);
          }}
          title="Shell"
        >
          <Terminal className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!!busy}
          onClick={() => void deleteContainer(c)}
          title="Delete container"
          className="text-red-400/90 hover:text-red-300 hover:bg-red-500/10"
        >
          {busy === `rm-${c.id}` ? <Spinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
          {!compact ? <span className="ml-1">Delete</span> : null}
        </Button>
      </div>
    );
  }

  function ContainerRow({ c }: { c: PotContainer }) {
    const rt = classifyContainer(c);
    const active = selected?.name === c.name;
    return (
      <Tr
        className={cn("cursor-pointer", active && "bg-emerald-500/5")}
        onClick={() => void showLogs(c)}
      >
        <Td>
          <div className="flex items-center gap-2">
            <StatusDot tone={containerTone(rt)} />
            <span className="font-medium text-zinc-200">{c.name || c.id}</span>
          </div>
        </Td>
        <Td className="max-w-[10rem] truncate text-xs text-zinc-500">{c.image}</Td>
        <Td className="text-xs text-zinc-500 max-w-[8rem] truncate">{c.ports || "—"}</Td>
        <Td>
          <Badge tone={containerTone(rt)} className="normal-case tracking-normal">
            {CONTAINER_STATUS_LABELS[rt]}
          </Badge>
        </Td>
        <Td onClick={(e) => e.stopPropagation()}>
          <ContainerActions c={c} compact />
        </Td>
      </Tr>
    );
  }

  return (
    <div className="space-y-6">
      {!potOnline ? (
        <Alert variant="warning">Agent offline — status may be stale; commands queue until reconnect.</Alert>
      ) : null}

      {/* Summary */}
      <div className="flex flex-wrap gap-3">
        <SummaryTile label="Running" value={workload.counts.running} tone="success" />
        <SummaryTile label="Stopped" value={workload.counts.stopped} tone="default" />
        <SummaryTile
          label="Stacks up"
          value={workload.stackCounts.up}
          sub={`${workload.stackCounts.partial} partial · ${workload.stackCounts.ready} ready`}
          tone="success"
        />
        <SummaryTile
          label="Stacks down"
          value={workload.stackCounts.down}
          sub={`${stacks.length} defined`}
          tone={workload.stackCounts.down > 0 ? "danger" : "default"}
        />
        <SummaryTile label="Containers" value={workload.counts.total} sub="on this pot" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500 mr-1">Show</span>
          {(["all", "running", "stopped", "paused", "other"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                statusFilter === f
                  ? "border-emerald-600/50 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-800 text-zinc-500 hover:border-zinc-700",
              )}
            >
              {f === "all" ? "All" : CONTAINER_STATUS_LABELS[f]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-zinc-800 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("stacks")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                viewMode === "stacks" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500",
              )}
            >
              By stack
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                viewMode === "table" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500",
              )}
            >
              All containers
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!!busy || infraRefreshing}
            onClick={() => void (onRefreshInfra ? onRefreshInfra() : refreshSnapshot())}
          >
            {busy === "infra" || infraRefreshing ? <Spinner size="sm" className="mr-1" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            Refresh status
          </Button>
          {infra?.snapshot_at ? (
            <span className="text-[11px] text-zinc-600 tabular-nums">
              {formatTime(infra.snapshot_at)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-4 w-full">
          {loading && containers.length === 0 ? (
            <div className="flex items-center gap-2 py-16 text-zinc-500 justify-center">
              <Spinner />
              Loading from agent…
            </div>
          ) : stacks.length === 0 && containers.length === 0 ? (
            <Card className="border-dashed border-zinc-700/80">
              <CardContent className="py-14 text-center space-y-3">
                <Layers className="h-10 w-10 mx-auto text-zinc-600" />
                <p className="text-sm text-zinc-500">No stacks or containers yet.</p>
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/pots/${potId}/stacks/new`}>Deploy a stack</Link>
                </Button>
              </CardContent>
            </Card>
          ) : viewMode === "table" ? (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <Th>Container</Th>
                    <Th>Image</Th>
                    <Th>Ports</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </THead>
                <TBody>
                  {filteredContainers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-500">
                        No containers match this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredContainers.map((c) => <ContainerRow key={c.id + c.name} c={c} />)
                  )}
                </TBody>
              </Table>
            </TableWrap>
          ) : (
            <>
              {filteredGroups.map((g) => {
                const collapsed = collapsedStacks[g.stack.id];
                const st = g.status;
                return (
                  <Card key={g.stack.id} className="overflow-hidden">
                    <div className="flex flex-col gap-3 border-b border-zinc-800/80 bg-zinc-900/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        onClick={() =>
                          setCollapsedStacks((prev) => ({ ...prev, [g.stack.id]: !prev[g.stack.id] }))
                        }
                      >
                        {collapsed ? (
                          <ChevronRight className="h-5 w-5 shrink-0 text-zinc-500" />
                        ) : (
                          <ChevronDown className="h-5 w-5 shrink-0 text-zinc-500" />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusDot tone={stackTone(st)} />
                            <span className="font-semibold text-zinc-100">{g.stack.name}</span>
                            <Badge tone={stackTone(st)}>{STACK_STATUS_LABELS[st]}</Badge>
                            <Badge tone="info" className="normal-case tracking-normal font-mono text-[10px]">
                              rev {g.stack.latest_revision ?? "—"}
                            </Badge>
                            <span className="text-xs text-zinc-500">
                              {g.containers.length} container{g.containers.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          {st === "ready" && (
                            <p className="mt-1 text-xs text-zinc-500">
                              Compose defined — run <strong className="text-zinc-400">Up</strong> to start on the pot.
                            </p>
                          )}
                          {st === "draft" && (
                            <p className="mt-1 text-xs text-amber-500/90">Push compose YAML before deploy.</p>
                          )}
                        </div>
                      </button>
                      <div className="flex flex-wrap gap-1.5 shrink-0">
                        <Button type="button" variant="secondary" size="sm" asChild>
                          <Link href={`/pots/${potId}/stacks/${g.stack.id}`}>
                            <FileCode2 className="mr-1 h-3.5 w-3.5" />
                            Compose
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!!busy || !g.stack.latest_revision}
                          onClick={() => void doAction(`up-${g.stack.id}`, { action: "compose_start", stack_id: g.stack.id })}
                        >
                          <Play className="mr-1 h-3.5 w-3.5" />
                          Up
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => void doAction(`stop-${g.stack.id}`, { action: "compose_stop", stack_id: g.stack.id })}
                        >
                          <Square className="mr-1 h-3.5 w-3.5" />
                          Stop
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() =>
                            void doAction(`restart-${g.stack.id}`, { action: "compose_restart", stack_id: g.stack.id })
                          }
                        >
                          <RotateCw className="mr-1 h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {!collapsed ? (
                      <CardContent className="p-0">
                        {g.containers.length === 0 ? (
                          <p className="px-4 py-6 text-sm text-zinc-500 text-center">
                            {st === "ready" ? "No containers running — use Up to deploy." : "No matching containers."}
                          </p>
                        ) : (
                          <TableWrap className="rounded-none border-0 border-t border-zinc-800/80">
                            <Table>
                              <THead>
                                <tr>
                                  <Th>Service</Th>
                                  <Th>Image</Th>
                                  <Th>Ports</Th>
                                  <Th>Status</Th>
                                  <Th className="text-right">Actions</Th>
                                </tr>
                              </THead>
                              <TBody>
                                {g.containers.map((c) => (
                                  <ContainerRow key={c.id + c.name} c={c} />
                                ))}
                              </TBody>
                            </Table>
                          </TableWrap>
                        )}
                      </CardContent>
                    ) : null}
                  </Card>
                );
              })}

              {workload.orphan.length > 0 && statusFilter === "all" ? (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Box className="h-4 w-4 text-zinc-500" />
                      Other containers
                    </CardTitle>
                    <CardDescription>Not linked to a watchPot stack project.</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <TableWrap className="rounded-none border-0 border-t border-zinc-800/80">
                      <Table>
                        <TBody>
                          {workload.orphan.map((c) => (
                            <ContainerRow key={c.id + c.name} c={c} />
                          ))}
                        </TBody>
                      </Table>
                    </TableWrap>
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}
        </div>

        {/* Log / shell sidebar — wider, horizontally resizable on desktop */}
        <div
          className={cn(
            "w-full shrink-0 xl:sticky xl:top-20 xl:max-w-[58vw]",
            "xl:min-w-[22rem] xl:w-[34rem] xl:resize-x xl:overflow-auto xl:pr-1",
          )}
        >
          <Card className="h-fit min-w-0 w-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm truncate">
                {shellContainer ? `Shell · ${shellContainer.name}` : selected ? `Logs · ${selected.name}` : "Logs & shell"}
              </CardTitle>
              <CardDescription>
                {selected || shellContainer
                  ? "Click another container row to switch logs."
                  : "Click a container row or Logs to load docker output."}
              </CardDescription>
              <p className="text-[10px] text-zinc-600 pt-1 hidden xl:block">
                Drag the left edge of this panel to widen · drag the log box corner to resize height
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {(selected || shellContainer) && !shellContainer ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor="log-tail-lines" className="sr-only">
                      Tail lines
                    </Label>
                    <Input
                      id="log-tail-lines"
                      type="number"
                      min={10}
                      max={2000}
                      value={logsTail}
                      onChange={(e) => setLogsTail(Number(e.target.value) || 150)}
                      className="h-8 w-20 text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!!busy}
                      onClick={() => selected && void showLogs(selected)}
                    >
                      Refresh
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={logWrap ? "secondary" : "outline"}
                      onClick={() => setLogWrap(true)}
                      title="Wrap long lines"
                    >
                      <WrapText className="h-3.5 w-3.5" />
                      <span className="ml-1">Wrap</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={!logWrap ? "secondary" : "outline"}
                      onClick={() => setLogWrap(false)}
                      title="No wrap — scroll horizontally"
                    >
                      <AlignJustify className="h-3.5 w-3.5" />
                      <span className="ml-1">No wrap</span>
                    </Button>
                  </div>
                  <pre
                    className={cn(
                      "min-h-[14rem] h-[min(36rem,58vh)] resize-y overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300",
                      logWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
                    )}
                  >
                    {busy?.startsWith("logs-") && !logsText ? "Loading…" : logsText || "—"}
                  </pre>
                </>
              ) : shellContainer ? (
                <>
                  <Textarea
                    rows={3}
                    value={shellCmd}
                    onChange={(e) => setShellCmd(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy("shell");
                      try {
                        const result = await runCommand({
                          action: "exec",
                          container: shellContainer.name || shellContainer.id,
                          command: shellCmd,
                        });
                        setLogsText(result.output || result.error || "");
                        setShellContainer(null);
                      } catch (e) {
                        onMessage(e instanceof Error ? e.message : "Exec failed", false);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Run
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShellContainer(null)}>
                    Back to logs
                  </Button>
                </>
              ) : (
                <div className="flex flex-col items-center py-10 text-zinc-600">
                  <Circle className="h-8 w-8 mb-2 opacity-40" />
                  <p className="text-xs text-center text-zinc-500">No container selected</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
