"use client";

import { useCallback } from "react";
import { Activity, Container, Layers, Server } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Pot, PotStats } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { cn } from "@/lib/utils";

const RANGES = ["1h", "24h", "7d"] as const;

type PotStatsPanelProps = {
  pot: Pot;
  range: string;
  onRangeChange: (r: string) => void;
  onRefreshInfra?: () => void;
  infraRefreshing?: boolean;
};

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <Icon className="h-4 w-4 text-zinc-600" aria-hidden />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">{value}</p>
      {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

export function PotStatsPanel({ pot, range, onRangeChange, onRefreshInfra, infraRefreshing }: PotStatsPanelProps) {
  const { formatDateTime } = useFormatDateTime();
  const fetchStats = useCallback(
    () => apiFetch<PotStats>(`/pots/${pot.id}/stats?range=${range}`),
    [pot.id, range],
  );
  const { data: stats, loading, error, refetch } = useAsyncData(fetchStats);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRangeChange(r)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                range === r
                  ? "border-emerald-600/50 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-800 text-zinc-500 hover:border-zinc-700",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {onRefreshInfra ? (
            <Button type="button" variant="outline" size="sm" disabled={infraRefreshing} onClick={onRefreshInfra}>
              {infraRefreshing ? <Spinner size="sm" className="mr-1" /> : null}
              Refresh Docker snapshot
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => void refetch()}>
            Reload stats
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {loading && !stats ? (
        <div className="flex items-center gap-2 py-8 text-zinc-500">
          <Spinner />
          Loading stats…
        </div>
      ) : stats ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Events"
              value={stats.events_total}
              sub={`${stats.events_per_hour}/hr · ${stats.range}`}
              icon={Activity}
            />
            <StatTile
              label="Stacks"
              value={stats.stacks_total}
              sub={`${stats.stacks_with_revision} with compose`}
              icon={Layers}
            />
            <StatTile
              label="Containers"
              value={`${stats.containers_running}/${stats.containers_total}`}
              sub="running / reported"
              icon={Container}
            />
            <StatTile
              label="Docker"
              value={stats.docker_ok === true ? "OK" : stats.docker_ok === false ? "Down" : "—"}
              sub={stats.hostname ?? pot.last_ip ?? "no hostname"}
              icon={Server}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Severity mix</CardTitle>
                <CardDescription>Runtime + infra events in range.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.by_severity.length === 0 ? (
                  <p className="text-sm text-zinc-500">No events in this window.</p>
                ) : (
                  stats.by_severity.map((row) => {
                    const label = "label" in row ? String(row.label) : String((row as { key: string }).key);
                    const count = row.count;
                    const pct = stats.events_total ? Math.round((count / stats.events_total) * 100) : 0;
                    return (
                      <div key={label}>
                        <div className="flex justify-between text-xs text-zinc-400">
                          <span>{label}</span>
                          <span className="tabular-nums">
                            {count} ({pct}%)
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                          <div className="h-full rounded-full bg-emerald-600/70" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top event types</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {stats.by_event_type.length === 0 ? (
                  <p className="text-sm text-zinc-500">—</p>
                ) : (
                  stats.by_event_type.map((row) => {
                    const label = "label" in row ? String(row.label) : String((row as { key: string }).key);
                    return (
                      <Badge key={label} tone="default" className="normal-case tracking-normal font-mono text-[10px]">
                        {label} · {row.count}
                      </Badge>
                    );
                  })
                )}
              </CardContent>
            </Card>

            {stats.events_by_stack.length > 0 ? (
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Events by stack</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {stats.events_by_stack.map((row) => (
                      <li key={row.stack_id} className="flex justify-between gap-4">
                        <span className="text-zinc-300">{row.stack_name}</span>
                        <span className="tabular-nums text-zinc-500">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {stats.infra_at ? (
            <p className="text-xs text-zinc-600">
              Docker snapshot: {formatDateTime(stats.infra_at)}
              {pot.meta && typeof pot.meta === "object" && "docker_hint" in pot.meta ? (
                <span className="ml-2 font-mono text-zinc-500">{String(pot.meta.docker_hint).slice(0, 80)}</span>
              ) : null}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
