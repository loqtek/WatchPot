"use client";

import { MoreVertical, Settings2, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function WidgetPanel({
  title,
  subtitle,
  children,
  showHeader = true,
  editMode,
  onConfigure,
  onRemove,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  showHeader?: boolean;
  editMode?: boolean;
  onConfigure?: () => void;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group/panel relative flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/60",
        editMode && "ring-1 ring-emerald-500/25",
        !showHeader && "border-zinc-800/60",
        className,
      )}
    >
      {showHeader ? (
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-1 border-b border-zinc-800/70 bg-zinc-900/90 px-2 py-1",
            editMode && "panel-drag-handle cursor-grab active:cursor-grabbing",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium text-zinc-300">{title}</p>
            {subtitle ? <p className="truncate text-[9px] tabular-nums text-zinc-600">{subtitle}</p> : null}
          </div>
          <div
            className={cn(
              "panel-actions flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/panel:opacity-100 focus-within:opacity-100",
              editMode && "opacity-100",
            )}
          >
            {onConfigure ? (
              <button
                type="button"
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                title="Panel settings"
                onClick={(e) => {
                  e.stopPropagation();
                  onConfigure();
                }}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {editMode && onRemove ? (
              <button
                type="button"
                className="rounded p-1 text-zinc-500 hover:bg-red-500/15 hover:text-red-400"
                title="Remove panel"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {editMode ? (
              <span className="cursor-grab rounded p-1 text-zinc-600 active:cursor-grabbing" title="Drag">
                <MoreVertical className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="panel-actions absolute right-1 top-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-hover/panel:opacity-100 group-focus-within/panel:opacity-100">
          {onConfigure ? (
            <button
              type="button"
              className="rounded bg-zinc-900/90 p-1 text-zinc-400 shadow hover:text-zinc-100"
              title="Panel settings"
              onClick={onConfigure}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {editMode && onRemove ? (
            <button
              type="button"
              className="rounded bg-zinc-900/90 p-1 text-zinc-400 shadow hover:text-red-400"
              title="Remove"
              onClick={onRemove}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      )}
      <div className={cn("relative min-h-0 flex-1 overflow-hidden", showHeader ? "p-1.5" : "p-1")}>{children}</div>
    </div>
  );
}
