"use client";

import { FormEvent, useCallback, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ChevronRight,
  Container,
  FileCode2,
  ScrollText,
  KeyRound,
  Layers,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Pot, PotDeleteResult, Stack, StackDeleteResult } from "@/lib/types";
import { AgentKeyModal } from "@/components/pots/agent-key-modal";
import { PotContainersPanel } from "@/components/pots/pot-containers-panel";
import { PotEventsPanel } from "@/components/pots/pot-events-panel";
import { PotStatsPanel } from "@/components/pots/pot-stats-panel";
import { usePotCommand } from "@/hooks/use-pot-command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";

type TabId = "overview" | "containers" | "events" | "stacks";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "containers", label: "Containers", icon: Container },
  { id: "events", label: "Events", icon: ScrollText },
  { id: "stacks", label: "Stacks", icon: Layers },
];

function tabFromParam(value: string | null): TabId | null {
  if (value === "overview" || value === "containers" || value === "events" || value === "stacks") {
    return value;
  }
  return null;
}

export default function PotDetailPage() {
  const { formatDateTime } = useFormatDateTime();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const potId = params.potId as string;
  const tabParam = tabFromParam(searchParams.get("tab"));

  const fetchPot = useCallback(() => apiFetch<Pot>(`/pots/${potId}`), [potId]);
  const fetchStacks = useCallback(() => apiFetch<Stack[]>(`/pots/${potId}/stacks`), [potId]);

  const { data: pot, loading: potLoading, refetch: refetchPot } = useAsyncData(fetchPot);
  const { data: stacks, loading: stacksLoading, refetch: refetchStacks } = useAsyncData(fetchStacks);

  const [tab, setTab] = useState<TabId>(tabParam ?? "overview");
  const [prevTabParam, setPrevTabParam] = useState(tabParam);

  if (tabParam !== prevTabParam) {
    setPrevTabParam(tabParam);
    if (tabParam) setTab(tabParam);
  }

  function selectTab(next: TabId) {
    setTab(next);
    const url = next === "overview" ? `/pots/${potId}` : `/pots/${potId}?tab=${next}`;
    router.replace(url);
  }
  const [statsRange, setStatsRange] = useState("24h");
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [infraRefreshing, setInfraRefreshing] = useState(false);
  const [infraVersion, setInfraVersion] = useState(0);

  const { waitForCommand } = usePotCommand(potId);
  const list = stacks ?? [];

  function showMessage(text: string, ok = true) {
    if (ok) notify.success(text);
    else notify.error(text);
  }

  async function saveRename(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy("rename");
    try {
      await apiFetch(`/pots/${potId}`, { method: "PATCH", json: { name: newName.trim() } });
      setRenameOpen(false);
      await refetchPot();
      showMessage("Pot renamed");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Rename failed", false);
    } finally {
      setBusy(null);
    }
  }

  async function rotateAgentKey() {
    if (
      !confirm(
        "Generate a new agent key for this pot? The current key stops working immediately. Update the agent .env before continuing.",
      )
    ) {
      return;
    }
    setBusy("rotate-key");
    try {
      const res = await apiFetch<Pot & { agent_key: string }>(`/pots/${potId}/rotate-agent-key`, {
        method: "POST",
      });
      setRotatedKey(res.agent_key);
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Rotate key failed", false);
    } finally {
      setBusy(null);
    }
  }

  async function deletePot() {
    if (
      !confirm(
        "Delete this pot and all its stacks, revisions, and events? Running containers on the agent will be torn down first. This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy("delete-pot");
    try {
      await apiFetch<PotDeleteResult>(`/pots/${potId}`, { method: "DELETE" });
      router.push("/pots");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Delete failed", false);
    } finally {
      setBusy(null);
    }
  }

  async function restartStack(stackId: string) {
    setBusy(`restart-${stackId}`);
    try {
      await apiFetch<Stack>(`/pots/${potId}/stacks/${stackId}/restart`, { method: "POST" });
      await refetchStacks();
      showMessage("Restart signal sent — agent will re-apply compose on next poll.");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Restart failed", false);
    } finally {
      setBusy(null);
    }
  }

  async function deleteStack(stackId: string, stackName: string) {
    if (!confirm(`Delete stack “${stackName}”? Its Docker containers will be torn down on the pot.`)) return;
    setBusy(`del-${stackId}`);
    try {
      const res = await apiFetch<StackDeleteResult>(`/pots/${potId}/stacks/${stackId}`, { method: "DELETE" });
      if (res.teardown_command_id) {
        const cmd = await waitForCommand(res.teardown_command_id, 90_000);
        if (cmd.status === "failed") {
          showMessage(cmd.error || "Container teardown failed on the agent", false);
        }
      }
      await refetchStacks();
      await refreshInfra({ quiet: true });
      showMessage(res.teardown_command_id ? "Stack removed and containers torn down" : "Stack removed");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Delete stack failed", false);
    } finally {
      setBusy(null);
    }
  }

  async function refreshInfra(options?: { quiet?: boolean }) {
    setInfraRefreshing(true);
    try {
      const res = await apiFetch<{ command_id: string }>(`/pots/${potId}/refresh-infra`, { method: "POST" });
      await waitForCommand(res.command_id, 60_000);
      await refetchPot();
      setInfraVersion((v) => v + 1);
      if (!options?.quiet) showMessage("Docker snapshot refreshed");
    } catch (e) {
      if (!options?.quiet) showMessage(e instanceof Error ? e.message : "Refresh failed", false);
    } finally {
      setInfraRefreshing(false);
    }
  }

  return (
    <div className="space-y-8">
      <AgentKeyModal
        open={Boolean(rotatedKey)}
        agentKey={rotatedKey ?? ""}
        potId={potId}
        potName={pot?.name}
        onClose={() => setRotatedKey(null)}
      />
      <nav className="flex items-center gap-1 text-sm text-zinc-500" aria-label="Breadcrumb">
        <Link href="/pots" className="hover:text-emerald-400 transition-colors">
          Pots
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
        <span className="truncate text-zinc-400">{pot?.name ?? potId.slice(0, 8) + "…"}</span>
      </nav>

      {potLoading || !pot ? (
        <div className="flex items-center gap-2 py-16 text-zinc-500">
          <Spinner />
          Loading pot…
        </div>
      ) : (
        <>
          <PageHeader
            title={pot.name}
            description={
              pot.description ||
              "Honeypot host — monitor Docker, view logs, and control containers through the agent."
            }
            actions={
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link href={`/events?pot_id=${potId}`}>Events & logs</Link>
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={!!busy} onClick={() => void rotateAgentKey()}>
                  <KeyRound className="mr-1 h-3.5 w-3.5" />
                  Rotate key
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => {
                    setNewName(pot.name);
                    setRenameOpen((o) => !o);
                  }}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Rename
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-red-500/35 text-red-300 hover:bg-red-500/10"
                  disabled={!!busy}
                  onClick={() => void deletePot()}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            }
          />

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/25 px-4 py-3">
            {pot.heartbeat_online ? (
              <Badge tone="success">Agent live</Badge>
            ) : pot.last_heartbeat_at ? (
              <Badge tone="danger">Agent offline</Badge>
            ) : (
              <Badge tone="warning">Awaiting heartbeat</Badge>
            )}
            <span className="text-sm text-zinc-500">
              Last seen{" "}
              <span className="text-zinc-300 tabular-nums">
                {pot.last_heartbeat_at ? formatDateTime(pot.last_heartbeat_at) : "—"}
              </span>
            </span>
            {pot.last_ip ? (
              <span className="font-mono text-xs text-zinc-500">{pot.last_ip}</span>
            ) : null}
            {pot.agent_version ? <span className="text-xs text-zinc-600">agent {pot.agent_version}</span> : null}
          </div>

          {renameOpen ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Rename pot</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={(e) => void saveRename(e)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <Label htmlFor="rename">Name</Label>
                    <Input id="rename" value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1" />
                  </div>
                  <Button type="submit" disabled={busy === "rename"}>
                    {busy === "rename" ? <Spinner size="sm" className="mr-2" /> : null}
                    Save
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-1 border-b border-zinc-800/80 pb-px">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTab(t.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px",
                  tab === t.id
                    ? "border-emerald-500 text-emerald-300"
                    : "border-transparent text-zinc-500 hover:text-zinc-300",
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" ? (
            <div className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Host</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>
                      <span className="text-zinc-500">UUID </span>
                      <span className="font-mono text-xs text-zinc-400 break-all">{pot.id}</span>
                    </p>
                    {pot.meta && typeof pot.meta === "object" ? (
                      <>
                        {(pot.meta as { infra_snapshot?: { hostname?: string } }).infra_snapshot?.hostname ? (
                          <p>
                            <span className="text-zinc-500">Hostname </span>
                            <span className="text-zinc-200">
                              {(pot.meta as { infra_snapshot?: { hostname?: string } }).infra_snapshot?.hostname}
                            </span>
                          </p>
                        ) : null}
                        {"docker_ok" in pot.meta ? (
                          <p>
                            <span className="text-zinc-500">Docker </span>
                            <span className="text-zinc-200">
                              {(pot.meta as { docker_ok?: boolean }).docker_ok ? "reachable" : "unreachable"}
                            </span>
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Agent meta</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!pot.meta || Object.keys(pot.meta).length === 0 ? (
                      <p className="text-sm text-zinc-500">No meta yet.</p>
                    ) : (
                      <pre className="max-h-40 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300">
                        {JSON.stringify(pot.meta, null, 2)}
                      </pre>
                    )}
                  </CardContent>
                </Card>
              </div>
              <PotStatsPanel
                pot={pot}
                range={statsRange}
                onRangeChange={setStatsRange}
                onRefreshInfra={() => void refreshInfra()}
                infraRefreshing={infraRefreshing}
              />
            </div>
          ) : null}

          {tab === "containers" ? (
            <PotContainersPanel
              potId={potId}
              stacks={list}
              potOnline={pot.heartbeat_online}
              infraVersion={infraVersion}
              onMessage={(text, ok) => showMessage(text, ok ?? true)}
              onRefreshInfra={() => void refreshInfra()}
              infraRefreshing={infraRefreshing}
            />
          ) : null}

          {tab === "events" ? <PotEventsPanel potId={potId} /> : null}

          {tab === "stacks" ? (
            <section className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-100">Docker stacks</h2>
                  <p className="text-sm text-zinc-500">
                    Versioned compose definitions. Use Containers for logs and start/stop, or restart here to re-apply
                    YAML.
                  </p>
                </div>
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/pots/${potId}/stacks/new`}>Deploy stack</Link>
                </Button>
              </div>

              {stacksLoading ? (
                <div className="flex items-center gap-2 py-12 text-zinc-500">
                  <Spinner />
                  Loading stacks…
                </div>
              ) : list.length === 0 ? (
                <Card className="border-dashed border-zinc-700/80">
                  <CardContent className="py-12 text-center text-sm text-zinc-500">
                    No stacks yet.{" "}
                    <Link href={`/pots/${potId}/stacks/new`} className="text-emerald-400 hover:underline">
                      Deploy from catalog
                    </Link>
                    .
                  </CardContent>
                </Card>
              ) : (
                <ul className="space-y-3">
                  {list.map((s) => (
                    <li key={s.id} className="rounded-2xl border border-zinc-800/90 bg-zinc-900/20 p-4 sm:p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium text-zinc-100">{s.name}</p>
                          {s.description ? <p className="text-sm text-zinc-500">{s.description}</p> : null}
                          <p className="font-mono text-[11px] text-zinc-500">{s.id}</p>
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Badge tone="info">rev {s.latest_revision ?? "—"}</Badge>
                            <Badge tone="default">restart gen {s.restart_generation ?? 0}</Badge>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="secondary" size="sm" asChild>
                            <Link href={`/pots/${potId}/stacks/${s.id}`}>
                              <FileCode2 className="mr-1 h-3.5 w-3.5" />
                              Compose
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!!busy}
                            onClick={() => void restartStack(s.id)}
                          >
                            {busy === `restart-${s.id}` ? (
                              <Spinner size="sm" className="mr-1" />
                            ) : (
                              <RefreshCw className="mr-1 h-3.5 w-3.5" />
                            )}
                            Re-apply
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-red-500/30 text-red-300 hover:bg-red-500/10"
                            disabled={!!busy}
                            onClick={() => void deleteStack(s.id, s.name)}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
