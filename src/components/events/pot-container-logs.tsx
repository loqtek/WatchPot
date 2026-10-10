"use client";

import { useCallback, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { PotInfra } from "@/lib/types";
import { LogViewer } from "@/components/logs/log-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncData } from "@/hooks/use-async-data";
import { useLogStream } from "@/hooks/use-log-stream";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { cn } from "@/lib/utils";

type PotContainerLogsProps = {
  potId: string;
  potName?: string;
  autoLoad?: boolean;
};

export function PotContainerLogs({ potId, potName, autoLoad = true }: PotContainerLogsProps) {
  const { formatDateTime } = useFormatDateTime();
  const fetchInfra = useCallback(() => apiFetch<PotInfra>(`/pots/${potId}/infra`), [potId]);
  const { data: infra, loading, error, refetch } = useAsyncData(fetchInfra);

  const containers = infra?.containers ?? [];
  const running = containers.filter(
    (c) => c.state.toLowerCase().includes("running") || c.status.toLowerCase().startsWith("up"),
  );

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [tail, setTail] = useState(200);
  const activeId = pickedId ?? (autoLoad ? running[0]?.id ?? null : null);
  const selected = containers.find((c) => c.id === activeId) ?? null;
  const stream = useLogStream({
    potId,
    container: selected?.name || selected?.id || "",
    tail,
    enabled: Boolean(selected),
  });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-500" />
            Docker logs · {potName ?? "pot"}
          </CardTitle>
          <CardDescription>
            New lines append in place. Scrolling up pauses follow; Latest jumps back to the end.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Refresh list
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-zinc-500">Could not load container list.</p>
        ) : null}

        {loading && containers.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-zinc-500 text-sm">
            <Spinner />
            Loading containers…
          </div>
        ) : containers.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No containers reported yet. Deploy a stack on this pot and wait for the agent infra snapshot.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {containers.map((c) => (
                <button
                  key={c.id + c.name}
                  type="button"
                  onClick={() => setPickedId(c.id)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    selected?.name === c.name
                      ? "border-ink bg-surface text-ink ring-1 ring-ink"
                      : "border-line bg-surface text-ink hover:bg-recessed",
                  )}
                >
                  <span className="font-medium">{c.name || c.id}</span>
                  {c.stack_name ? (
                    <Badge tone="info" className="ml-2 normal-case tracking-normal">
                      {c.stack_name}
                    </Badge>
                  ) : null}
                  <span className="mt-0.5 block text-[10px] text-zinc-600 truncate max-w-[14rem]">{c.image}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div>
                <Label htmlFor="log-tail">Tail lines (live)</Label>
                <Input
                  id="log-tail"
                  type="number"
                  min={10}
                  max={5000}
                  value={tail}
                  onChange={(e) => setTail(Number(e.target.value) || 150)}
                  className="mt-1 w-24"
                />
              </div>
              {selected ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={stream.loading || stream.liveFetching}
                  onClick={() => void stream.refresh()}
                >
                  {stream.liveFetching ? <Spinner size="sm" className="mr-1" /> : null}
                  Refresh
                </Button>
              ) : null}
              {stream.updatedAt ? (
                <span className="text-xs text-zinc-500">
                  {stream.liveFetching
                    ? "Updating…"
                    : `${stream.source === "live" ? "Live" : "Cached"} · ${formatDateTime(stream.updatedAt)}`}
                </span>
              ) : null}
            </div>

            <LogViewer
              text={stream.text}
              loading={stream.loading || stream.liveFetching}
              error={stream.error}
              mode="stream"
              emptyLabel={selected ? "No log lines yet." : "Select a container to view logs."}
              className="h-[min(28rem,50vh)]"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
