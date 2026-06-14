"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronRight, LayoutGrid, Trash2 } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { notify } from "@/lib/toast";
import type { OperatorDashboard } from "@/lib/monitoring-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { DashboardView, type WidgetSpec } from "./DashboardView";
import { useFormatDateTime } from "@/hooks/use-format-datetime";

const WIDGET_CATALOG: WidgetSpec[] = [
  { type: "stat_total", title: "Total events", description: "Event count for the selected window", category: "metrics", w: 2, h: 2, config: { range: "24h", show_header: false } },
  { type: "stat_rate", title: "Events / hour", description: "Average ingest rate", category: "metrics", w: 2, h: 2, config: { range: "24h", show_header: false } },
  { type: "comparison_24h", title: "24h change", description: "Current vs prior 24h window", category: "metrics", w: 3, h: 2, config: { show_header: false, compact: true } },
  { type: "timeseries_line", title: "Event volume", description: "Time-series throughput", category: "charts", w: 8, h: 5, config: { range: "24h", bucket: "hour" } },
  { type: "area_severity", title: "Severity over time", description: "Stacked severity timeline", category: "charts", w: 12, h: 5, config: { range: "24h" } },
  { type: "pie_severity", title: "Severity distribution", description: "Breakdown by severity level", category: "charts", w: 4, h: 5, config: { range: "24h" } },
  { type: "donut_source", title: "Source mix", description: "Ingest source proportions", category: "charts", w: 4, h: 5, config: { range: "24h", limit: 8 } },
  { type: "bar_event_type", title: "Top event types", description: "Most frequent event types", category: "charts", w: 6, h: 5, config: { range: "24h", limit: 10 } },
  { type: "bar_source", title: "Top sources", description: "Events grouped by source", category: "charts", w: 6, h: 5, config: { range: "24h", limit: 10 } },
  { type: "radar_types", title: "Event mix profile", description: "Normalized type distribution", category: "charts", w: 4, h: 5, config: { range: "24h" } },
  { type: "heatmap_hours", title: "Activity heatmap", description: "Events by hour of day (UTC)", category: "charts", w: 6, h: 4, config: { range: "7d" } },
  { type: "stack_services", title: "By service", description: "Events per honeypot service", category: "charts", w: 6, h: 5, config: { range: "24h" } },
  { type: "stacks_bar", title: "By stack", description: "Events per deployment stack", category: "charts", w: 6, h: 5, config: { range: "7d", limit: 10 } },
  { type: "top_pots", title: "Top pots", description: "Highest-volume honeypot nodes", category: "lists", w: 4, h: 5, config: { range: "24h", limit: 8 } },
  { type: "table_recent", title: "Recent events", description: "Latest runtime + infra events", category: "logs", w: 12, h: 6, config: { limit: 20 } },
  { type: "log_stream", title: "Live log stream", description: "Compact monospace event feed", category: "logs", w: 12, h: 5, config: { limit: 15 } },
];

const TEMPLATES = [
  { key: "siem", label: "SIEM / SOC", desc: "KPI strip, severity analytics, threat breakdown, live feed" },
  { key: "honeypot", label: "Honeypot ops", desc: "7-day trap volume, busiest pots/stacks, attack patterns" },
  { key: "minimal", label: "Executive", desc: "Compact KPIs, trend, severity, and recent activity" },
  { key: "network", label: "Network / ingest", desc: "Throughput, sources, services, stacks, ingest stream" },
];

const CATEGORY_LABELS: Record<WidgetSpec["category"], string> = {
  metrics: "Metrics",
  charts: "Charts",
  lists: "Lists",
  logs: "Logs",
};

