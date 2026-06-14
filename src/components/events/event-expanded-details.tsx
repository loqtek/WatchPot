"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import type { EventRow } from "@/lib/types";
import { enrichmentDetailRows, isContainerLogEvent, payloadDetailRows } from "@/lib/event-display";
import { Button } from "@/components/ui/button";
import { useFormatDateTime } from "@/hooks/use-format-datetime";

type EventExpandedDetailsProps = {
  event: EventRow;
};

export function EventExpandedDetails({ event }: EventExpandedDetailsProps) {
  const [showLog, setShowLog] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const { timezone } = useFormatDateTime();

  const details = [...enrichmentDetailRows(event, timezone), ...payloadDetailRows(event)];
  const isLog = isContainerLogEvent(event);
  const hasPayload = event.payload && Object.keys(event.payload).length > 0;

  return (
    <div className="space-y-3">
      {details.length > 0 ? (
        <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-4 gap-y-1.5 text-xs">
          {details.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-zinc-500">{row.label}</dt>
              <dd className="font-mono text-zinc-300 break-all">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {isLog && event.raw_log ? (
        <div className="space-y-2">
          {!showLog ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowLog(true)}>
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              View log excerpt
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500">Docker log tail</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowLog(false)}>
                  Hide log
                </Button>
              </div>
              <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-300 whitespace-pre-wrap">
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
            onClick={() => setShowJson((v) => !v)}
          >
            {showJson ? "Hide raw JSON" : "Show raw JSON"}
          </Button>
          {showJson ? (
            <pre className="max-h-48 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-500">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
