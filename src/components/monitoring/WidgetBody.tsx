"use client";

import { Activity, Gauge, Hash } from "lucide-react";
import {
  ActivityHeatmap,
  AreaSeverityChart,
  DistributionPie,
  HorizontalRankBar,
  RadarMixChart,
  TimeseriesLineChart,
  VerticalBarChart,
} from "@/components/charts/monitoring-charts";
import { CHART_PALETTE, severityColor } from "@/lib/chart-theme";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useWidgetData } from "@/hooks/use-widget-data";
import type { WidgetPayload } from "@/lib/monitoring-types";
import {
  ComparisonPanel,
  EventLogTable,
  StatPanel,
  TopPotsList,
} from "./widget-parts";

function renderPayload(data: WidgetPayload, title: string, config: Record<string, unknown> | null) {
  const compact = config?.compact === true;
  switch (data.kind) {
    case "stat_total":
      return (
        <StatPanel
          label={title}
          value={data.value}
          sub={data.subtitle}
          icon={Hash}
        />
      );
    case "stat_rate":
      return (
        <StatPanel
          label={title}
          value={data.value}
          sub={data.subtitle}
          icon={Gauge}
        />
      );
    case "comparison_24h":
      return (
        <ComparisonPanel
          current={data.current_total}
          previous={data.previous_total}
          delta={data.delta}
          deltaPercent={data.delta_percent}
          compact={compact}
        />
      );
    case "pie_severity":
      return (
        <DistributionPie
          items={data.items}
          colorFn={(k, i) => severityColor(k, i)}
        />
      );
    case "donut_source":
      return <DistributionPie items={data.items} donut />;
    case "bar_source":
      return <HorizontalRankBar items={data.items} color={CHART_PALETTE[0]} />;
    case "bar_event_type":
      return <HorizontalRankBar items={data.items} color={CHART_PALETTE[1]} maxLabelWidth={110} />;
    case "horizontal_types":
      return <HorizontalRankBar items={data.items} color={CHART_PALETTE[5]} />;
    case "timeseries_line":
      return <TimeseriesLineChart points={data.points} />;
    case "area_severity":
      return (
        <AreaSeverityChart
          buckets={data.buckets}
          severities={data.severities}
          series={data.series}
        />
      );
    case "top_pots":
      return <TopPotsList items={data.items} />;
    case "heatmap_hours":
      return <ActivityHeatmap hours={data.hours} counts={data.counts} />;
    case "table_recent":
      return <EventLogTable items={data.items} variant="table" />;
    case "log_stream":
      return <EventLogTable items={data.items} variant="stream" />;
    case "radar_types":
      return <RadarMixChart axes={data.axes} values={data.values} />;
    case "stack_services":
      return (
        <VerticalBarChart
          items={data.items.map((x) => ({ name: x.name, count: x.count }))}
          color={CHART_PALETTE[2]}
        />
      );
    case "stacks_bar":
      return (
        <VerticalBarChart
          items={data.items.map((x) => ({ name: x.name, count: x.count }))}
          color={CHART_PALETTE[3]}
        />
      );
    default:
      return <p className="text-xs text-zinc-500">Unsupported visualization.</p>;
  }
}

export function WidgetBody({
  widgetType,
  title,
  config,
  refreshInterval,
}: {
  widgetType: string;
  title: string;
  config: Record<string, unknown> | null;
  refreshInterval?: number;
}) {
  const { data, loading, error, refreshing } = useWidgetData(widgetType, config, refreshInterval);

  if (error) {
    return <Alert className="text-xs">{error}</Alert>;
  }

  if (loading && !data) {
    return (
      <div className="flex h-full min-h-[100px] items-center justify-center gap-2 text-zinc-500">
        <Spinner />
        <span className="text-xs">Loading…</span>
      </div>
    );
  }

  if (!data) {
    return <p className="text-xs text-zinc-500">No data</p>;
  }

  return (
    <div className="relative h-full">
      {refreshing ? (
        <div className="pointer-events-none absolute right-0 top-0 z-10">
          <Activity className="h-3 w-3 animate-pulse text-emerald-500/60" />
        </div>
      ) : null}
      {renderPayload(data, title, config)}
    </div>
  );
}
