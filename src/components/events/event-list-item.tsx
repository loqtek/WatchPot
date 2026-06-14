"use client";

import { useState } from "react";
import {
  Activity,
  Box,
  ChevronDown,
  ChevronRight,
  Container,
  FileText,
  KeyRound,
  Layers,
  Server,
} from "lucide-react";
import type { EventRow } from "@/lib/types";
import {
  channelTone,
  enrichmentDetailRows,
  enrichmentSummary,
  eventOneLiner,
  formatEventTime,
  formatEventTitle,
  hasEnrichmentMatch,
  hasExpandableContent,
  isContainerLogEvent,
  payloadDetailRows,
  severityTone,
} from "@/lib/event-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { cn } from "@/lib/utils";

function EventIcon({ eventType }: { eventType: string }) {
  const cls = "h-4 w-4 shrink-0";
  if (eventType === "watchpot.agent.container_logs") return <FileText className={cn(cls, "text-emerald-500")} />;
  if (eventType === "watchpot.agent.infra_snapshot") return <Server className={cn(cls, "text-sky-400")} />;
  if (eventType.startsWith("watchpot.stack.")) return <Layers className={cn(cls, "text-amber-400")} />;
  if (eventType === "watchpot.pot.agent_key_rotated") return <KeyRound className={cn(cls, "text-orange-400")} />;
  if (eventType.startsWith("watchpot.pot.")) return <Box className={cn(cls, "text-violet-400")} />;
  if (eventType.includes("container")) return <Container className={cn(cls, "text-emerald-500")} />;
  return <Activity className={cn(cls, "text-zinc-500")} />;
}

type EventListItemProps = {
  event: EventRow;
  compact?: boolean;
};

export function EventListItem({ event, compact = false }: EventListItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const { timezone } = useFormatDateTime();

  const title = formatEventTitle(event.event_type);
  const summary = enrichmentSummary(event) ?? eventOneLiner(event);
  const time = formatEventTime(event.received_at, timezone);
  const details = [...enrichmentDetailRows(event, timezone), ...payloadDetailRows(event)];
  const expandable = hasExpandableContent(event);
  const isLog = isContainerLogEvent(event);
  const hasPayload = event.payload && Object.keys(event.payload).length > 0;

  return (
    <li
      className={cn(
        "rounded-lg border border-zinc-800/80 bg-zinc-950/40 overflow-hidden",
        compact ? "text-sm" : "",
      )}
    >
      <div
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onClick={() => expandable && setExpanded((o) => !o)}
        onKeyDown={(e) => {
          if (expandable && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setExpanded((o) => !o);
          }
        }}
        className={cn(
          "flex items-start gap-3 px-3 py-2.5",
          expandable && "cursor-pointer hover:bg-zinc-900/40 transition-colors",
        )}
      >
        <EventIcon eventType={event.event_type} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-zinc-100 leading-snug">{title}</p>
              {summary ? (
                <p className="mt-0.5 text-sm text-zinc-500 truncate" title={summary}>
                  {summary}
                </p>
              ) : null}
            </div>
            <time className="shrink-0 text-xs tabular-nums text-zinc-600" title={time.full}>
              {time.short}
            </time>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={severityTone(event.severity)} className="normal-case tracking-normal text-[10px]">
              {event.severity}
            </Badge>
            <Badge tone={channelTone(event.channel)} className="normal-case tracking-normal text-[10px]">
              {event.channel}
            </Badge>
            {hasEnrichmentMatch(event) ? (
              <Badge tone="danger" className="normal-case tracking-normal text-[10px]">
                threat match
              </Badge>
            ) : null}
          </div>
        </div>
        {expandable ? (
          expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 mt-0.5" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500 mt-0.5" />
          )
        ) : null}
      </div>

      {expanded ? (
        <div className="border-t border-zinc-800/80 px-3 py-3 space-y-3 bg-zinc-950/30">
          {details.length > 0 ? (
            <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-4 gap-y-1.5 text-xs">
              {details.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-zinc-500">{row.label}</dt>
                  <dd className="text-zinc-300 font-mono break-all">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {isLog && event.raw_log ? (
            <div className="space-y-2">
              {!showLog ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowLog(true);
                  }}
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  View log excerpt
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-zinc-500">Docker log tail</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowLog(false);
                      }}
                    >
                      Hide log
                    </Button>
                  </div>
                  <pre className="max-h-48 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-400 whitespace-pre-wrap">
                    {event.raw_log}
                  </pre>
                </div>
              )}
            </div>
          ) : null}

          {hasPayload ? (
            <div className="space-y-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-zinc-500"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowJson((v) => !v);
                }}
              >
                {showJson ? "Hide raw JSON" : "Show raw JSON"}
              </Button>
              {showJson ? (
                <pre className="max-h-48 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-500">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}

          <p className="text-[10px] text-zinc-600 font-mono truncate" title={event.event_type}>
            {event.event_type}
          </p>
        </div>
      ) : null}
    </li>
  );
}
