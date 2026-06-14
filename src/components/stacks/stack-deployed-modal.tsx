"use client";

import Link from "next/link";
import { CheckCircle2, Clock, Layers, Server, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StackDeployStatus = "deployed" | "queued" | "failed";

export type StackDeployedInfo = {
  stackId: string;
  stackName: string;
  revision: number;
  templateLabel?: string;
  ports: string[];
  status: StackDeployStatus;
  statusDetail?: string;
};

type StackDeployedModalProps = {
  open: boolean;
  potId: string;
  info: StackDeployedInfo | null;
  onClose: () => void;
};

function statusMeta(status: StackDeployStatus) {
  switch (status) {
    case "deployed":
      return {
        label: "Containers started",
        tone: "success" as const,
        icon: CheckCircle2,
        iconClass: "text-emerald-400",
      };
    case "queued":
      return {
        label: "Deploy queued",
        tone: "warning" as const,
        icon: Clock,
        iconClass: "text-amber-400",
      };
    case "failed":
      return {
        label: "Deploy failed",
        tone: "danger" as const,
        icon: XCircle,
        iconClass: "text-red-400",
      };
  }
}

export function StackDeployedModal({ open, potId, info, onClose }: StackDeployedModalProps) {
  if (!open || !info) return null;

  const meta = statusMeta(info.status);
  const StatusIcon = meta.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stack-deployed-title"
    >
      <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm" aria-hidden />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-emerald-500/30 bg-zinc-900 shadow-2xl shadow-black/50">
        <div className="space-y-4 px-6 py-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
              <Layers className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 id="stack-deployed-title" className="text-lg font-semibold text-zinc-100">
                Stack deployed
              </h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                <span className="font-medium text-zinc-200">{info.stackName}</span> is ready on this pot.
              </p>
            </div>
          </div>

          <dl className="space-y-2 rounded-xl border border-zinc-800/90 bg-zinc-950/50 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-zinc-500">Revision</dt>
              <dd className="font-mono text-zinc-200">#{info.revision}</dd>
            </div>
            {info.templateLabel ? (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500">Template</dt>
                <dd className="text-zinc-300">{info.templateLabel}</dd>
              </div>
            ) : null}
            {info.ports.length > 0 ? (
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-zinc-500">Host ports</dt>
                <dd className="text-right font-mono text-xs text-zinc-300">{info.ports.join(", ")}</dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 pt-1">
              <dt className="text-zinc-500">Status</dt>
              <dd className="flex items-center gap-2">
                <StatusIcon className={cn("h-4 w-4", meta.iconClass)} />
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </dd>
            </div>
          </dl>

          {info.statusDetail ? (
            <p className="text-xs leading-relaxed text-zinc-500">{info.statusDetail}</p>
          ) : info.status === "deployed" ? (
            <p className="text-xs leading-relaxed text-zinc-500">
              Docker Compose is up. View containers to monitor status, logs, and controls.
            </p>
          ) : info.status === "queued" ? (
            <p className="text-xs leading-relaxed text-zinc-500">
              The agent will start this stack automatically when it next connects.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-zinc-800/90 px-6 py-4 sm:flex-row">
          <Button type="button" className="flex-1" onClick={onClose}>
            <Server className="mr-1.5 h-4 w-4" />
            View containers
          </Button>
          <Button type="button" variant="outline" className="flex-1" asChild>
            <Link href={`/pots/${potId}/stacks/${info.stackId}`}>Open stack editor</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
