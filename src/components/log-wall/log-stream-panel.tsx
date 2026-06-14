"use client";

import { useCallback, useEffect, useRef } from "react";
import { Circle, RefreshCw, Settings2 } from "lucide-react";
import type { LogWindowConfig } from "@/lib/log-wall-presets";
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
  const preRef = useRef<HTMLPreElement>(null);
  const stickToBottomRef = useRef(true);

  const configured = Boolean(win.potId && win.container);
  const { text, source, updatedAt, loading, liveFetching, error, refresh } = useLogStream({
    potId: win.potId,
    container: win.container,
    tail: win.tail,
    cachedPollMs,
    livePollMs,
    enabled: configured,
  });

  const handleScroll = useCallback(() => {
    const el = preRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickToBottomRef.current = atBottom;
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  const title = configured
    ? `${potName ?? win.potId.slice(0, 8)} · ${win.container}`
    : "Unconfigured window";

  return (
    <div className="group/panel relative flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/60">
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800/70 bg-zinc-900/90 px-2 py-1",
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
      <div className="relative min-h-0 flex-1 p-1">
        <pre
          ref={preRef}
          onScroll={handleScroll}
          className="h-full overflow-auto rounded border border-zinc-800/60 bg-zinc-950/80 p-2 font-mono text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap"
        >
          {!configured
            ? "Configure this window to start streaming logs."
            : loading && !text
              ? "Loading logs…"
              : error && !text
                ? error
                : text || "(empty)"}
        </pre>
        {error && text ? (
          <p className="absolute bottom-2 left-2 right-2 truncate rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
