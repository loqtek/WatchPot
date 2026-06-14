"use client";

import { useCallback } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { EventRow } from "@/lib/types";
import { EventListItem } from "@/components/events/event-list-item";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncData } from "@/hooks/use-async-data";

type PotEventsPanelProps = {
  potId: string;
};

export function PotEventsPanel({ potId }: PotEventsPanelProps) {
  const fetchEvents = useCallback(
    () =>
      apiFetch<EventRow[]>(
        `/events?pot_id=${potId}&channels=runtime,infra,control&limit=50&include_raw=true`,
      ),
    [potId],
  );
  const { data: events, loading, error, refetch } = useAsyncData(fetchEvents);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Recent events</CardTitle>
          <CardDescription>
            Runtime, infra, and control-plane activity. Expand a row for details or log excerpts.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => void refetch()}>
            Refresh
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/log-wall?pot_id=${potId}`}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              Log wall
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {loading && !events ? (
          <div className="flex items-center gap-2 py-8 text-zinc-500">
            <Spinner />
            Loading…
          </div>
        ) : !events?.length ? (
          <p className="text-sm text-zinc-500">No events for this pot yet.</p>
        ) : (
          <ul className="space-y-2 overflow-y-auto pr-1">
            {events.map((ev) => (
              <EventListItem key={ev.id} event={ev} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
