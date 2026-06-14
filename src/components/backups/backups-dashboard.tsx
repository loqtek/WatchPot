"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  Box,
  CalendarClock,
  Camera,
  Clock,
  Container,
  HardDrive,
  Play,
  Server,
  Settings2,
  Trash2,
} from "lucide-react";
import { BackupManageModal } from "@/components/backups/backup-manage-modal";
import { apiFetch, getApiBase, getToken } from "@/lib/api";
import {
  backupStatusTone,
  backupTypeLabel,
  formatBytes,
  intervalLabel,
  shortHash,
  storageLocationLabel,
  storageLocationTone,
} from "@/lib/backup-utils";
import type {
  BackupJobRow,
  BackupScheduleRow,
  Pot,
  PotContainer,
  PotInfra,
  SnapshotRow,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableEmptyRow, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/ui/data-table";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

type TabId = "repository" | "run" | "schedules" | "host";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "repository", label: "Repository", icon: Archive },
  { id: "run", label: "Run backup", icon: Play },
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "host", label: "Host snapshots", icon: Server },
];

export function BackupsDashboard() {
  const [tab, setTab] = useState<TabId>("repository");

  const fetchJobs = useCallback(() => apiFetch<BackupJobRow[]>("/backups/jobs"), []);
  const fetchSchedules = useCallback(() => apiFetch<BackupScheduleRow[]>("/backups/schedules"), []);
  const fetchSnapshots = useCallback(() => apiFetch<SnapshotRow[]>("/snapshots"), []);
  const fetchPots = useCallback(() => apiFetch<Pot[]>("/pots"), []);

  const { data: jobs, loading: jobsLoading, error: jobsError, refetch: refetchJobs } = useAsyncData(fetchJobs);
  const {
    data: schedules,
    loading: schedulesLoading,
    error: schedulesError,
    refetch: refetchSchedules,
  } = useAsyncData(fetchSchedules);
  const { data: snapshots, loading: snapsLoading, refetch: refetchSnapshots } = useAsyncData(fetchSnapshots);
  const { data: pots } = useAsyncData(fetchPots);

  const jobList = useMemo(() => jobs ?? [], [jobs]);
  const scheduleList = useMemo(() => schedules ?? [], [schedules]);
  const snapList = snapshots ?? [];
  const potList = pots ?? [];

  const stats = useMemo(() => {
    const completed = jobList.filter((j) => j.status === "completed").length;
    const failed = jobList.filter((j) => j.status === "failed").length;
    const active = jobList.filter((j) => j.status === "pending" || j.status === "running").length;
    const totalBytes = jobList.reduce((sum, j) => sum + (j.artifact_size ?? 0), 0);
    return { completed, failed, active, totalBytes, schedules: scheduleList.filter((s) => s.enabled).length };
  }, [jobList, scheduleList]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Backups"
        description="Capture container and pot images as portable archives. Schedule recurring backups and keep a catalog for transfer, restore, and forensic analysis."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Completed jobs" value={stats.completed} icon={Camera} />
        <StatTile label="Active jobs" value={stats.active} icon={Clock} tone={stats.active ? "info" : "default"} />
        <StatTile label="Stored artifacts" value={formatBytes(stats.totalBytes)} icon={HardDrive} />
        <StatTile label="Active schedules" value={stats.schedules} icon={CalendarClock} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-800/80 pb-px">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px",
              tab === t.id
                ? "border-emerald-500 text-emerald-300"
                : "border-transparent text-zinc-500 hover:text-zinc-300",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "repository" ? (
        <RepositoryTab
          jobs={jobList}
          jobsLoading={jobsLoading}
          jobsError={jobsError}
          snapshots={snapList}
          snapsLoading={snapsLoading}
          onRefresh={() => {
            void refetchJobs();
            void refetchSnapshots();
          }}
          onDeleteJob={async (id) => {
            await apiFetch(`/backups/jobs/${id}`, { method: "DELETE" });
            await refetchJobs();
          }}
        />
      ) : null}

      {tab === "run" ? (
        <RunBackupTab
          pots={potList}
          onCreated={() => {
            void refetchJobs();
            void refetchSnapshots();
            setTab("repository");
          }}
        />
      ) : null}

      {tab === "schedules" ? (
        <SchedulesTab
          pots={potList}
          schedules={scheduleList}
          loading={schedulesLoading}
          error={schedulesError}
          onRefresh={() => void refetchSchedules()}
        />
      ) : null}

      {tab === "host" ? <HostSnapshotsComingSoon /> : null}
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "info";
}) {
  return (
    <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/40 px-4 py-3">
      <div className="flex items-center gap-2 text-zinc-500">
        <Icon className="h-4 w-4" />
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "info" ? "text-sky-300" : "text-zinc-100")}>
        {value}
      </p>
    </div>
  );
}

