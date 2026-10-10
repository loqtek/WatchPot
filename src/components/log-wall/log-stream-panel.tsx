"use client";

import { Circle, RefreshCw, Settings2 } from "lucide-react";
import type { LogWindowConfig } from "@/lib/log-wall-presets";
import { LogViewer } from "@/components/logs/log-viewer";
import { useLogStream } from "@/hooks/use-log-stream";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type Props = {
  window: LogWindowConfig;
  potName?: string;
  potOnline?: boolean;
  cachedPollMs: number;
  livePollMs: number;
  onConfigure?: () => void;
  onRemove?: () => void;
  editMode?: boolean;
};

export function LogStreamPanel({
  window: win,
  potName,
  potOnline,
  cachedPollMs,
  livePollMs,
  onConfigure,
  onRemove,
  editMode,
}: Props) {
  const { formatTime } = useFormatDateTime();

  const configured = Boolean(win.potId && win.container);
  const { text, source, updatedAt, loading, liveFetching, error, refresh } = useLogStream({
    potId: win.potId,
    container: win.container,
    tail: win.tail,
    cachedPollMs,
    livePollMs,
    enabled: configured,
  });

  const title = configured
    ? `${potName ?? win.potId.slice(0, 8)} · ${win.container}`
    : "Unconfigured window";

  return (
    <div className="group/panel relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b border-line bg-recessed px-3 py-2",
          editMode && "log-wall-drag-handle cursor-grab active:cursor-grabbing",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-zinc-300">{title}</p>
          <p className="truncate text-[9px] tabular-nums text-zinc-600">
            {configured ? (
              <>
                {source === "live" && liveFetching
                  ? "Live · refreshing…"
                  : source === "cached" && liveFetching
                    ? "Cached · fetching live…"
                    : source === "cached"
                      ? `Cached · ${updatedAt ? formatTime(updatedAt) : "—"}`
                      : source === "live"
                        ? `Live · ${updatedAt ? formatTime(updatedAt) : "—"}`
                        : "Waiting…"}
                {potOnline != null ? (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <Circle
                      className={cn("h-2 w-2 fill-current", potOnline ? "text-emerald-500" : "text-zinc-600")}
                    />
                    {potOnline ? "agent online" : "agent offline"}
                  </span>
                ) : null}
              </>
            ) : (
              "Select a pot and container in edit mode"
            )}
          </p>
        </div>
        <div className="panel-actions flex shrink-0 items-center gap-0.5">
          {configured ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
              title="Refresh logs"
              disabled={loading || liveFetching}
              onClick={() => void refresh()}
            >
              {loading || liveFetching ? <Spinner size="sm" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          ) : null}
          {onConfigure ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
              title="Configure window"
              onClick={onConfigure}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {editMode && onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-zinc-500 hover:bg-red-500/15 hover:text-red-400"
              title="Remove window"
              onClick={onRemove}
            >
              ×
            </Button>
          ) : null}
        </div>
      </div>
      <LogViewer
        text={configured ? text : ""}
        loading={loading || liveFetching}
        error={error}
        mode="stream"
        showSearch={!win.hideSearch}
        emptyLabel={configured ? "No log lines yet." : "Select a pot and container in edit mode."}
        className="min-h-0 flex-1 rounded-none border-0"
      />
    </div>
  );
}
