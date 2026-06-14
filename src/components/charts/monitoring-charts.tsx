"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_AXIS,
  CHART_AXIS_TICK,
  CHART_GRID,
  CHART_PALETTE,
  CHART_TOOLTIP_STYLE,
  formatAxisTime,
  formatCount,
  severityColor,
  truncateLabel,
} from "@/lib/chart-theme";
import { ChartContainer, ChartEmpty } from "./chart-primitives";

type CountItem = { key: string; count: number };

export function DistributionPie({
  items,
  donut = false,
  colorFn,
}: {
  items: CountItem[];
  donut?: boolean;
  colorFn?: (key: string, i: number) => string;
}) {
  if (items.length === 0) return <ChartEmpty />;
  const total = items.reduce((s, x) => s + x.count, 0);
  const rows = items.map((x) => ({ name: x.key, value: x.count, pct: total ? Math.round((x.count / total) * 100) : 0 }));
  const pick = colorFn ?? ((k, i) => severityColor(k, i));

  return (
    <ChartContainer>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            cx="42%"
            cy="50%"
            outerRadius="72%"
            innerRadius={donut ? "52%" : 0}
            paddingAngle={donut ? 2 : 0}
            stroke="#09090b"
            strokeWidth={1}
          >
            {rows.map((r, i) => (
              <Cell key={r.name} fill={pick(r.name, i)} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v, _n, p) => {
              const row = p?.payload as { name: string; pct: number } | undefined;
              return [`${formatCount(Number(v ?? 0))} (${row?.pct ?? 0}%)`, row?.name ?? ""];
            }}
          />
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: "#a1a1aa", paddingLeft: 8 }}
            formatter={(value: string) => truncateLabel(value, 18)}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function HorizontalRankBar({
  items,
  color = CHART_PALETTE[0],
  maxLabelWidth = 100,
}: {
  items: CountItem[];
  color?: string;
  maxLabelWidth?: number;
}) {
  if (items.length === 0) return <ChartEmpty />;
  const max = Math.max(...items.map((x) => x.count), 1);
  const rows = [...items]
    .sort((a, b) => b.count - a.count)
    .map((x) => ({ name: truncateLabel(x.key, 20), full: x.key, count: x.count, pct: (x.count / max) * 100 }));

  return (
    <ChartContainer>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
          <XAxis type="number" stroke={CHART_AXIS} tick={CHART_AXIS_TICK} tickFormatter={formatCount} />
          <YAxis
            type="category"
            dataKey="name"
            width={maxLabelWidth}
            stroke={CHART_AXIS}
            tick={{ ...CHART_AXIS_TICK, fontSize: 9 }}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelFormatter={(_l, payload) => {
              const row = payload?.[0]?.payload as { full?: string } | undefined;
              return row?.full ?? _l;
            }}
            formatter={(v) => [formatCount(Number(v ?? 0)), "Events"]}
          />
          <Bar dataKey="count" fill={color} radius={[0, 3, 3, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function VerticalBarChart({
  items,
  color = CHART_PALETTE[2],
}: {
  items: { name: string; count: number }[];
  color?: string;
}) {
  if (items.length === 0) return <ChartEmpty />;
  const rows = items.map((x) => ({ name: truncateLabel(x.name, 14), full: x.name, count: x.count }));

  return (
    <ChartContainer>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="name" stroke={CHART_AXIS} tick={{ ...CHART_AXIS_TICK, fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={48} />
          <YAxis stroke={CHART_AXIS} tick={CHART_AXIS_TICK} tickFormatter={formatCount} width={40} />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelFormatter={(_l, payload) => {
              const row = payload?.[0]?.payload as { full?: string } | undefined;
              return row?.full ?? _l;
            }}
            formatter={(v) => [formatCount(Number(v ?? 0)), "Events"]}
          />
          <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function TimeseriesLineChart({ points }: { points: { t: string; count: number }[] }) {
  if (points.length === 0) return <ChartEmpty />;
  const rows = points.map((p) => ({ t: formatAxisTime(p.t), count: p.count, full: p.t }));

  return (
    <ChartContainer>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="t" stroke={CHART_AXIS} tick={{ ...CHART_AXIS_TICK, fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis stroke={CHART_AXIS} tick={CHART_AXIS_TICK} tickFormatter={formatCount} width={44} />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelFormatter={(_l, payload) => {
              const row = payload?.[0]?.payload as { full?: string } | undefined;
              return row?.full?.slice(0, 16).replace("T", " ") ?? _l;
            }}
            formatter={(v) => [formatCount(Number(v ?? 0)), "Events"]}
          />
          <Line type="monotone" dataKey="count" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: CHART_PALETTE[0] }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function AreaSeverityChart({
  buckets,
  severities,
  series,
}: {
  buckets: string[];
  severities: string[];
  series: Record<string, number[]>;
}) {
  if (buckets.length === 0 || severities.length === 0) return <ChartEmpty />;
  const rows = buckets.map((t, i) => {
    const row: Record<string, string | number> = { t: formatAxisTime(t) };
    for (const s of severities) row[s] = series[s]?.[i] ?? 0;
    return row;
  });

  return (
    <ChartContainer className="min-h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="t" stroke={CHART_AXIS} tick={{ ...CHART_AXIS_TICK, fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis stroke={CHART_AXIS} tick={CHART_AXIS_TICK} tickFormatter={formatCount} width={44} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" iconSize={8} />
          {severities.map((s, idx) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stackId="1"
              stroke={severityColor(s, idx)}
              fill={severityColor(s, idx)}
              fillOpacity={0.4}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function RadarMixChart({ axes, values }: { axes: string[]; values: number[] }) {
  if (axes.length === 0) return <ChartEmpty />;
  const chartData = axes.map((name, i) => ({ name: truncateLabel(name, 10), v: values[i] ?? 0 }));

  return (
    <ChartContainer>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="72%">
          <PolarGrid stroke="#3f3f46" />
          <PolarAngleAxis dataKey="name" tick={{ fontSize: 9, fill: "#a1a1aa" }} />
          <Radar name="Mix" dataKey="v" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.25} strokeWidth={2} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => [v, "Normalized"]} />
        </RadarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function ActivityHeatmap({ hours, counts }: { hours: number[]; counts: number[] }) {
  const max = Math.max(...counts, 1);
  const total = counts.reduce((s, c) => s + c, 0);

  return (
    <div className="flex h-full flex-col gap-3 px-1">
      <div className="grid flex-1 grid-cols-12 gap-1">
        {hours.map((h) => {
          const c = counts[h] ?? 0;
          const intensity = c / max;
          return (
            <div key={h} className="flex flex-col items-center gap-1">
              <div
                title={`${String(h).padStart(2, "0")}:00 UTC — ${c.toLocaleString()} events`}
                className="aspect-square w-full min-h-[20px] rounded-md border border-zinc-800/80 transition-transform hover:scale-105"
                style={{
                  background: `rgba(16, 185, 129, ${0.06 + intensity * 0.88})`,
                  boxShadow: intensity > 0.7 ? "0 0 12px rgba(16,185,129,0.25)" : undefined,
                }}
              />
              <span className="text-[9px] tabular-nums text-zinc-600">{h % 3 === 0 ? `${h}` : ""}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[10px] text-zinc-600">
        <span>Hour of day (UTC)</span>
        <span>{total.toLocaleString()} events total</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-zinc-600">
        <span>Low</span>
        <div className="flex h-2 flex-1 gap-px overflow-hidden rounded-full">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((o) => (
            <div key={o} className="flex-1" style={{ background: `rgba(16,185,129,${o})` }} />
          ))}
        </div>
        <span>High</span>
      </div>
    </div>
  );
}

export function SeverityBreakdownBars({
  items,
  total,
}: {
  items: { key: string; count: number }[];
  total: number;
}) {
  if (items.length === 0) return <ChartEmpty />;
  const sorted = [...items].sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-3 px-1">
      {sorted.map((row, i) => {
        const pct = total ? Math.round((row.count / total) * 100) : 0;
        const color = severityColor(row.key, i);
        return (
          <div key={row.key}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="font-medium capitalize text-zinc-300">{row.key}</span>
              <span className="shrink-0 tabular-nums text-zinc-500">
                {formatCount(row.count)} <span className="text-zinc-600">({pct}%)</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800/80">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