function JobRow({
  job,
  onManage,
}: {
  job: BackupJobRow;
  onManage: () => void;
}) {
  const { formatDateTime } = useFormatDateTime();
  return (
    <Tr>
      <Td>
        <span className="font-medium text-zinc-100">{job.name}</span>
        {job.error ? <p className="mt-0.5 text-xs text-red-400 line-clamp-2">{job.error}</p> : null}
        {job.ingest_status ? (
          <p className="mt-0.5 text-[10px] text-zinc-500">Transfer: {job.ingest_status}</p>
        ) : null}
      </Td>
      <Td>
        <div className="text-sm text-zinc-300">{backupTypeLabel(job.backup_type)}</div>
        <div className="text-xs text-zinc-500">
          {job.pot_name ?? job.pot_id.slice(0, 8) + "…"}
          {job.container ? ` · ${job.container}` : null}
        </div>
      </Td>
      <Td>
        <Badge tone={storageLocationTone(job.storage_location)} className="text-[10px]">
          {storageLocationLabel(job.storage_location)}
        </Badge>
      </Td>
      <Td mono className="text-[10px] text-zinc-500" title={job.artifact_sha256 ?? undefined}>
        {shortHash(job.artifact_sha256)}
      </Td>
      <Td>
        <Badge tone={backupStatusTone(job.status)}>{job.status}</Badge>
      </Td>
      <Td mono className="text-zinc-400">
        {formatBytes(job.artifact_size)}
      </Td>
      <Td mono className="whitespace-nowrap text-zinc-500 text-xs">
        {formatDateTime(job.created_at)}
      </Td>
      <Td>
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onManage}>
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            Manage
          </Button>
        </div>
      </Td>
    </Tr>
  );
}

async function downloadArtifact(artifactId: string, filename: string) {
  const url = `${getApiBase().replace(/\/$/, "")}/backups/artifacts/${artifactId}/download`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : "Download failed");
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

