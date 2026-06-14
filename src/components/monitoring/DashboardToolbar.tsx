"use client";

import {
  ArrowLeft,
  Check,
  Copy,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { cn } from "@/lib/utils";

const TIME_RANGES = [
  { key: "1h", label: "1h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "14d", label: "14d" },
  { key: "30d", label: "30d" },
];

const REFRESH_OPTIONS = [
  { ms: 0, label: "Off" },
  { ms: 30_000, label: "30s" },
  { ms: 60_000, label: "1m" },
  { ms: 300_000, label: "5m" },
];

function Segmented({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center rounded-md border border-zinc-800/90 bg-zinc-950/80 p-0.5", className)}>
      {children}
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "rounded px-2 py-1 text-[11px] font-medium tabular-nums transition-colors",
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
      )}
    >
      {children}
    </button>
  );
}

export function DashboardToolbar({
  name,
  editMode,
  saving,
  dirty,
  fullscreen,
  globalRange,
  refreshMs,
  lastRefresh,
  onBack,
  onToggleEdit,
  onDuplicate,
  onDelete,
  onToggleFullscreen,
  onSave,
  onCancel,
  onAddPanel,
  onGlobalRangeChange,
  onRefreshChange,
}: {
  name: string;
  editMode: boolean;
  saving: boolean;
  dirty: boolean;
  fullscreen: boolean;
  globalRange: string | null;
  refreshMs: number;
  lastRefresh: Date | null;
  onBack: () => void;
  onToggleEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleFullscreen: () => void;
  onSave: () => void;
  onCancel: () => void;
  onAddPanel: () => void;
  onGlobalRangeChange: (range: string | null) => void;
  onRefreshChange: (ms: number) => void;
}) {
  const { formatTime } = useFormatDateTime();
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Back" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="max-w-[12rem] truncate text-sm font-semibold text-zinc-100 sm:max-w-xs">{name}</h1>
        {dirty ? (
          <span className="hidden rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 sm:inline">
            unsaved
          </span>
        ) : null}
      </div>

      <div className="hidden h-5 w-px bg-zinc-800 sm:block" aria-hidden />

      <Segmented className="hidden sm:flex">
        <SegBtn active={globalRange === null} onClick={() => onGlobalRangeChange(null)} title="Per panel">
          Auto
        </SegBtn>
        {TIME_RANGES.map((r) => (
          <SegBtn
            key={r.key}
            active={globalRange === r.key}
            onClick={() => onGlobalRangeChange(r.key)}
            title={`Dashboard range: ${r.label}`}
          >
            {r.label}
          </SegBtn>
        ))}
      </Segmented>

      <Segmented className="hidden md:flex">
        <RefreshCw className="mx-1 h-3 w-3 text-zinc-600" />
        {REFRESH_OPTIONS.map((o) => (
          <SegBtn
            key={o.ms}
            active={refreshMs === o.ms}
            onClick={() => onRefreshChange(o.ms)}
            title={`Refresh: ${o.label}`}
          >
            {o.label}
          </SegBtn>
        ))}
      </Segmented>

      {lastRefresh ? (
        <span className="hidden text-[10px] tabular-nums text-zinc-600 lg:inline">
          {formatTime(lastRefresh.toISOString())}
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        {editMode ? (
          <>
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={onAddPanel} title="Add panel">
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="h-8 px-2"
              disabled={saving}
              onClick={onSave}
              title="Save"
            >
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={onCancel} title="Cancel">
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant={editMode ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={onToggleEdit}
              title="Edit layout"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={onDuplicate} title="Duplicate">
              <Copy className="h-4 w-4" />
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-zinc-500 hover:bg-red-500/15 hover:text-red-400"
          onClick={onDelete}
          title="Delete dashboard"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={onToggleFullscreen}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        {!editMode && dirty ? (
          <Button type="button" variant="primary" size="sm" className="h-8 px-2" disabled={saving} onClick={onSave} title="Save">
            <Check className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </header>
  );
}
