"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import GridLayout, { noCompactor, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  BUILTIN_DEFAULT_PRESET_ID,
  MAX_LOG_WINDOWS,
  clonePreset,
  createEmptyWindow,
  getPresetById,
  loadDefaultPresetId,
  loadPresets,
  saveDefaultPresetId,
  savePresets,
  type LogWallPreset,
  type LogWindowConfig,
} from "@/lib/log-wall-presets";
import type { Pot } from "@/lib/types";
import { LogStreamPanel } from "@/components/log-wall/log-stream-panel";
import { LogWindowConfigDialog } from "@/components/log-wall/log-window-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAsyncData } from "@/hooks/use-async-data";
import { cn } from "@/lib/utils";

const GRID_COLS = 12;
const ROW_HEIGHT = 24;

const REFRESH_OPTIONS = [
  { cached: 5000, live: 30000, label: "5s / 30s" },
  { cached: 3000, live: 15000, label: "3s / 15s" },
  { cached: 10000, live: 60000, label: "10s / 1m" },
  { cached: 0, live: 0, label: "Manual" },
];

const MIN_WINDOW_W = 3;
const MIN_WINDOW_H = 4;
const MAX_WINDOW_H = 48;

function layoutItemFromWindow(w: LogWindowConfig): LayoutItem {
  return {
    i: w.id,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    minW: MIN_WINDOW_W,
    minH: MIN_WINDOW_H,
    maxW: GRID_COLS,
    maxH: MAX_WINDOW_H,
  };
}

function layoutFromWindows(windows: LogWindowConfig[]): LayoutItem[] {
  return windows.map(layoutItemFromWindow);
}

function windowsFromLayout(windows: LogWindowConfig[], layout: Layout): LogWindowConfig[] {
  const byId = new Map(layout.map((l) => [l.i, l]));
  return windows.map((w) => {
    const l = byId.get(w.id);
    if (!l) return w;
    return { ...w, x: l.x, y: l.y, w: l.w, h: l.h };
  });
}

function presetFingerprint(p: LogWallPreset): string {
  return JSON.stringify(p);
}

type Props = {
  initialPotId?: string;
};

