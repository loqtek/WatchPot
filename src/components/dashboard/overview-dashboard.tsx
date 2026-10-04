"use client";

import { useCallback } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Box,
  Container,
  Layers,
  Server,
  Shield,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  DistributionPie,
  HorizontalRankBar,
  SeverityBreakdownBars,
  TimeseriesLineChart,
} from "@/components/charts/monitoring-charts";
import { CHART_PALETTE } from "@/lib/chart-theme";
import { apiFetch } from "@/lib/api";
import { DASHBOARD_RANGES, type DashboardOverview } from "@/lib/dashboard-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "emerald" | "sky" | "amber" | "zinc";
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[13px] font-medium text-muted">{label}</p>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-chip text-ink">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        </div>
        <p className="mt-3 text-[1.75rem] font-semibold tabular-nums tracking-[-0.03em] text-ink">{value}</p>
        {sub ? <p className="mt-1 text-xs text-faint">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function PotList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: DashboardOverview["pots"]["rows"];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="py-4 text-sm text-zinc-500">{empty}</p>;
  }
  return (
    <div>
      <p className="px-4 pt-3 text-xs font-medium text-faint">{title}</p>
      <ul className="divide-y divide-black/[0.06]">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              href={`/pots/${p.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-recessed"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-100">{p.name}</p>
                <p className="text-[11px] text-zinc-500">
                  {p.containers_running}/{p.containers_total} containers running
                </p>
              </div>
              <Badge tone={p.heartbeat_online ? "success" : p.last_heartbeat_at ? "danger" : "warning"}>
                {p.heartbeat_online ? "Live" : p.last_heartbeat_at ? "Offline" : "Awaiting"}
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OverviewDashboard({ range, onRangeChange }: OverviewDashboardProps) {
  const { formatDateTime } = useFormatDateTime();
  const fetchDashboard = useCallback(
    () => apiFetch<DashboardOverview>(`/analytics/dashboard?range=${range}`),
    [range],
  );
  const { data: d, loading, error, refetch } = useAsyncData(fetchDashboard, { refreshInterval: 60_000 });

  const livePots = d?.pots.rows.filter((p) => p.heartbeat_online) ?? [];
  const inactivePots = d?.pots.rows.filter((p) => !p.heartbeat_online) ?? [];

  const delta = d?.comparison.delta ?? 0;
  const deltaPct = d?.comparison.delta_percent;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          title="Overview"
          description="Fleet health, honeypot activity, and security event telemetry across your deployment."
        />
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
            <span>
              {formatDateTime(d.since)} — {formatDateTime(d.until)}
            </span>
            <span>·</span>
            <span>Pots live if heartbeat within {d.heartbeat_stale_minutes}m</span>
            <span>·</span>
            <span className="flex items-center gap-1 text-emerald-600/80">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Auto-refresh 60s
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <StatCard
              label="Events"
              value={d.events.total.toLocaleString()}
              sub={`${d.events.rate_per_hour}/hr avg`}
              icon={Activity}
              tone="emerald"
            />
            <StatCard
              label="Pots live"
              value={`${d.pots.live}/${d.pots.total}`}
              sub={`${d.pots.offline} offline · ${d.pots.awaiting} awaiting`}
              icon={Server}
              tone="sky"
            />
            <StatCard
              label="Containers"
              value={`${d.containers.running}/${d.containers.total}`}
              sub={`${d.containers.stopped} stopped`}
              icon={Container}
              tone="emerald"
            />
            <StatCard
              label="Stacks"
              value={d.stacks.total}
              sub={`${d.stacks.with_compose} with compose`}
              icon={Layers}
              tone="zinc"
            />
            <Card className="sm:col-span-2 lg:col-span-2">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <p className="text-[13px] font-medium text-muted">vs prior period</p>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-chip text-ink">
                    <Shield className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {delta >= 0 ? (
                    <TrendingUp className="h-5 w-5 text-red-400" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-emerald-400" />
                  )}
                  <span
                    className={cn(
                      "text-xl font-semibold tabular-nums",
                      delta >= 0 ? "text-red-400" : "text-emerald-400",
                    )}
                  >
                    {delta >= 0 ? "+" : ""}
                    {delta.toLocaleString()}
                  </span>
                  {deltaPct != null ? (
                    <span className="text-sm text-zinc-500">
                      ({deltaPct >= 0 ? "+" : ""}
                      {deltaPct}%)
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {d.comparison.current_total.toLocaleString()} now · {d.comparison.previous_total.toLocaleString()} before
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-8">
              <CardHeader>
                <CardTitle className="text-base">Event volume</CardTitle>
                <CardDescription>
                  {range === "1d" ? "Hourly" : "Daily"} buckets · runtime + infra channel events
                </CardDescription>
              </CardHeader>
              <CardContent className="h-56">
                <TimeseriesLineChart points={d.timeseries.points} />
              </CardContent>
            </Card>

            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle className="text-base">Severity distribution</CardTitle>
              </CardHeader>
              <CardContent className="h-56">
                <DistributionPie items={d.events.by_severity} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top event types</CardTitle>
                <CardDescription>Most frequent classifications in selected period</CardDescription>
              </CardHeader>
              <CardContent className="h-64">
                <HorizontalRankBar items={d.events.by_event_type} color={CHART_PALETTE[1]} maxLabelWidth={120} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Severity breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <SeverityBreakdownBars items={d.events.by_severity} total={d.events.total} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Server className="h-4 w-4 text-emerald-500" />
                    Active pots ({livePots.length})
                  </CardTitle>
                  <CardDescription>Agent heartbeat within stale window</CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/pots">All pots</Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <PotList title="Active" rows={livePots} empty="No live pots — check agents or register a new pot." />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Box className="h-4 w-4 text-zinc-500" />
                    Inactive pots ({inactivePots.length})
                  </CardTitle>
                  <CardDescription>Offline or never connected</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <PotList title="Inactive" rows={inactivePots} empty="All pots are reporting heartbeats." />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Top pots by events</CardTitle>
              </CardHeader>
              <CardContent>
                <TopPotsList items={d.top_pots} />
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Recent events</CardTitle>
                  <CardDescription>Latest runtime and infrastructure events</CardDescription>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/log-wall">
                    Log wall
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0 px-2 pb-2">
                <EventLogTable items={d.recent_events} maxHeight="16rem" />
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" asChild>
              <Link href="/monitoring">Monitoring dashboards</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/pots">Manage pots</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/events">Events & logs</Link>
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
