"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Terminal, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ThreatCommandDetail, ThreatCommandRow, ThreatCommandStats } from "@/lib/enrichment-types";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { notify } from "@/lib/toast";
import { LogViewer } from "@/components/logs/log-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const KINDS = [
  { value: "", label: "All activity" },
  { value: "shell", label: "Shell commands" },
  { value: "http", label: "HTTP requests" },
  { value: "login", label: "Logins" },
  { value: "download", label: "Downloads" },
] as const;

function kindTone(kind: string): "warning" | "info" | "danger" | "default" {
  if (kind === "shell") return "warning";
  if (kind === "http") return "info";
  if (kind === "login") return "danger";
  return "default";
}

export function CommandsTab() {
  const { formatDateTime } = useFormatDateTime();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [applied, setApplied] = useState({ q: "", kind: "" });
  const [busy, setBusy] = useState<"scan" | "dedupe" | "delete" | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);
  const [detailState, setDetailState] = useState<{ id: string; nonce: number; row: ThreatCommandDetail | null } | null>(
    null,
  );

  const fetchStats = useCallback(() => apiFetch<ThreatCommandStats>("/enrichment/commands/stats"), []);
  const { data: stats, refetch: refetchStats } = useAsyncData(fetchStats);

  const fetchRows = useCallback(() => {
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (applied.q) params.set("q", applied.q);
    if (applied.kind) params.set("kind", applied.kind);
    return apiFetch<ThreatCommandRow[]>(`/enrichment/commands?${params.toString()}`);
  }, [applied]);
  const { data: rows, loading, error, refetch } = useAsyncData(fetchRows);
  const list = rows ?? [];
  const detail = detailState?.id === openId && detailState.nonce === detailNonce ? detailState.row : null;
  const detailLoading = Boolean(openId) && (detailState?.id !== openId || detailState.nonce !== detailNonce);

  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    apiFetch<ThreatCommandDetail>(`/enrichment/commands/${openId}`)
      .then((row) => {
        if (!cancelled) setDetailState({ id: openId, nonce: detailNonce, row });
      })
      .catch((err) => {
        if (!cancelled) {
          setDetailState({ id: openId, nonce: detailNonce, row: null });
          notify.apiError(err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [openId, detailNonce]);

  function togglePicked(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleVisible() {
    const visible = list.map((row) => row.id);
    const allSelected = visible.length > 0 && visible.every((id) => picked.includes(id));
    setPicked((current) =>
      allSelected ? current.filter((id) => !visible.includes(id)) : [...new Set([...current, ...visible])],
    );
  }

  async function scan() {
    setBusy("scan");
    try {
      const res = await apiFetch<{ events_scanned: number; total_tracked: number }>("/enrichment/commands/scan", {
        method: "POST",
        json: { lookback_hours: 168, limit: 500 },
      });
      notify.success(`Scanned ${res.events_scanned} events — ${res.total_tracked} commands tracked`);
      setDetailNonce((n) => n + 1);
      refetch();
      refetchStats();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(null);
    }
  }

  async function dedupe() {
    setBusy("dedupe");
    try {
      const res = await apiFetch<{ removed: number; remaining: number }>("/enrichment/commands/dedupe", {
        method: "POST",
      });
      notify.success(
        res.removed > 0 ? `Merged ${res.removed} duplicate commands` : "No duplicates to merge",
      );
      setOpenId(null);
      setPicked([]);
      refetch();
      refetchStats();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(null);
    }
  }

  async function removeIds(ids: string[]) {
    if (ids.length === 0) return;
    const label = ids.length === 1 ? "this command" : `${ids.length} commands`;
    if (!confirm(`Remove ${label}? This cannot be undone.`)) return;
    setBusy("delete");
    try {
      const res = await apiFetch<{ removed: number }>("/enrichment/commands/remove", {
        method: "POST",
        json: { ids },
      });
      notify.success(`Removed ${res.removed} ${res.removed === 1 ? "command" : "commands"}`);
      if (openId && ids.includes(openId)) setOpenId(null);
      setPicked((current) => current.filter((id) => !ids.includes(id)));
      refetch();
      refetchStats();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Captured" value={stats.total} />
          <Stat label="Shell" value={stats.shell} />
          <Stat label="HTTP" value={stats.http} />
          <Stat label="Logins" value={stats.login} />
          <Stat label="Source IPs" value={stats.unique_ips} />
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-col gap-4 lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base">Captured commands</CardTitle>
            <CardDescription>
              Shell input, logins, downloads, and web honeypot requests. The same command from the same source is one
              row. Select a row for the full command and the log lines around it. Passwords are not stored.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void dedupe()}>
              {busy === "dedupe" ? <Spinner className="mr-1.5 h-3.5 w-3.5" /> : null}
              Clean duplicates
            </Button>
            <Button type="button" size="sm" disabled={busy !== null} onClick={() => void scan()}>
              {busy === "scan" ? <Spinner className="mr-1.5 h-3.5 w-3.5" /> : <Terminal className="mr-1.5 h-3.5 w-3.5" />}
              Scan recent logs
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied({ q: query.trim(), kind });
            }}
          >
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search command, IP, container, user…"
              className="min-w-[16rem] flex-1 font-mono text-sm"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded-xl border border-line bg-field px-3 py-2 text-sm text-ink"
            >
              {KINDS.map((item) => (
                <option key={item.value || "all"} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm">
              Search
            </Button>
          </form>

          {loading && !rows ? (
            <Spinner />
          ) : error && list.length === 0 ? (
            <p className="text-sm text-rose-300">{error}</p>
          ) : list.length === 0 ? (
            <EmptyState
              icon={Terminal}
              title="No commands captured yet"
              description="Deploy an SSH or web honeypot and scan logs, or wait for the next agent report."
            />
          ) : (
            <TableWrap className="rounded-none border-0 bg-transparent shadow-none">
              <Table>
                <THead>
                  <Tr>
                    <Th className="w-10">
                      <input
                        type="checkbox"
                        checked={list.length > 0 && list.every((row) => picked.includes(row.id))}
                        onChange={toggleVisible}
                        aria-label="Select all commands"
                      />
                    </Th>
                    <Th>When</Th>
                    <Th>Kind</Th>
                    <Th>Where</Th>
                    <Th>Source</Th>
                    <Th>Command</Th>
                    <Th>Seen</Th>
                  </Tr>
                </THead>
                <TBody>
                  {list.map((row) => (
                    <Fragment key={row.id}>
                    <Tr
                      className={cn("cursor-pointer", openId === row.id && "bg-recessed")}
                      onClick={() => setOpenId((current) => (current === row.id ? null : row.id))}
                    >
                      <Td>
                        <input
                          type="checkbox"
                          checked={picked.includes(row.id)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => togglePicked(row.id)}
                          aria-label="Select command"
                        />
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-zinc-500">{formatDateTime(row.observed_at)}</Td>
                      <Td>
                        <Badge tone={kindTone(row.kind)}>{row.kind}</Badge>
                      </Td>
                      <Td className="text-xs">
                        <div className="font-medium text-zinc-200">{row.container ?? "—"}</div>
                        {row.pot_name ? (
                          <Link
                            href={`/pots/${row.pot_id}`}
                            className="text-emerald-400 hover:text-emerald-300"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.pot_name}
                          </Link>
                        ) : (
                          <span className="text-zinc-500">{row.pot_id.slice(0, 8)}</span>
                        )}
                      </Td>
                      <Td className="font-mono text-xs text-zinc-400">
                        {row.src_ip ?? "—"}
                        {row.username ? <div className="text-zinc-500">{row.username}</div> : null}
                      </Td>
                      <Td className="max-w-[28rem] font-mono text-xs text-zinc-200">
                        <span className="block truncate" title={row.command}>
                          {row.command}
                        </span>
                      </Td>
                      <Td className="tabular-nums text-zinc-400">{row.hit_count}</Td>
                    </Tr>
                    {openId === row.id ? (
                      <Tr className="bg-recessed hover:bg-recessed">
                        <Td colSpan={7} className="bg-recessed px-3 py-3">
                          <CommandDetail
                            row={row}
                            detail={detail}
                            loading={detailLoading}
                            removing={busy === "delete"}
                            onClose={() => setOpenId(null)}
                            onRemove={() => void removeIds([row.id])}
                          />
                        </Td>
                      </Tr>
                    ) : null}
                    </Fragment>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CommandDetail({
  row,
  detail,
  loading,
  removing,
  onClose,
  onRemove,
}: {
  row: ThreatCommandRow;
  detail: ThreatCommandDetail | null;
  loading: boolean;
  removing: boolean;
  onClose: () => void;
  onRemove: () => void;
}) {
  const { formatDateTime } = useFormatDateTime();
  const command = detail?.command || row.command;
  const context = detail?.context ?? "";

  return (
    <div className="space-y-3 border-l-2 border-line pl-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={kindTone(row.kind)}>{row.kind}</Badge>
          <span className="text-sm font-medium text-zinc-200">{row.container ?? "Unknown container"}</span>
          {row.pot_name ? (
            <Link href={`/pots/${row.pot_id}`} className="text-sm text-emerald-400 hover:text-emerald-300">
              {row.pot_name}
            </Link>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" variant="danger" size="sm" className="h-7" disabled={removing} onClick={onRemove}>
            Remove
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onClose} title="Close">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Source" value={row.src_ip ?? "—"} mono />
        <Fact label="User" value={row.username ?? "—"} />
        <Fact label="Session" value={row.session_id ?? "—"} mono />
        <Fact label="Seen" value={String(row.hit_count)} />
        <Fact label="Observed" value={formatDateTime(row.observed_at)} />
        <Fact label="First" value={formatDateTime(row.first_seen_at)} />
        <Fact label="Last" value={formatDateTime(row.last_seen_at)} />
      </dl>
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Command</p>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-5 text-zinc-100">
          {command}
        </pre>
      </div>
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Surrounding logs</p>
        <LogViewer
          text={context}
          mode="snapshot"
          loading={loading}
          showSearch={false}
          emptyLabel={
            loading
              ? "Loading logs…"
              : "No surrounding log lines stored for this capture. Scan recent logs to attach them."
          }
          className="h-72"
        />
      </div>
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className={cn("mt-0.5 text-zinc-300", mono && "font-mono break-all")}>{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