function RepositoryTab({
  jobs,
  jobsLoading,
  jobsError,
  snapshots,
  snapsLoading,
  onRefresh,
  onDeleteJob,
}: {
  jobs: BackupJobRow[];
  jobsLoading: boolean;
  jobsError: string | null;
  snapshots: SnapshotRow[];
  snapsLoading: boolean;
  onRefresh: () => void;
  onDeleteJob: (id: string) => Promise<void>;
}) {
  const { formatDateTime } = useFormatDateTime();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manageJobId, setManageJobId] = useState<string | null>(null);
  const manageJob = manageJobId ? (jobs.find((j) => j.id === manageJobId) ?? null) : null;

  async function ingestJob(jobId: string) {
    setBusyId(jobId);
    try {
      await apiFetch(`/backups/jobs/${jobId}/ingest`, { method: "POST" });
      onRefresh();
      notify.success("Copy to server started");
    } catch (e) {
      notify.apiError(e, "Copy to server failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      <BackupManageModal
        open={manageJobId !== null}
        job={manageJob}
        busy={busyId !== null}
        onClose={() => setManageJobId(null)}
        onRefresh={onRefresh}
        onCopyToServer={() => {
          if (manageJob) void ingestJob(manageJob.id);
        }}
        onDownload={(artifactId, name) => {
          setBusyId(artifactId);
          void downloadArtifact(artifactId, name)
            .then(() => notify.success("Download started"))
            .catch((e) => notify.apiError(e, "Download failed"))
            .finally(() => setBusyId(null));
        }}
        onDelete={() => {
          if (!manageJob) return;
          if (confirm(`Delete backup job "${manageJob.name}"?`)) {
            setBusyId(manageJob.id);
            void onDeleteJob(manageJob.id)
              .then(() => {
                setManageJobId(null);
                onRefresh();
                notify.success("Backup deleted");
              })
              .catch((e) => notify.apiError(e, "Delete failed"))
              .finally(() => setBusyId(null));
          }
        }}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-200">Backup jobs</h2>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          Backups are stored on the <strong className="text-zinc-400">pot agent</strong> by default. Copy verified
          archives to the <strong className="text-zinc-400">WatchPot server</strong> for download and long-term retention.
          External backup targets are planned.
        </p>
        {jobsError ? <p className="text-sm text-rose-400">{jobsError}</p> : null}
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>Name</Th>
                <Th>Target</Th>
                <Th>Storage</Th>
                <Th>Integrity</Th>
                <Th>Status</Th>
                <Th>Size</Th>
                <Th>Created</Th>
                <Th className="min-w-[8rem]">Actions</Th>
              </tr>
            </THead>
            <TBody>
              {jobsLoading ? (
                <TableEmptyRow colSpan={8}>
                  <span className="inline-flex items-center gap-2">
                    <Spinner size="sm" />
                    Loading…
                  </span>
                </TableEmptyRow>
              ) : jobs.length === 0 ? (
                <TableEmptyRow colSpan={8}>No backup jobs yet. Run a backup to get started.</TableEmptyRow>
              ) : (
                jobs.map((j) => (
                  <JobRow key={j.id} job={j} onManage={() => setManageJobId(j.id)} />
                ))
              )}
            </TBody>
          </Table>
        </TableWrap>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">Image catalog</h2>
        <p className="text-sm text-zinc-500">
          Registered images from completed backups with storage location and SHA-256 fingerprints for transit verification.
        </p>
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>Name</Th>
                <Th>Image / path</Th>
                <Th>Storage</Th>
                <Th>SHA-256</Th>
                <Th>Pot</Th>
                <Th>Created</Th>
              </tr>
            </THead>
            <TBody>
              {snapsLoading ? (
                <TableEmptyRow colSpan={6}>
                  <Spinner size="sm" />
                </TableEmptyRow>
              ) : snapshots.length === 0 ? (
                <TableEmptyRow colSpan={6}>No images in the catalog yet.</TableEmptyRow>
              ) : (
                snapshots.map((s) => {
                  const artifact = s.labels?.artifact_path as string | undefined;
                  const size = s.labels?.artifact_size as number | undefined;
                  const loc = (s.labels?.storage_location as string) || "agent";
                  const sha = s.labels?.artifact_sha256 as string | undefined;
                  return (
                    <Tr key={s.id}>
                      <Td>
                        <span className="font-medium text-zinc-100">{s.name}</span>
                        {s.description ? (
                          <p className="mt-0.5 text-xs text-zinc-500 line-clamp-1">{s.description}</p>
                        ) : null}
                      </Td>
                      <Td>
                        <p className="font-mono text-xs text-zinc-400 truncate max-w-[220px]" title={s.image_reference}>
                          {s.image_reference}
                        </p>
                        {artifact ? (
                          <p className="mt-0.5 font-mono text-[10px] text-zinc-600 truncate max-w-[220px]" title={artifact}>
                            {artifact} {size ? `· ${formatBytes(size)}` : ""}
                          </p>
                        ) : null}
                      </Td>
                      <Td>
                        <Badge tone={storageLocationTone(loc)} className="text-[10px]">
                          {storageLocationLabel(loc)}
                        </Badge>
                      </Td>
                      <Td mono className="text-[10px] text-zinc-500" title={sha}>
                        {shortHash(sha)}
                      </Td>
                      <Td className="text-xs text-zinc-500">
                        {s.pot_id ? (
                          <Link href={`/pots/${s.pot_id}?tab=containers`} className="hover:text-emerald-400">
                            {s.pot_id.slice(0, 8)}…
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td mono className="whitespace-nowrap text-zinc-500 text-xs">
                        {formatDateTime(s.created_at)}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </TBody>
          </Table>
        </TableWrap>
      </section>
    </div>
  );
}

function RunBackupTab({ pots, onCreated }: { pots: Pot[]; onCreated: () => void }) {
  const [potId, setPotId] = useState("");
  const [backupType, setBackupType] = useState<"container" | "pot">("pot");
  const [container, setContainer] = useState("");
  const [name, setName] = useState("");
  const [exportTar, setExportTar] = useState(true);
  const [busy, setBusy] = useState(false);

  const fetchInfra = useCallback(
    () => (potId ? apiFetch<PotInfra>(`/pots/${potId}/infra`) : Promise.resolve(null)),
    [potId],
  );
  const { data: infra, loading: infraLoading } = useAsyncData(fetchInfra);
  const containers = infra?.containers ?? [];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!potId || !name.trim()) return;
    setBusy(true);
    try {
      await apiFetch("/backups/jobs", {
        method: "POST",
        json: {
          name: name.trim(),
          backup_type: backupType,
          pot_id: potId,
          container: backupType === "container" ? container : null,
          export_tar: exportTar,
        },
      });
      setName("");
      onCreated();
      notify.success("Backup queued");
    } catch (er) {
      notify.apiError(er, "Backup failed to queue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run backup now</CardTitle>
          <CardDescription>
            Queues a job on the pot agent. The agent commits containers to images and exports portable tar archives under{" "}
            <code className="text-zinc-400">backups/</code> on the host.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            <div>
              <Label>Pot</Label>
              <select
                value={potId}
                onChange={(e) => {
                  setPotId(e.target.value);
                  setContainer("");
                }}
                className="mt-1 flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-zinc-100"
                required
              >
                <option value="">Select pot…</option>
                {pots.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.heartbeat_online ? "· live" : "· offline"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Backup scope</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={backupType === "pot" ? "primary" : "secondary"}
                  onClick={() => setBackupType("pot")}
                >
                  <Box className="mr-1.5 h-3.5 w-3.5" />
                  Whole pot
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={backupType === "container" ? "primary" : "secondary"}
                  onClick={() => setBackupType("container")}
                >
                  <Container className="mr-1.5 h-3.5 w-3.5" />
                  Single container
                </Button>
              </div>
            </div>

            {backupType === "container" ? (
              <div>
                <Label>Container</Label>
                {infraLoading && potId ? (
                  <p className="mt-2 text-sm text-zinc-500 inline-flex items-center gap-2">
                    <Spinner size="sm" />
                    Loading containers…
                  </p>
                ) : (
                  <select
                    value={container}
                    onChange={(e) => setContainer(e.target.value)}
                    className="mt-1 flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-zinc-100"
                    required
                  >
                    <option value="">Select container…</option>
                    {containers.map((c: PotContainer) => (
                      <option key={c.id + c.name} value={c.name || c.id}>
                        {c.name} ({c.image})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : null}

            <div>
              <Label htmlFor="backup-name">Backup name</Label>
              <Input
                id="backup-name"
                placeholder="e.g. cowrie-weekly"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={exportTar}
                onChange={(e) => setExportTar(e.target.checked)}
                className="rounded border-zinc-600"
              />
              Export portable tar (<code className="text-zinc-500">docker save</code>) for off-host transfer
            </label>

            <Button type="submit" disabled={busy || !potId || !name.trim()}>
              {busy ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Queuing…
                </>
              ) : (
                <>
                  <Play className="mr-1.5 h-4 w-4" />
                  Start backup
                </>
              )}
            </Button>

          </form>
        </CardContent>
      </Card>

      <Card className="border-dashed border-zinc-700/80 bg-zinc-950/30 h-fit">
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-zinc-500 leading-relaxed">
          <p>
            <strong className="text-zinc-400">Pot backup</strong> — commits every container on the host and exports each
            as a tar archive.
          </p>
          <p>
            <strong className="text-zinc-400">Container backup</strong> — one running or stopped container, ideal before
            risky changes.
          </p>
          <p>Artifacts stay on the pot under <code className="text-zinc-400">$WATCHPOT_WORK_DIR/backups/</code>. Copy tars
            with scp/rsync for cold storage or lab analysis.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SchedulesTab({
  pots,
  schedules,
  loading,
  error,
  onRefresh,
}: {
  pots: Pot[];
  schedules: BackupScheduleRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const { formatDateTime } = useFormatDateTime();
  const [showForm, setShowForm] = useState(false);
  const [potId, setPotId] = useState("");
  const [backupType, setBackupType] = useState<"container" | "pot">("pot");
  const [container, setContainer] = useState("");
  const [name, setName] = useState("");
  const [intervalHours, setIntervalHours] = useState(24);
  const [retention, setRetention] = useState(5);
  const [busy, setBusy] = useState(false);

  const fetchInfra = useCallback(
    () => (potId ? apiFetch<PotInfra>(`/pots/${potId}/infra`) : Promise.resolve(null)),
    [potId],
  );
  const { data: infra } = useAsyncData(fetchInfra);
  const containers = infra?.containers ?? [];

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/backups/schedules", {
        method: "POST",
        json: {
          name: name.trim(),
          backup_type: backupType,
          pot_id: potId,
          container: backupType === "container" ? container : null,
          interval_hours: intervalHours,
          retention_count: retention,
          enabled: true,
          export_tar: true,
        },
      });
      setShowForm(false);
      setName("");
      onRefresh();
      notify.success("Schedule created");
    } catch (er) {
      notify.apiError(er, "Failed to create schedule");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSchedule(id: string, enabled: boolean) {
    try {
      await apiFetch(`/backups/schedules/${id}`, { method: "PATCH", json: { enabled } });
      onRefresh();
      notify.success(enabled ? "Schedule enabled" : "Schedule paused");
    } catch (e) {
      notify.apiError(e, "Could not update schedule");
    }
  }

  async function removeSchedule(id: string) {
    if (!confirm("Delete this schedule?")) return;
    try {
      await apiFetch(`/backups/schedules/${id}`, { method: "DELETE" });
      onRefresh();
      notify.success("Schedule deleted");
    } catch (e) {
      notify.apiError(e, "Could not delete schedule");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">Recurring backups run automatically when the pot agent is online.</p>
        <Button type="button" size="sm" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "Add schedule"}
        </Button>
      </div>
      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void onCreate(e)} className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Schedule name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <Label>Pot</Label>
                <select
                  value={potId}
                  onChange={(e) => setPotId(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm"
                  required
                >
                  <option value="">Select…</option>
                  {pots.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Interval (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={intervalHours}
                  onChange={(e) => setIntervalHours(parseInt(e.target.value, 10) || 24)}
                />
              </div>
              <div>
                <Label>Scope</Label>
                <select
                  value={backupType}
                  onChange={(e) => setBackupType(e.target.value as "container" | "pot")}
                  className="mt-1 flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm"
                >
                  <option value="pot">Whole pot</option>
                  <option value="container">Single container</option>
                </select>
              </div>
              <div>
                <Label>Keep last N backups</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={retention}
                  onChange={(e) => setRetention(parseInt(e.target.value, 10) || 5)}
                />
              </div>
              {backupType === "container" ? (
                <div className="sm:col-span-2">
                  <Label>Container</Label>
                  <select
                    value={container}
                    onChange={(e) => setContainer(e.target.value)}
                    className="mt-1 flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm"
                    required
                  >
                    <option value="">Select…</option>
                    {containers.map((c) => (
                      <option key={c.id + c.name} value={c.name || c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? <Spinner size="sm" className="mr-2" /> : null}
                  Create schedule
                </Button>
              </div>

            </form>
          </CardContent>
        </Card>
      ) : null}

      <TableWrap>
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Target</Th>
              <Th>Interval</Th>
              <Th>Next run</Th>
              <Th>Status</Th>
              <Th className="w-28" />
            </tr>
          </THead>
          <TBody>
            {loading ? (
              <TableEmptyRow colSpan={6}>
                <Spinner size="sm" />
              </TableEmptyRow>
            ) : schedules.length === 0 ? (
              <TableEmptyRow colSpan={6}>No schedules configured.</TableEmptyRow>
            ) : (
              schedules.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-medium text-zinc-100">{s.name}</Td>
                  <Td className="text-sm text-zinc-400">
                    {backupTypeLabel(s.backup_type)}
                    <span className="block text-xs text-zinc-600">
                      {s.pot_name ?? s.pot_id.slice(0, 8) + "…"}
                      {s.container ? ` · ${s.container}` : ""}
                    </span>
                  </Td>
                  <Td>{intervalLabel(s.interval_hours)}</Td>
                  <Td mono className="text-xs text-zinc-500">
                    {s.next_run_at ? formatDateTime(s.next_run_at) : "—"}
                  </Td>
                  <Td>
                    <Badge tone={s.enabled ? "success" : "default"}>{s.enabled ? "Enabled" : "Paused"}</Badge>
                  </Td>
                  <Td>
                    <div className="flex gap-1 justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => void toggleSchedule(s.id, !s.enabled)}
                      >
                        {s.enabled ? "Pause" : "Enable"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-zinc-500 hover:text-red-400"
                        onClick={() => void removeSchedule(s.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
    </div>
  );
}

function HostSnapshotsComingSoon() {
  return (
    <Card className="border-dashed border-amber-500/25 bg-amber-500/5">
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
            <Server className="h-6 w-6" />
          </div>
          <div>
            <CardTitle className="text-lg">Host snapshots — coming soon</CardTitle>
            <CardDescription className="mt-2 max-w-2xl text-sm leading-relaxed">
              Full pot host backups will capture the entire machine state: filesystem checkpoints, Docker volume data,
              compose definitions, and agent configuration — similar to Proxmox VM snapshots or PBS datastore backups.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="list-inside list-disc space-y-2 text-sm text-zinc-500">
          <li>Point-in-time host images for disaster recovery</li>
          <li>Encrypted export bundles for off-site transfer</li>
          <li>Incremental schedules with deduplication</li>
          <li>One-click restore to a new pot or lab environment</li>
        </ul>
        <p className="mt-4 text-xs text-amber-400/80">
          Use container and pot backups today for image-level preservation and analysis.
        </p>
      </CardContent>
    </Card>
  );
}
