"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Activity, ChevronDown, ChevronRight, ClipboardList, Container, FileText, Shield } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { AuditLogRow, EventRow, Pot } from "@/lib/types";
import { EventExpandedDetails } from "@/components/events/event-expanded-details";
import { PotContainerLogs } from "@/components/events/pot-container-logs";
import {
  channelTone,
  containerLabel,
  eventOneLiner,
  formatEventTitle,
  hasExpandableContent,
  isContainerLogEvent,
  severityTone,
} from "@/lib/event-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { cn } from "@/lib/utils";

export default function EventsPage() {
  const { formatDateTime, formatRelative } = useFormatDateTime();
  const searchParams = useSearchParams();
  const potFromUrl = searchParams.get("pot_id") ?? searchParams.get("pot") ?? "";

  const [potFilter, setPotFilter] = useState("");
  const [prevPotFromUrl, setPrevPotFromUrl] = useState(potFromUrl);
  const [includeRaw, setIncludeRaw] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logsOnly, setLogsOnly] = useState(false);
  const [enrichedOnly, setEnrichedOnly] = useState(false);

  if (potFromUrl !== prevPotFromUrl) {
    setPrevPotFromUrl(potFromUrl);
    setPotFilter(potFromUrl);
  }

  const fetchPots = useCallback(() => apiFetch<Pot[]>("/pots"), []);
  const { data: pots } = useAsyncData(fetchPots);

  const selectedPot = useMemo(
    () => (pots ?? []).find((p) => p.id === potFilter.trim()),
    [pots, potFilter],
  );

  const eventsQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "120");
    if (potFilter.trim()) p.set("pot_id", potFilter.trim());
    if (includeRaw) p.set("include_raw", "true");
    if (logsOnly) p.set("event_type_prefix", "watchpot.agent.container_logs");
    if (enrichedOnly) p.set("enriched_only", "true");
    return `/events?${p.toString()}`;
  }, [potFilter, includeRaw, logsOnly, enrichedOnly]);

  const fetchEvents = useCallback(() => apiFetch<EventRow[]>(eventsQuery), [eventsQuery]);
  const { data: events, loading, error, refetch } = useAsyncData(fetchEvents);

  const fetchAudit = useCallback(() => apiFetch<AuditLogRow[]>("/audit-logs?limit=80"), []);
  const {
    data: auditRows,
    loading: auditLoading,
    error: auditError,
    refetch: refetchAudit,
  } = useAsyncData(fetchAudit);

  const list = events ?? [];
  const audits = auditRows ?? [];
  const containerLogEvents = list.filter(isContainerLogEvent);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Events & audit"
        description="Workload and honeypot container logs flow in as runtime events. Select a pot to view live docker logs for deployed containers and browse the ingested log stream. For multi-pot live tails, use the log wall."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Event stream filters</CardTitle>
          <CardDescription>
            Container logs appear as <code className="text-zinc-500">watchpot.agent.container_logs</code> (agent tails each
            running stack container on every infra report).{" "}
            <Link href="/log-wall" className="text-emerald-400 hover:underline">
              Open log wall
            </Link>{" "}
            to watch live docker logs across many pots.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="min-w-[14rem] flex-1">
            <Label htmlFor="pot-select">Pot</Label>
            <select
              id="pot-select"
              value={potFilter}
              onChange={(e) => setPotFilter(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-zinc-100"
            >
              <option value="">All pots</option>
              {(pots ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.heartbeat_online ? "· live" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[10rem]">
            <Label htmlFor="pot-id">Or pot UUID</Label>
            <Input
              id="pot-id"
              placeholder="UUID"
              value={potFilter}
              onChange={(e) => setPotFilter(e.target.value)}
              className="mt-1 font-mono text-xs"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={includeRaw}
              onChange={(e) => setIncludeRaw(e.target.checked)}
              className="rounded border-zinc-600"
            />
            Include docker log body
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={logsOnly}
              onChange={(e) => setLogsOnly(e.target.checked)}
              className="rounded border-zinc-600"
              disabled={!potFilter.trim()}
            />
            Container logs only
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={enrichedOnly}
              onChange={(e) => setEnrichedOnly(e.target.checked)}
              className="rounded border-zinc-600"
            />
            Threat matches only
          </label>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      {potFilter.trim() ? (
        <PotContainerLogs
          potId={potFilter.trim()}
          potName={selectedPot?.name}
          autoLoad
        />
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
          <button
            type="button"
            className="ml-3 text-red-300 underline underline-offset-2 hover:text-red-100"
            onClick={() => void refetch()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {potFilter.trim() && containerLogEvents.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Container className="h-4 w-4 text-zinc-500" />
              Ingested container logs ({containerLogEvents.length})
            </CardTitle>
            <CardDescription>
              Latest docker log tails from the agent for containers on this pot. Open a row below for the full excerpt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {containerLogEvents.slice(0, 8).map((e) => {
              const name = containerLabel(e);
              return (
                <div key={e.id} className="rounded-lg border border-zinc-800/90 bg-zinc-950/50 overflow-hidden">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-900/50"
                    onClick={() => setExpandedId((id) => (id === e.id ? null : e.id))}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 shrink-0 text-emerald-500" />
                      <span className="font-medium text-zinc-200 truncate">{name ?? "container"}</span>
                      <span className="text-xs text-zinc-500 tabular-nums shrink-0">
                        {formatDateTime(e.received_at)}
                      </span>
                    </span>
                    {expandedId === e.id ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                    )}
                  </button>
                  {expandedId === e.id && e.raw_log ? (
                    <pre className="border-t border-zinc-800/80 px-3 py-3 max-h-64 overflow-auto font-mono text-xs text-zinc-400 whitespace-pre-wrap">
                      {e.raw_log}
                    </pre>
                  ) : expandedId === e.id ? (
                    <p className="border-t border-zinc-800/80 px-3 py-3 text-xs text-zinc-500">
                      Enable “Include docker log body” to load log text.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-zinc-500">
              <Spinner />
              <span className="text-sm">Loading events…</span>
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No events in this view"
              description={
                potFilter.trim()
                  ? "Deploy a stack on this pot and ensure the agent is running — container logs arrive on each infra report."
                  : "Select a pot, run an agent with infra reporting, or open the log wall for multi-container tails."
              }
            />
          ) : (
            <TableWrap className="rounded-none border-0 bg-transparent">
              <Table>
                <THead>
                  <tr>
                    <Th className="w-8" />
                    <Th>Time</Th>
                    <Th>Event</Th>
                    <Th>Summary</Th>
                    <Th>Channel</Th>
                    <Th>Severity</Th>
                    {!potFilter.trim() ? <Th>Pot</Th> : null}
                  </tr>
                </THead>
                <TBody>
                  {list.map((e) => {
                    const expandable = hasExpandableContent(e);
                    const open = expandedId === e.id;
                    const summary = eventOneLiner(e);
                    const time = formatRelative(e.received_at);
                    return (
                      <Fragment key={e.id}>
                        <Tr
                          className={cn(expandable && "cursor-pointer hover:bg-zinc-900/30")}
                          onClick={() => expandable && setExpandedId(open ? null : e.id)}
                        >
                          <Td className="w-8 text-zinc-600">
                            {expandable ? (open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
                          </Td>
                          <Td mono className="whitespace-nowrap text-zinc-400" title={time.full}>
                            {time.short}
                          </Td>
                          <Td>
                            <div className="min-w-0">
                              <p className="font-medium text-zinc-200">{formatEventTitle(e.event_type)}</p>
                              <p className="text-[10px] font-mono text-zinc-600 truncate" title={e.event_type}>
                                {e.event_type}
                              </p>
                            </div>
                          </Td>
                          <Td className="max-w-[220px] truncate text-sm text-zinc-500" title={summary ?? undefined}>
                            {summary ?? "—"}
                          </Td>
                          <Td>
                            <Badge tone={channelTone(e.channel)}>{e.channel}</Badge>
                          </Td>
                          <Td>
                            <Badge tone={severityTone(e.severity)}>{e.severity}</Badge>
                          </Td>
                          {!potFilter.trim() ? (
                            <Td mono className="max-w-[90px] truncate text-xs text-zinc-500">
                              <Link href={`/events?pot_id=${e.pot_id}`} className="hover:text-emerald-400" onClick={(ev) => ev.stopPropagation()}>
                                {e.pot_id.slice(0, 8)}…
                              </Link>
                            </Td>
                          ) : null}
                        </Tr>
                        {open ? (
                          <tr key={`${e.id}-detail`} className="bg-zinc-950/60">
                            <td colSpan={potFilter.trim() ? 6 : 7} className="px-4 py-3">
                              <EventExpandedDetails event={e} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {selectedPot ? (
        <p className="text-sm text-zinc-500">
          Managing this pot:{" "}
          <Link href={`/pots/${selectedPot.id}`} className="text-emerald-400 hover:underline">
            {selectedPot.name}
          </Link>
        </p>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-zinc-500" />
            <h2 className="text-lg font-semibold text-zinc-100">Audit log</h2>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAudit((s) => !s)}>
            {showAudit ? "Hide" : "Show"} audit entries
          </Button>
        </div>
        <p className="text-sm text-zinc-500">
          Append-only record of authenticated API actions. Distinct from the live event stream.
        </p>

        {showAudit ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-zinc-500" />
                Recent audit rows
              </CardTitle>
              <Button type="button" variant="ghost" size="sm" onClick={() => void refetchAudit()}>
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {auditError ? <p className="px-6 py-4 text-sm text-red-300">{auditError}</p> : null}
              {auditLoading ? (
                <div className="flex items-center gap-2 px-6 py-12 text-zinc-500">
                  <Spinner />
                  Loading…
                </div>
              ) : (
                <TableWrap className="rounded-none border-0 bg-transparent">
                  <Table>
                    <THead>
                      <tr>
                        <Th>Time</Th>
                        <Th>Action</Th>
                        <Th>Resource</Th>
                      </tr>
                    </THead>
                    <TBody>
                      {audits.map((a) => (
                        <Tr key={a.id}>
                          <Td mono className="whitespace-nowrap text-zinc-400 text-xs">
                            {formatDateTime(a.created_at)}
                          </Td>
                          <Td className="text-zinc-200">{a.action}</Td>
                          <Td className="text-xs text-zinc-500">
                            {a.resource_type ?? "—"} {a.resource_id ? `· ${a.resource_id}` : ""}
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
