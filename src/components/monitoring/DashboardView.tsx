"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import GridLayout, { verticalCompactor, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { apiFetch } from "@/lib/api";
import type { DashboardWidget, OperatorDashboard } from "@/lib/monitoring-types";
import {
  effectiveQueryConfig,
  parseWidgetConfig,
  widgetConfigSummary,
} from "@/lib/widget-config";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { DashboardToolbar } from "./DashboardToolbar";
import { WidgetBody } from "./WidgetBody";
import { WidgetConfigEditor } from "./WidgetConfigEditor";
import { WidgetPanel } from "./WidgetPanel";

export type WidgetSpec = {
  type: string;
  title: string;
  description: string;
  category: "metrics" | "charts" | "lists" | "logs";
  w: number;
  h: number;
  config: Record<string, unknown>;
};

function layoutFromWidgets(widgets: DashboardWidget[]): LayoutItem[] {
  return widgets.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: 2, minH: 2 }));
}

function maxLayoutY(items: readonly LayoutItem[]): number {
  return items.reduce((m, l) => Math.max(m, l.y + l.h), 0);
}

function widgetsFingerprint(d: OperatorDashboard): string {
  return JSON.stringify(
    d.widgets.map((w) => ({ ...w, id: w.id.startsWith("tmp-") ? w.id : w.id })),
  );
}

type Props = {
  detail: OperatorDashboard;
  loading: boolean;
  catalogByCategory: Map<WidgetSpec["category"], WidgetSpec[]>;
  categoryLabels: Record<WidgetSpec["category"], string>;
  onBack: () => void;
  onSaved: (updated: OperatorDashboard) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onError: (msg: string | null) => void;
};

