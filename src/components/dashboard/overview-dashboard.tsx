"use client";

import { useCallback } from "react";
import Link from "next/link";
import {
  DistributionPie,
  HorizontalRankBar,
  TimeseriesLineChart,
} from "@/components/charts/monitoring-charts";
import { CHART_PALETTE } from "@/lib/chart-theme";
import { apiFetch } from "@/lib/api";
import { DASHBOARD_RANGES, type DashboardOverview } from "@/lib/dashboard-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { EventLogTable, TopPotsList } from "@/components/monitoring/widget-parts";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { cn } from "@/lib/utils";

type OverviewDashboardProps = {
  range: string;
  onRangeChange: (r: string) => void;
};

function StatCard({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string | number;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <Card className="rounded-xl">
      <CardContent className="px-3.5 py-3">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink", valueClassName)}>{value}</p>
        <p className="mt-0.5 truncate text-[11px] text-faint">{sub || "\u00a0"}</p>
      </CardContent>
    </Card>
  );
}

export function OverviewDashboard({ range, onRangeChange }: OverviewDashboardProps) {
  const { formatDateTime } = useFormatDateTime();
  const fetchDashboard = useCallback(
    () => apiFetch<DashboardOverview>(`/analytics/dashboard?range=${range}`),
    [range],
  );
  const { data: d, loading, error, refetch } = useAsyncData(fetchDashboard, { refreshInterval: 60_000 });

  const fleet = [...(d?.pots.rows ?? [])].sort((a, b) => Number(b.heartbeat_online) - Number(a.heartbeat_online));

  const delta = d?.comparison.delta ?? 0;
  const deltaPct = d?.comparison.delta_percent;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-ink">Overview</h1>
          {d ? (
            <p className="text-[11px] text-faint">
              {formatDateTime(d.since)} — {formatDateTime(d.until)} · heartbeat {d.heartbeat_stale_minutes}m · refresh 60s
            </p>
          ) : null}
        </div>
        <div className="seg shrink-0" role="group" aria-label="Period">
          {DASHBOARD_RANGES.map((r) => (
            <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => onRangeChange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2.5 text-sm text-zinc-500">
          <span>Could not load dashboard data.</span>
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      {loading && !d ? (
        <div className="flex items-center justify-center gap-2 py-20 text-zinc-500">
          <Spinner />
          Loading dashboard…
        </div>
      ) : d ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Events" value={d.events.total.toLocaleString()} sub={`${d.events.rate_per_hour}/hr avg`} />
            <StatCard
              label="vs prior"
              value={`${delta >= 0 ? "+" : ""}${delta.toLocaleString()}`}
              sub={
                deltaPct != null
                  ? `${deltaPct >= 0 ? "+" : ""}${deltaPct}% · ${d.comparison.previous_total.toLocaleString()} before`
                  : `${d.comparison.previous_total.toLocaleString()} before`
              }
              valueClassName={delta >= 0 ? "text-rose-400" : "text-emerald-500"}
            />
            <StatCard
              label="Pots live"
              value={`${d.pots.live}/${d.pots.total}`}
              sub={`${d.pots.offline} offline · ${d.pots.awaiting} awaiting`}
            />
            <StatCard
              label="Containers"
              value={`${d.containers.running}/${d.containers.total}`}
              sub={`${d.containers.stopped} stopped`}
            />
            <StatCard label="Stacks" value={d.stacks.total} sub={`${d.stacks.with_compose} with compose`} />
            <StatCard label="Rate" value={`${d.events.rate_per_hour}/hr`} sub="Average over this window" />
          </div>

          <div className="grid gap-3 lg:grid-cols-12">
            <Card className="rounded-xl lg:col-span-8">
              <CardHeader className="px-4 py-2">
                <CardTitle className="text-sm">Event volume</CardTitle>
              </CardHeader>
              <CardContent className="h-60 px-2 pb-2 pt-1">
                <TimeseriesLineChart points={d.timeseries.points} />
              </CardContent>
            </Card>
            <Card className="rounded-xl lg:col-span-4">
              <CardHeader className="px-4 py-2">
                <CardTitle className="text-sm">Severity</CardTitle>
              </CardHeader>
              <CardContent className="h-60 px-2 pb-2 pt-1">
                <DistributionPie items={d.events.by_severity} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="rounded-xl">
              <CardHeader className="px-4 py-2">
                <CardTitle className="text-sm">Top event types</CardTitle>
              </CardHeader>
              <CardContent className="h-64 px-3 pb-3 pt-2">
                <HorizontalRankBar items={d.events.by_event_type} color={CHART_PALETTE[1]} maxLabelWidth={120} />
              </CardContent>
            </Card>
            <Card className="rounded-xl">
              <CardHeader className="px-4 py-2">
                <CardTitle className="text-sm">Top pots by events</CardTitle>
              </CardHeader>
              <CardContent className="h-64 overflow-auto px-3 pb-3 pt-2">
                <TopPotsList items={d.top_pots} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 xl:grid-cols-12">
            <Card className="rounded-xl xl:col-span-4">
              <CardHeader className="flex flex-row items-center justify-between px-4 py-2">
                <CardTitle className="text-sm">Fleet</CardTitle>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
                  <Link href="/pots">All pots</Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {fleet.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted">No pots registered yet.</p>
                ) : (
                  <ul className="max-h-72 divide-y divide-line overflow-auto">
                    {fleet.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={`/pots/${p.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-2 transition-colors hover:bg-recessed"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                            <p className="text-[11px] text-faint">
                              {p.containers_running}/{p.containers_total} running
                            </p>
                          </div>
                          <Badge tone={p.heartbeat_online ? "success" : p.last_heartbeat_at ? "danger" : "warning"}>
                            {p.heartbeat_online ? "Live" : p.last_heartbeat_at ? "Offline" : "Awaiting"}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-xl xl:col-span-8">
              <CardHeader className="flex flex-row items-center justify-between px-4 py-2">
                <CardTitle className="text-sm">Recent events</CardTitle>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
                  <Link href="/events">Events</Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0 px-1 pb-1">
                <EventLogTable items={d.recent_events} maxHeight="18rem" />
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