export function LogWallView({ initialPotId }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [presets, setPresets] = useState<LogWallPreset[]>(() => loadPresets());
  const [activePresetId, setActivePresetId] = useState(() => loadDefaultPresetId());
  const [draft, setDraft] = useState<LogWallPreset>(() => {
    const id = loadDefaultPresetId();
    const p = getPresetById(loadPresets(), id) ?? loadPresets()[0];
    if (initialPotId && p) {
      const windows = [...p.windows];
      if (windows[0]) windows[0] = { ...windows[0], potId: initialPotId };
      return { ...p, windows };
    }
    return p;
  });
  const [savedFingerprint, setSavedFingerprint] = useState(() => presetFingerprint(draft));
  const [layout, setLayout] = useState<LayoutItem[]>(() => layoutFromWindows(draft.windows));
  const [editMode, setEditMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [configWindowId, setConfigWindowId] = useState<string | null>(null);
  const [saveAsName, setSaveAsName] = useState("");
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [refreshIdx, setRefreshIdx] = useState(0);

  const refreshOption = REFRESH_OPTIONS[refreshIdx] ?? REFRESH_OPTIONS[0];

  const fetchPots = useCallback(() => apiFetch<Pot[]>("/pots"), []);
  const { data: pots } = useAsyncData(fetchPots);
  const potById = useMemo(() => new Map((pots ?? []).map((p) => [p.id, p])), [pots]);

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

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(280, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen, draft.windows.length]);

  const [defaultPresetId, setDefaultPresetId] = useState(() => loadDefaultPresetId());
  const dirty = presetFingerprint(draft) !== savedFingerprint;
  const configWindow = configWindowId ? draft.windows.find((w) => w.id === configWindowId) : null;

  const loadPreset = useCallback((preset: LogWallPreset) => {
    setDraft(preset);
    setLayout(layoutFromWindows(preset.windows));
    setSavedFingerprint(presetFingerprint(preset));
    setActivePresetId(preset.id);
    setEditMode(false);
    setConfigWindowId(null);
  }, []);

  const persistDraft = useCallback(
    (next: LogWallPreset) => {
      const existing = presets.find((p) => p.id === next.id);
      const updated = existing
        ? presets.map((p) => (p.id === next.id ? next : p))
        : [...presets, next];
      setPresets(updated);
      savePresets(updated);
      setDraft(next);
      setSavedFingerprint(presetFingerprint(next));
      setActivePresetId(next.id);
    },
    [presets],
  );

  const onLayoutChange = useCallback(
    (next: Layout) => {
      const mapped = windowsFromLayout(draft.windows, next);
      setLayout(next.map((l) => ({ ...l })));
      setDraft((d) => ({ ...d, windows: mapped }));
    },
    [draft.windows],
  );

  function addWindow() {
    if (draft.windows.length >= MAX_LOG_WINDOWS) return;
    const maxY = layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    const nw = createEmptyWindow(10, 0, maxY, GRID_COLS);
    const windows = [...draft.windows, nw];
    setDraft({ ...draft, windows });
    setLayout([...layout, layoutItemFromWindow(nw)]);
  }

  function removeWindow(id: string) {
    if (draft.windows.length <= 1) return;
    const windows = draft.windows.filter((w) => w.id !== id);
    setDraft({ ...draft, windows });
    setLayout(layout.filter((l) => l.i !== id));
    if (configWindowId === id) setConfigWindowId(null);
  }

  function applyWindowConfig(updated: LogWindowConfig) {
    setDraft({
      ...draft,
      windows: draft.windows.map((w) => (w.id === updated.id ? updated : w)),
    });
  }

  function handleSave() {
    persistDraft(draft);
    setEditMode(false);
  }

  function handleSaveAs() {
    const name = saveAsName.trim();
    if (!name) return;
    const created = clonePreset(draft, name);
    const updated = [...presets, created];
    setPresets(updated);
    savePresets(updated);
    setDraft(created);
    setSavedFingerprint(presetFingerprint(created));
    setActivePresetId(created.id);
    setShowSaveAs(false);
    setSaveAsName("");
    setEditMode(false);
  }

  function handleDeletePreset() {
    if (draft.id === BUILTIN_DEFAULT_PRESET_ID) return;
    const updated = presets.filter((p) => p.id !== draft.id);
    const fallback = getPresetById(updated, defaultPresetId) ?? updated[0];
    setPresets(updated);
    savePresets(updated);
    if (fallback) loadPreset(fallback);
  }

  function handleSetDefault() {
    saveDefaultPresetId(draft.id);
    setDefaultPresetId(draft.id);
    setActivePresetId(draft.id);
  }

  return (
    <div
      className={cn(
        "dashboard-view log-wall-view flex flex-col",
        fullscreen && "fixed inset-0 z-[200] bg-zinc-950",
        !fullscreen && "min-h-[calc(100dvh-4rem)]",
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/95 px-2 py-2 sm:px-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold text-zinc-200">Log wall</h1>
          <select
            value={activePresetId}
            onChange={(e) => {
              const p = getPresetById(presets, e.target.value);
              if (p) loadPreset(p);
            }}
            className="h-8 max-w-[12rem] rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === defaultPresetId ? " ★" : ""}
              </option>
            ))}
          </select>
          <span className="text-[10px] tabular-nums text-zinc-600">
            {draft.windows.length}/{MAX_LOG_WINDOWS} windows
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <select
            value={refreshIdx}
            onChange={(e) => setRefreshIdx(Number(e.target.value))}
            className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-400"
            title="Cached poll / live fetch interval"
          >
            {REFRESH_OPTIONS.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </select>

          <Button
            type="button"
            variant={editMode ? "primary" : "secondary"}
            size="sm"
            className="h-8 gap-1 px-2 text-[11px]"
            onClick={() => {
              setEditMode((e) => !e);
              setShowSaveAs(false);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            {editMode ? "Done" : "Edit"}
          </Button>

          {editMode ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 gap-1 px-2 text-[11px]"
                disabled={draft.windows.length >= MAX_LOG_WINDOWS}
                onClick={addWindow}
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
              {dirty ? (
                <Button type="button" size="sm" className="h-8 gap-1 px-2 text-[11px]" onClick={handleSave}>
                  <Save className="h-3.5 w-3.5" />
                  Save
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-[11px]"
                onClick={() => setShowSaveAs((s) => !s)}
              >
                Save as…
              </Button>
            </>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-500"
            title={draft.id === defaultPresetId ? "Default preset" : "Set as default"}
            onClick={handleSetDefault}
          >
            <Star
              className={cn(
                "h-3.5 w-3.5",
                draft.id === defaultPresetId ? "fill-amber-400 text-amber-400" : "text-zinc-500",
              )}
            />
          </Button>

          {draft.id !== BUILTIN_DEFAULT_PRESET_ID ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-500 hover:text-red-400"
              title="Delete preset"
              onClick={handleDeletePreset}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-500"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => setFullscreen((f) => !f)}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {showSaveAs ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/60 bg-zinc-950/90 px-3 py-2">
          <Input
            placeholder="Preset name"
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            className="h-8 max-w-xs text-sm"
          />
          <Button type="button" size="sm" className="h-8" disabled={!saveAsName.trim()} onClick={handleSaveAs}>
            Create preset
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowSaveAs(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      <div ref={gridRef} className="dashboard-grid log-wall-grid min-h-0 flex-1 overflow-auto px-1 py-1 sm:px-1.5 sm:py-2">
        <GridLayout
          className="min-h-[120px]"
          layout={layout}
          width={width}
          gridConfig={{
            cols: GRID_COLS,
            rowHeight: ROW_HEIGHT,
            margin: [4, 4],
            containerPadding: [0, 0],
          }}
          dragConfig={{ enabled: editMode, handle: ".log-wall-drag-handle", cancel: ".panel-actions" }}
          resizeConfig={{ enabled: true, handles: ["s", "e"] }}
          compactor={noCompactor}
          onLayoutChange={onLayoutChange}
        >
          {draft.windows.map((w) => {
            const pot = w.potId ? potById.get(w.potId) : undefined;
            return (
              <div key={w.id} className="h-full">
                <LogStreamPanel
                  window={w}
                  potName={pot?.name}
                  potOnline={pot?.heartbeat_online}
                  cachedPollMs={refreshOption.cached}
                  livePollMs={refreshOption.live}
                  editMode={editMode}
                  onConfigure={() => setConfigWindowId(w.id)}
                  onRemove={() => removeWindow(w.id)}
                />
              </div>
            );
          })}
        </GridLayout>
      </div>

      {configWindow ? (
        <LogWindowConfigDialog
          window={configWindow}
          pots={pots ?? []}
          open={!!configWindowId}
          onClose={() => setConfigWindowId(null)}
          onApply={applyWindowConfig}
        />
      ) : null}
    </div>
  );
}
