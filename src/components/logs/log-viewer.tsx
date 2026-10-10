"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Copy, Search, WrapText } from "lucide-react";
import { formatLogClock, parseLogLines } from "@/lib/log-text";
import { notify } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LogViewerProps = {
  text: string;
  loading?: boolean;
  error?: string | null;
  /** Live tails follow the bottom until the reader scrolls up. Snapshots stay put. */
  mode?: "stream" | "snapshot";
  /** Hide the filter field. Wrap, copy, and the line count stay. */
  showSearch?: boolean;
  emptyLabel?: string;
  className?: string;
};

function lineTone(message: string): string {
  const lower = message.toLowerCase();
  if (/\b(error|fatal|panic|exception|failed|failure)\b/.test(lower)) return "text-rose-400";
  if (/\b(warn|warning)\b/.test(lower)) return "text-amber-400";
  return "text-body";
}

export function LogViewer({
  text,
  loading = false,
  error = null,
  mode = "stream",
  showSearch = true,
  emptyLabel = "No log lines yet.",
  className,
}: LogViewerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(mode === "stream");
  const scrollingRef = useRef(false);
  const [follow, setFollow] = useState(mode === "stream");
  const [anchor, setAnchor] = useState<number | null>(null);
  const [wrap, setWrap] = useState(true);
  const [query, setQuery] = useState("");

  const lines = useMemo(() => parseLogLines(text), [text]);
  const needle = showSearch ? query.trim().toLowerCase() : "";
  const visible = useMemo(
    () => (needle ? lines.filter((line) => line.message.toLowerCase().includes(needle) || (line.time ?? "").toLowerCase().includes(needle)) : lines),
    [lines, needle],
  );

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  useLayoutEffect(() => {
    if (mode !== "stream" || !followRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    scrollingRef.current = true;
    el.scrollTop = el.scrollHeight;
    scrollingRef.current = false;
  }, [visible, mode, wrap]);

  function onScroll() {
    if (mode !== "stream" || scrollingRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    if (atBottom === followRef.current) return;
    followRef.current = atBottom;
    setFollow(atBottom);
    setAnchor(atBottom ? null : lines.length);
  }

  function jumpToLatest() {
    followRef.current = true;
    setFollow(true);
    setAnchor(null);
    const el = scrollerRef.current;
    if (!el) return;
    scrollingRef.current = true;
    el.scrollTop = el.scrollHeight;
    scrollingRef.current = false;
  }

  const pending = anchor === null ? 0 : Math.max(0, lines.length - anchor);

  async function copyLogs() {
    const body = visible.map((line) => (line.time ? `${line.time} ${line.message}` : line.message)).join("\n");
    try {
      await navigator.clipboard.writeText(body);
      notify.success("Logs copied");
    } catch {
      notify.error("Could not copy logs");
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-recessed", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5">
        {showSearch ? (
          <div className="relative min-w-[8rem] flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
              style={{ left: "0.65rem" }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter lines"
              className="h-7 w-full rounded-full border border-line bg-surface pr-2 text-xs text-ink placeholder:text-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
              style={{ paddingLeft: "2.15rem" }}
            />
          </div>
        ) : null}
        <Button
          type="button"
          variant={wrap ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2"
          aria-pressed={wrap}
          onClick={() => setWrap((v) => !v)}
          title={wrap ? "Unwrap lines" : "Wrap lines"}
        >
          <WrapText className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => void copyLogs()} title="Copy logs">
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <span className="px-1 text-[10px] tabular-nums text-faint">
          {needle ? `${visible.length}/${lines.length}` : lines.length} lines
          {loading ? " · updating" : ""}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="h-full overflow-auto px-1 py-1 font-mono text-[12px] leading-5"
        >
          {visible.length === 0 ? (
            <p className="px-3 py-6 text-xs text-muted">{loading ? "Loading logs…" : error || emptyLabel}</p>
          ) : (
            visible.map((line) => (
              <div
                key={line.id}
                className="flex gap-3 px-2 hover:bg-hover"
                style={wrap ? undefined : { width: "max-content", minWidth: "100%" }}
              >
                {line.time ? (
                  <span className="w-[4.6rem] shrink-0 select-none pt-px text-[10px] tabular-nums text-faint" title={line.time}>
                    {formatLogClock(line.time)}
                  </span>
                ) : null}
                <span
                  className={cn(lineTone(line.message), wrap ? "min-w-0 flex-1" : "shrink-0")}
                  style={{
                    whiteSpace: wrap ? "pre-wrap" : "pre",
                    overflowWrap: wrap ? "anywhere" : "normal",
                  }}
                >
                  {line.message || " "}
                </span>
              </div>
            ))
          )}
        </div>
        {mode === "stream" && !follow && lines.length > 0 ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute right-3 z-10 inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink shadow-card"
            style={{ bottom: "0.5rem" }}
          >
            <ArrowDown className="h-3 w-3" />
            {pending > 0 ? `${pending} new` : "Latest"}
          </button>
        ) : null}
      </div>
      {error && lines.length > 0 ? (
        <p className="shrink-0 truncate border-t border-line px-3 py-1 text-[10px] text-rose-400">{error}</p>
      ) : null}
    </div>
  );
}
