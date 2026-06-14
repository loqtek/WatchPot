"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { fetchCachedContainerLogs } from "@/lib/container-logs";
import type { CachedContainerLogs } from "@/lib/container-logs";
import type { PotContainer, PotInfra } from "@/lib/types";
import { usePotCommand } from "@/hooks/use-pot-command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

type PotContainerLogsProps = {
  potId: string;
  potName?: string;
  autoLoad?: boolean;
};

export function PotContainerLogs({ potId, potName, autoLoad = true }: PotContainerLogsProps) {
  const { formatDateTime } = useFormatDateTime();
  const fetchInfra = useCallback(() => apiFetch<PotInfra>(`/pots/${potId}/infra`), [potId]);
  const { data: infra, loading, error, refetch } = useAsyncData(fetchInfra);
  const { runCommand } = usePotCommand(potId);

  const containers = infra?.containers ?? [];
  const running = containers.filter(
    (c) => c.state.toLowerCase().includes("running") || c.status.toLowerCase().startsWith("up"),
  );

  const [selected, setSelected] = useState<PotContainer | null>(null);
  const [logsText, setLogsText] = useState("");
  const [logSource, setLogSource] = useState<"cached" | "live" | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [tail, setTail] = useState(150);
  const [busy, setBusy] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);

  async function loadCached(c: PotContainer): Promise<boolean> {
    const id = encodeURIComponent(c.name || c.id);
    try {
      const hit = await apiFetch<CachedContainerLogs | { raw_log: string | null; received_at: string | null }>(
        `/pots/${potId}/containers/${id}/logs/cached`,
      );
      if (hit.raw_log) {
        setLogsText(hit.raw_log);
        setLogSource("cached");
        setCachedAt(hit.received_at ?? null);
        return true;
      }
    } catch {
      const fallback = await fetchCachedContainerLogs(potId, c.name || c.id);
      if (fallback?.raw_log) {
        setLogsText(fallback.raw_log);
        setLogSource("cached");
        setCachedAt(fallback.received_at);
        return true;
      }
    }
    return false;
  }

  async function fetchLogs(c: PotContainer, { liveOnly = false }: { liveOnly?: boolean } = {}) {
    setSelected(c);
    if (!liveOnly) {
      setBusy(true);
      const hadCache = await loadCached(c);
      setBusy(false);
      if (hadCache && !liveOnly) {
        setLiveBusy(true);
      } else if (!liveOnly) {
        setLogsText("");
        setLogSource(null);
        setLiveBusy(true);
      }
    } else {
      setLiveBusy(true);
    }

    try {
      const result = await runCommand({
        action: "logs",
        container: c.name || c.id,
        tail,
      });
      setLogsText(result.output || result.error || "(empty)");
      setLogSource("live");
      setCachedAt(new Date().toISOString());
      if (result.status === "failed") notify.error(result.error || "Failed to load logs");
    } catch (e) {
      if (!logsText) notify.apiError(e, "Failed to load logs");
    } finally {
      setLiveBusy(false);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoLoad || running.length === 0 || selected) return;
    void fetchLogs(running[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, running.length, infra?.snapshot_at]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-500" />
            Docker logs · {potName ?? "pot"}
          </CardTitle>
          <CardDescription>
            Shows cached logs from the event stream immediately, then refreshes live from the pot (agent command loop,
            typically a few seconds).
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy || liveBusy} onClick={() => void refetch()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Refresh list
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-zinc-500">Could not load container list.</p>
        ) : null}

        {loading && containers.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-zinc-500 text-sm">
            <Spinner />
            Loading containers…
          </div>
        ) : containers.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No containers reported yet. Deploy a stack on this pot and wait for the agent infra snapshot.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {containers.map((c) => (
                <button
                  key={c.id + c.name}
                  type="button"
                  onClick={() => void fetchLogs(c)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    selected?.name === c.name
                      ? "border-emerald-600/50 bg-emerald-500/10 text-emerald-200"
                      : "border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-zinc-700",
                  )}
                >
                  <span className="font-medium">{c.name || c.id}</span>
                  {c.stack_name ? (
                    <Badge tone="info" className="ml-2 normal-case tracking-normal">
                      {c.stack_name}
                    </Badge>
                  ) : null}
                  <span className="mt-0.5 block text-[10px] text-zinc-600 truncate max-w-[14rem]">{c.image}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div>
                <Label htmlFor="log-tail">Tail lines (live)</Label>
                <Input
                  id="log-tail"
                  type="number"
                  min={10}
                  max={5000}
                  value={tail}
                  onChange={(e) => setTail(Number(e.target.value) || 150)}
                  className="mt-1 w-24"
                />
              </div>
              {selected ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || liveBusy}
                  onClick={() => void fetchLogs(selected, { liveOnly: true })}
                >
                  {liveBusy ? <Spinner size="sm" className="mr-1" /> : null}
                  Fetch live
                </Button>
              ) : null}
              {logSource && cachedAt ? (
                <span className="text-xs text-zinc-500">
                  {logSource === "cached" && liveBusy
                    ? "Cached snapshot · fetching live…"
                    : logSource === "cached"
                      ? `Cached · ${formatDateTime(cachedAt)}`
                      : `Live · ${formatDateTime(cachedAt)}`}
                </span>
              ) : null}
            </div>

            <pre className="max-h-[min(28rem,50vh)] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-300 whitespace-pre-wrap">
              {busy && !logsText
                ? "Loading cached logs…"
                : liveBusy && !logsText
                  ? "Waiting for agent…"
                  : logsText || "Select a container to view logs."}
            </pre>
          </>
        )}
      </CardContent>
    </Card>
  );
}
