"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Archive,
  CloudOff,
  Copy,
  Download,
  ExternalLink,
  HardDrive,
  Server,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { notify } from "@/lib/toast";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import type { BackupJobRow } from "@/lib/types";
import {
  backupStatusTone,
  backupTypeLabel,
  formatBytes,
  storageLocationLabel,
  storageLocationTone,
} from "@/lib/backup-utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type BackupManageModalProps = {
  open: boolean;
  job: BackupJobRow | null;
  busy: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onCopyToServer: () => void;
  onDownload: (artifactId: string, filename: string) => void;
  onDelete: () => void;
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          notify.success("Copied to clipboard");
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      <Copy className="mr-1 h-3 w-3" />
      {copied ? "Copied" : label}
    </Button>
  );
}

export function BackupManageModal({
  open,
  job,
  busy,
  onClose,
  onRefresh,
  onCopyToServer,
  onDownload,
  onDelete,
}: BackupManageModalProps) {
  const { formatDateTime } = useFormatDateTime();
  if (!open || !job) return null;

  const artifacts = job.artifacts ?? [];
  const hasAgentCopy = artifacts.some((a) => a.storage_location === "agent" && a.agent_path);
  const hasServerCopy = artifacts.some((a) => a.storage_location === "server" && a.server_path);
  const canCopyToServer =
    job.status === "completed" &&
    hasAgentCopy &&
    artifacts.some((a) => a.storage_location === "agent" && a.sha256) &&
    job.ingest_status !== "transferring" &&
    job.ingest_status !== "pending";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-manage-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(90vh,48rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800/90 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Archive className="h-5 w-5 shrink-0 text-emerald-400" />
              <h2 id="backup-manage-title" className="truncate text-lg font-semibold text-zinc-100">
                {job.name}
              </h2>
            </div>
            <p className="mt-1 text-sm text-zinc-500">Manage storage location, verify integrity, and export archives.</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone={backupStatusTone(job.status)}>{job.status}</Badge>
            <Badge tone={storageLocationTone(job.storage_location)}>{storageLocationLabel(job.storage_location)}</Badge>
            {job.ingest_status ? <Badge tone="info">Transfer: {job.ingest_status}</Badge> : null}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Scope</dt>
              <dd className="mt-0.5 text-zinc-200">{backupTypeLabel(job.backup_type)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Pot</dt>
              <dd className="mt-0.5 text-zinc-200">{job.pot_name ?? job.pot_id.slice(0, 8) + "…"}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Total size</dt>
              <dd className="mt-0.5 text-zinc-200 tabular-nums">{formatBytes(job.artifact_size)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Created</dt>
              <dd className="mt-0.5 text-zinc-400 text-xs">{formatDateTime(job.created_at)}</dd>
            </div>
            {job.completed_at ? (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Completed</dt>
                <dd className="mt-0.5 text-zinc-400 text-xs">{formatDateTime(job.completed_at)}</dd>
              </div>
            ) : null}
            {job.artifact_sha256 ? (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">SHA-256</dt>
                <dd className="mt-0.5 font-mono text-xs text-zinc-400 break-all">{job.artifact_sha256}</dd>
              </div>
            ) : null}
          </dl>

          {job.error ? <Alert variant="error">{job.error}</Alert> : null}

          <section className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-200">Artifacts</h3>
            {artifacts.length === 0 && !job.artifact_path ? (
              <p className="text-sm text-zinc-500">
                {job.status === "completed"
                  ? "No artifact metadata — re-run the backup to capture paths and hashes."
                  : "Artifacts appear when the backup completes."}
              </p>
            ) : (
              <ul className="space-y-3">
                {artifacts.length > 0
                  ? artifacts.map((a) => (
                      <li
                        key={a.id}
                        className="rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-4 space-y-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={storageLocationTone(a.storage_location)} className="text-[10px]">
                            {storageLocationLabel(a.storage_location)}
                          </Badge>
                          <span className="font-medium text-sm text-zinc-200">
                            {a.container ?? a.image_reference ?? "Archive"}
                          </span>
                          <span className="text-xs text-zinc-500 tabular-nums">{formatBytes(a.size_bytes)}</span>
                          <span className="text-[10px] uppercase text-zinc-600">{a.artifact_format}</span>
                        </div>
                        {(a.sha256 || a.transfer_sha256) && (
                          <p className="font-mono text-[11px] text-zinc-500 break-all" title={a.transfer_sha256 ?? a.sha256 ?? ""}>
                            sha256: {a.transfer_sha256 ?? a.sha256}
                          </p>
                        )}
                        {a.agent_path ? (
                          <div className="flex items-start justify-between gap-2 rounded-lg bg-zinc-900/80 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-semibold uppercase text-sky-500/80">Pot agent</p>
                              <p className="font-mono text-xs text-zinc-400 break-all">{a.agent_path}</p>
                            </div>
                            <CopyButton text={a.agent_path} label="Copy path" />
                          </div>
                        ) : null}
                        {a.server_path ? (
                          <div className="flex items-start justify-between gap-2 rounded-lg bg-zinc-900/80 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-semibold uppercase text-emerald-500/80">WatchPot server</p>
                              <p className="font-mono text-xs text-zinc-400 break-all">{a.server_path}</p>
                            </div>
                            <CopyButton text={a.server_path} label="Copy path" />
                          </div>
                        ) : null}
                        {a.storage_location === "server" && a.server_path ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => onDownload(a.id, `${job.name}-${a.container ?? "backup"}.tar`)}
                          >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            Download from server
                          </Button>
                        ) : null}
                      </li>
                    ))
                  : job.artifact_path && (
                      <li className="rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-4">
                        <Badge tone="info" className="text-[10px]">
                          Pot agent
                        </Badge>
                        <p className="mt-2 font-mono text-xs text-zinc-400 break-all">{job.artifact_path}</p>
                      </li>
                    )}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-dashed border-zinc-700/80 bg-zinc-950/30 p-4">
            <div className="flex items-center gap-2 text-zinc-500">
              <CloudOff className="h-4 w-4" />
              <p className="text-sm font-medium text-zinc-400">External backup store</p>
            </div>
            <p className="mt-1 text-xs text-zinc-600 leading-relaxed">
              Push to S3, PBS, or NFS targets — coming soon. Use Copy to server or manual scp from the agent path today.
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-zinc-800/90 px-6 py-4 sm:flex-row sm:flex-wrap">
          {canCopyToServer ? (
            <Button type="button" disabled={busy} onClick={onCopyToServer}>
              {busy ? <Spinner size="sm" className="mr-2" /> : <Upload className="mr-1.5 h-4 w-4" />}
              Copy to server
            </Button>
          ) : hasServerCopy ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400/90 py-2">
              <Server className="h-3.5 w-3.5" />
              Available on WatchPot server
            </span>
          ) : hasAgentCopy ? (
            <span className="flex items-center gap-1.5 text-xs text-zinc-500 py-2">
              <HardDrive className="h-3.5 w-3.5" />
              Stored on pot agent only
            </span>
          ) : null}

          <Button type="button" variant="outline" disabled={busy} onClick={onRefresh}>
            Refresh status
          </Button>

          {job.pot_id ? (
            <Button type="button" variant="outline" asChild>
              <Link href={`/pots/${job.pot_id}?tab=containers`}>
                <ExternalLink className="mr-1.5 h-4 w-4" />
                View pot
              </Link>
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            className="text-red-400 hover:bg-red-500/10 hover:text-red-300 sm:ml-auto"
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Delete backup
          </Button>
        </div>
      </div>
    </div>
  );
}