export function DashboardView({
  detail: initialDetail,
  loading,
  catalogByCategory,
  categoryLabels,
  onBack,
  onSaved,
  onDuplicate,
  onDelete,
  onError,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [detail, setDetail] = useState(initialDetail);
  const [savedFingerprint, setSavedFingerprint] = useState(() => widgetsFingerprint(initialDetail));
  const [layout, setLayout] = useState<LayoutItem[]>(() => layoutFromWidgets(initialDetail.widgets));
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [globalRange, setGlobalRange] = useState<string | null>("24h");
  const [refreshMs, setRefreshMs] = useState(60_000);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(new Date());
  const [configWidgetId, setConfigWidgetId] = useState<string | null>(null);

  useEffect(() => {
    setDetail(initialDetail);
    setLayout(layoutFromWidgets(initialDetail.widgets));
    setSavedFingerprint(widgetsFingerprint(initialDetail));
    setEditMode(false);
    setAddOpen(false);
    setConfigWidgetId(null);
  }, [initialDetail.id, initialDetail]);

  useEffect(() => {
    document.body.dataset.dashboardImmersive = "true";
    return () => {
      delete document.body.dataset.dashboardImmersive;
    };
  }, []);

  useEffect(() => {
    if (fullscreen) {
      document.body.dataset.dashboardFullscreen = "true";
      document.body.style.overflow = "hidden";
    } else {
      delete document.body.dataset.dashboardFullscreen;
      document.body.style.overflow = "";
    }
    return () => {
      delete document.body.dataset.dashboardFullscreen;
      document.body.style.overflow = "";
    };
  }, [fullscreen]);

  useEffect(() => {
    if (refreshMs <= 0) return;
    const id = setInterval(() => setLastRefresh(new Date()), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs]);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(280, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [detail.id, fullscreen]);

  const dirty = useMemo(() => widgetsFingerprint(detail) !== savedFingerprint, [detail, savedFingerprint]);

  const configWidget = configWidgetId ? detail.widgets.find((w) => w.id === configWidgetId) : null;

  const onLayoutChange = useCallback(
    (next: Layout) => {
      if (editMode) setLayout(next.map((l) => ({ ...l })));
    },
    [editMode],
  );

  function cancelEditing() {
    setDetail(initialDetail);
    setLayout(layoutFromWidgets(initialDetail.widgets));
    setEditMode(false);
    setAddOpen(false);
    setConfigWidgetId(null);
  }

  async function save() {
    setSaving(true);
    onError(null);
    try {
      const posById = new Map(layout.map((item) => [item.i, item]));
      const widgetsPayload = detail.widgets.map((w, i) => {
        const p = posById.get(w.id);
        return {
          widget_type: w.widget_type,
          title: w.title,
          config: w.config,
          x: p?.x ?? w.x,
          y: p?.y ?? w.y,
          w: p?.w ?? w.w,
          h: p?.h ?? w.h,
          order_index: i,
        };
      });
      const updated = await apiFetch<OperatorDashboard>(`/dashboards/${detail.id}`, {
        method: "PUT",
        json: { widgets: widgetsPayload },
      });
      setDetail(updated);
      setLayout(layoutFromWidgets(updated.widgets));
      setSavedFingerprint(widgetsFingerprint(updated));
      setEditMode(false);
      setAddOpen(false);
      setConfigWidgetId(null);
      onSaved(updated);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function addWidget(spec: WidgetSpec) {
    const id = `tmp-${crypto.randomUUID()}`;
    const y = maxLayoutY(layout);
    const nw: DashboardWidget = {
      id,
      widget_type: spec.type,
      title: spec.title,
      config: spec.config,
      x: 0,
      y,
      w: spec.w,
      h: spec.h,
      order_index: detail.widgets.length,
    };
    setDetail({ ...detail, widgets: [...detail.widgets, nw] });
    setLayout((prev) => [...prev, { i: id, x: 0, y, w: spec.w, h: spec.h, minW: 2, minH: 2 }]);
    setAddOpen(false);
  }

  function removeWidget(id: string) {
    setDetail({ ...detail, widgets: detail.widgets.filter((w) => w.id !== id) });
    setLayout((prev) => prev.filter((item) => item.i !== id));
    if (configWidgetId === id) setConfigWidgetId(null);
  }

  function applyWidgetConfig(widgetId: string, title: string, config: Record<string, unknown>) {
    setDetail({
      ...detail,
      widgets: detail.widgets.map((w) => (w.id === widgetId ? { ...w, title, config } : w)),
    });
  }

  function toggleEdit() {
    setEditMode((e) => !e);
    setAddOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "dashboard-view flex flex-col",
        fullscreen && "fixed inset-0 z-[200] bg-zinc-950",
        !fullscreen && "min-h-[calc(100dvh-4rem)]",
      )}
    >
      <DashboardToolbar
        name={detail.name}
        editMode={editMode}
        saving={saving}
        dirty={dirty}
        fullscreen={fullscreen}
        globalRange={globalRange}
        refreshMs={refreshMs}
        lastRefresh={lastRefresh}
        onBack={onBack}
        onToggleEdit={toggleEdit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onToggleFullscreen={() => setFullscreen((f) => !f)}
        onSave={() => void save()}
        onCancel={cancelEditing}
        onAddPanel={() => setAddOpen((o) => !o)}
        onGlobalRangeChange={setGlobalRange}
        onRefreshChange={setRefreshMs}
      />

      {addOpen && editMode ? (
        <div className="shrink-0 border-b border-zinc-800/80 bg-zinc-950/95 px-3 py-2 sm:px-4">
          <div className="max-h-48 space-y-3 overflow-y-auto">
            {(["metrics", "charts", "lists", "logs"] as const).map((cat) => {
              const items = catalogByCategory.get(cat) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={cat}>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                    {categoryLabels[cat]}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {items.map((w) => (
                      <button
                        key={w.type}
                        type="button"
                        onClick={() => addWidget(w)}
                        className="rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[11px] text-zinc-300 hover:border-emerald-500/30 hover:text-zinc-100"
                      >
                        {w.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div ref={gridRef} className="dashboard-grid min-h-0 flex-1 overflow-auto px-1 py-2 sm:px-2 sm:py-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-zinc-500">
            <Spinner />
            Loading…
          </div>
        ) : (
          <GridLayout
            key={`${detail.id}-${globalRange}-${refreshMs}`}
            className="min-h-[200px]"
            layout={layout}
            width={width}
            gridConfig={{
              cols: detail.grid_cols || 12,
              rowHeight: 28,
              margin: [6, 6],
              containerPadding: [0, 0],
            }}
            dragConfig={{ enabled: editMode, handle: ".panel-drag-handle", cancel: ".panel-actions" }}
            resizeConfig={{ enabled: editMode }}
            compactor={verticalCompactor}
            onLayoutChange={onLayoutChange}
          >
            {detail.widgets.map((w) => {
              const parsed = parseWidgetConfig(w.config);
              const queryConfig = effectiveQueryConfig(w.config, globalRange);
              const subtitle = widgetConfigSummary(w, globalRange);
              return (
                <div key={w.id} className="h-full">
                  <WidgetPanel
                    title={w.title}
                    subtitle={subtitle || undefined}
                    showHeader={parsed.show_header !== false}
                    editMode={editMode}
                    onConfigure={() => setConfigWidgetId(w.id)}
                    onRemove={() => removeWidget(w.id)}
                  >
                    <WidgetBody
                      widgetType={w.widget_type}
                      title={w.title}
                      config={queryConfig}
                      refreshInterval={refreshMs}
                    />
                  </WidgetPanel>
                </div>
              );
            })}
          </GridLayout>
        )}
      </div>

      {configWidget ? (
        <WidgetConfigEditor
          widget={configWidget}
          open={!!configWidgetId}
          onClose={() => setConfigWidgetId(null)}
          onApply={applyWidgetConfig}
        />
      ) : null}
    </div>
  );
}
