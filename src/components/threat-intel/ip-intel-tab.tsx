"use client";

import { useCallback, useMemo, useState } from "react";
import { Globe, MapPin, RefreshCw, Scan, ShieldAlert } from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  ATTACK_TYPE_LABELS,
  IP_STATUS_OPTIONS,
  toneForIpStatus,
  type IpIntelStats,
  type ThreatIp,
} from "@/lib/enrichment-types";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { notify } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

function geoLine(geo: ThreatIp["geo"]) {
  if (!geo) return "—";
  const parts = [geo.city, geo.region, geo.country].filter(Boolean);
  return parts.join(", ") || geo.country_code || "—";
}

export function IpIntelTab() {
  const { formatDateTime } = useFormatDateTime();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<ThreatIp | null>(null);
  const [busy, setBusy] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");

  const fetchStats = useCallback(() => apiFetch<IpIntelStats>("/enrichment/ips/stats"), []);
  const { data: stats, refetch: refetchStats } = useAsyncData(fetchStats);

  const listQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "150");
    if (query.trim()) p.set("q", query.trim());
    if (statusFilter) p.set("status", statusFilter);
    return `/enrichment/ips?${p.toString()}`;
  }, [query, statusFilter]);

  const fetchIps = useCallback(() => apiFetch<ThreatIp[]>(listQuery), [listQuery]);
  const { data: ips, loading, refetch } = useAsyncData(fetchIps);

  const list = ips ?? [];

  async function scanEvents() {
    setBusy(true);
    try {
      const res = await apiFetch<{ events_scanned: number; ips_found: number; total_tracked: number }>(
        "/enrichment/ips/scan",
        { method: "POST", json: { lookback_hours: 168, limit: 500 } },
      );
      notify.success(`Scanned ${res.events_scanned} events — ${res.total_tracked} IPs tracked`);
      refetch();
      refetchStats();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function lookupSelected() {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await apiFetch<ThreatIp>(`/enrichment/ips/${encodeURIComponent(selected.ip_address)}/lookup`, {
        method: "POST",
      });
      setSelected(updated);
      refetch();
      notify.success("Geo lookup refreshed");
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    if (!selected) return;
    try {
      const updated = await apiFetch<ThreatIp>(`/enrichment/ips/${encodeURIComponent(selected.ip_address)}`, {
        method: "PATCH",
        json: { user_notes: notesDraft || null },
      });
      setSelected(updated);
      refetch();
      notify.success("Notes saved");
    } catch (e) {
      notify.apiError(e);
    }
  }

  async function setStatus(status: ThreatIp["status"]) {
    if (!selected) return;
    try {
      const updated = await apiFetch<ThreatIp>(`/enrichment/ips/${encodeURIComponent(selected.ip_address)}`, {
        method: "PATCH",
        json: { status },
      });
      setSelected(updated);
      refetch();
      refetchStats();
    } catch (e) {
      notify.apiError(e);
    }
  }

  function openDetail(row: ThreatIp) {
    setSelected(row);
    setNotesDraft(row.user_notes ?? "");
  }

  return (
    <div className="space-y-6">
      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Tracked IPs</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{stats.total}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Suspicious</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-300">{stats.suspicious}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Watchlist</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-red-300">{stats.watchlist}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">With geo data</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{stats.with_geo}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-base">Bad IP intelligence</CardTitle>
              <CardDescription>
                Public source IPs extracted from honeypot logs and enrichment matches. Geo from ip-api.com;
                optional AbuseIPDB score in settings.
              </CardDescription>
            </div>
            <Button type="button" size="sm" disabled={busy} onClick={scanEvents}>
              {busy ? <Spinner className="h-3.5 w-3.5" /> : <Scan className="mr-1.5 h-3.5 w-3.5" />}
              Scan recent events
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Search IP or notes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-[180px] flex-1 font-mono text-sm"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
              >
                <option value="">All statuses</option>
                {IP_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                Search
              </Button>
            </div>

            {stats?.top_countries?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {stats.top_countries.slice(0, 6).map((c) => (
                  <Badge key={c.key} tone="info" className="text-[10px]">
                    {c.key}: {c.count} hits
                  </Badge>
                ))}
              </div>
            ) : null}

            {loading && !ips ? (
              <Spinner />
            ) : list.length === 0 ? (
              <EmptyState
                icon={Globe}
                title="No IPs tracked yet"
                description="Deploy honeypots and run a scan, or wait for auto-tracking on enriched events."
              />
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <Tr>
                      <Th>IP</Th>
                      <Th>Status</Th>
                      <Th>Location</Th>
                      <Th>Hits</Th>
                      <Th>Abuse</Th>
                      <Th>Last seen</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {list.map((row) => (
                      <Tr
                        key={row.id}
                        className={cn(selected?.id === row.id && "bg-emerald-950/20", "cursor-pointer")}
                        onClick={() => openDetail(row)}
                      >
                        <Td className="font-mono text-sm text-zinc-200">{row.ip_address}</Td>
                        <Td>
                          <Badge tone={toneForIpStatus(row.status)}>{row.status}</Badge>
                        </Td>
                        <Td className="text-xs text-zinc-500 max-w-[160px] truncate">{geoLine(row.geo)}</Td>
                        <Td className="tabular-nums">
                          {row.hit_count}
                          {row.match_count > 0 ? (
                            <span className="text-amber-400/80"> · {row.match_count}m</span>
                          ) : null}
                        </Td>
                        <Td className="tabular-nums">
                          {row.abuse_score != null ? (
                            <span className={row.abuse_score >= 50 ? "text-red-400" : "text-zinc-400"}>
                              {row.abuse_score}
                            </span>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td className="text-xs text-zinc-500">
                          {formatDateTime(row.last_seen_at)}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {selected ? (
            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-lg">{selected.ip_address}</CardTitle>
                <CardDescription className="flex flex-wrap gap-1.5 pt-1">
                  <Badge tone={toneForIpStatus(selected.status)}>{selected.status}</Badge>
                  {selected.is_tor ? <Badge tone="danger">Tor</Badge> : null}
                  {selected.is_hosting ? <Badge tone="warning">Hosting</Badge> : null}
                  {selected.lookup_status ? (
                    <Badge tone={selected.lookup_status === "ok" ? "success" : "default"}>
                      lookup: {selected.lookup_status}
                    </Badge>
                  ) : null}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <MapPin className="h-4 w-4" />
                    <span>{geoLine(selected.geo)}</span>
                  </div>
                  {selected.geo?.isp ? (
                    <p className="text-xs text-zinc-500">ISP: {selected.geo.isp}</p>
                  ) : null}
                  {selected.geo?.org ? (
                    <p className="text-xs text-zinc-500">Org: {selected.geo.org}</p>
                  ) : null}
                  {selected.geo?.asn_label ? (
                    <p className="text-xs font-mono text-zinc-600">{selected.geo.asn_label}</p>
                  ) : null}
                </div>

                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-zinc-500">First seen</dt>
                    <dd>{formatDateTime(selected.first_seen_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Last seen</dt>
                    <dd>{formatDateTime(selected.last_seen_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Hit count</dt>
                    <dd className="tabular-nums">{selected.hit_count}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Threat matches</dt>
                    <dd className="tabular-nums">{selected.match_count}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Abuse score</dt>
                    <dd className="tabular-nums">{selected.abuse_score ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Pots seen</dt>
                    <dd className="tabular-nums">{selected.pot_ids?.length ?? 0}</dd>
                  </div>
                </dl>

                {(selected.attack_types?.length ?? 0) > 0 ? (
                  <div>
                    <p className="text-[10px] uppercase text-zinc-500 mb-1">Attack types</p>
                    <div className="flex flex-wrap gap-1">
                      {selected.attack_types!.map((a) => (
                        <Badge key={a} tone="warning">
                          {ATTACK_TYPE_LABELS[a] ?? a}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {(selected.cve_ids?.length ?? 0) > 0 ? (
                  <div>
                    <p className="text-[10px] uppercase text-zinc-500 mb-1">Related CVEs</p>
                    <div className="flex flex-wrap gap-1 font-mono text-xs text-emerald-400">
                      {selected.cve_ids!.map((c) => (
                        <span key={c}>{c}</span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div>
                  <Label>Operator notes</Label>
                  <Textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    className="mt-1 min-h-[72px] text-xs"
                    placeholder="Investigation notes, ticket IDs…"
                  />
                  <Button type="button" size="sm" className="mt-2" variant="outline" onClick={saveNotes}>
                    Save notes
                  </Button>
                </div>

                <div>
                  <Label>Status</Label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {IP_STATUS_OPTIONS.map((o) => (
                      <Button
                        key={o.value}
                        type="button"
                        size="sm"
                        variant={selected.status === o.value ? "primary" : "outline"}
                        onClick={() => setStatus(o.value)}
                      >
                        {o.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={lookupSelected}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Refresh geo lookup
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center py-10 text-center text-sm text-zinc-500">
                <ShieldAlert className="mb-3 h-8 w-8 text-zinc-600" />
                Select an IP to view geo, abuse score, attack context, and operator notes.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