export function MonitoringDashboard() {
  const { formatDate } = useFormatDateTime();
  const [list, setList] = useState<OperatorDashboard[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OperatorDashboard | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [newName, setNewName] = useState("SOC dashboard");

  const catalogByCategory = useMemo(() => {
    const map = new Map<WidgetSpec["category"], WidgetSpec[]>();
    for (const w of WIDGET_CATALOG) {
      const arr = map.get(w.category) ?? [];
      arr.push(w);
      map.set(w.category, arr);
    }
    return map;
  }, []);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const rows = await apiFetch<OperatorDashboard[]>("/dashboards");
      setList(rows);
      setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : null));
    } catch (e) {
      notify.apiError(e, "Failed to load dashboards");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoadingDetail(true);
      try {
        const d = await apiFetch<OperatorDashboard>(`/dashboards/${selectedId}`);
        if (!cancelled) setDetail(d);
      } catch (e) {
        if (!cancelled) notify.apiError(e, "Load failed");
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function createFromTemplate(template_key: string) {
    try {
      const d = await apiFetch<OperatorDashboard>("/dashboards", {
        method: "POST",
        json: { name: newName || "Dashboard", template_key, grid_cols: 12 },
      });
      await loadList();
      setSelectedId(d.id);
      notify.success(`Dashboard "${d.name}" created`);
    } catch (e) {
      notify.apiError(e, "Could not create");
    }
  }

  async function deleteDashboard(id: string, name: string) {
    if (!confirm(`Delete dashboard “${name}”? This cannot be undone.`)) return;
    try {
      await apiFetch(`/dashboards/${id}`, { method: "DELETE" });
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      await loadList();
      notify.success(`Dashboard "${name}" deleted`);
    } catch (e) {
      notify.apiError(e, "Delete failed");
    }
  }

  async function duplicateDashboard(source: OperatorDashboard) {
    try {
      const created = await apiFetch<OperatorDashboard>("/dashboards", {
        method: "POST",
        json: { name: `${source.name} (copy)`, grid_cols: source.grid_cols },
      });
      const widgetsPayload = source.widgets.map((w, i) => ({
        widget_type: w.widget_type,
        title: w.title,
        config: w.config,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        order_index: i,
      }));
      const updated = await apiFetch<OperatorDashboard>(`/dashboards/${created.id}`, {
        method: "PUT",
        json: { widgets: widgetsPayload },
      });
      await loadList();
      setSelectedId(updated.id);
      notify.success(`Dashboard duplicated as "${updated.name}"`);
    } catch (e) {
      notify.apiError(e, "Duplicate failed");
    }
  }

  const templatePicker = (
    <div className="space-y-5">
      <div>
        <label htmlFor="dash-name" className="text-xs font-medium text-zinc-500">
          Dashboard name
        </label>
        <input
          id="dash-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-500/40 focus:ring-2 focus:ring-emerald-500/20"
          placeholder="e.g. Production SOC"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => void createFromTemplate(t.key)}
            className="rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-4 text-left transition-colors hover:border-emerald-500/30 hover:bg-zinc-900/50"
          >
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium text-zinc-100">{t.label}</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{t.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );

  if (selectedId && detail) {
    return (
      <DashboardView
        detail={detail}
        loading={loadingDetail}
        catalogByCategory={catalogByCategory}
        categoryLabels={CATEGORY_LABELS}
        onBack={() => setSelectedId(null)}
        onSaved={(updated) => {
          setDetail(updated);
          void loadList();
          notify.success("Dashboard saved");
        }}
        onDuplicate={() => void duplicateDashboard(detail)}
        onDelete={() => void deleteDashboard(detail.id, detail.name)}
        onError={(message) => {
          if (message) notify.error(message);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoring"
        description="SIEM-style dashboards over your honeynet event stream."
      />


      {loadingList ? (
        <div className="flex items-center gap-2 text-zinc-500">
          <Spinner />
          Loading dashboards…
        </div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="space-y-6 p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
                <LayoutGrid className="h-6 w-6" />
              </div>
              <div className="min-w-0 space-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-zinc-50">Create your first dashboard</h2>
                <p className="text-sm leading-relaxed text-zinc-500">
                  Choose a preset layout designed for SOC, honeypot, or network monitoring workflows.
                </p>
              </div>
            </div>
            {templatePicker}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((d) => (
              <div
                key={d.id}
                className="group relative rounded-2xl border border-zinc-800/90 bg-zinc-900/30 shadow-sm transition-colors hover:border-zinc-700 hover:bg-zinc-900/50"
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className="w-full p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 rounded-2xl"
                >
                  <div className="flex items-start justify-between gap-3 pr-6">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium text-zinc-100">{d.name}</p>
                      <p className="text-xs text-zinc-500">
                        {d.widgets.length} panel{d.widgets.length === 1 ? "" : "s"} · Updated{" "}
                        {formatDate(d.updated_at, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-zinc-600 transition-colors group-hover:text-emerald-400/90" />
                  </div>
                  {d.is_default ? (
                    <span className="mt-3 inline-block rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400/95">
                      Default
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  title="Delete dashboard"
                  aria-label={`Delete ${d.name}`}
                  onClick={() => void deleteDashboard(d.id, d.name)}
                  className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-600 opacity-0 transition-[opacity,background-color,color] hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/35"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <Card className="border-dashed border-zinc-700/80 bg-zinc-950/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">New dashboard</CardTitle>
              <CardDescription>Deploy another monitoring workspace from a template.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">{templatePicker}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
