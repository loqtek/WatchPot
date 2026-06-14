"use client";

import { FormEvent, useCallback, useState } from "react";
import Link from "next/link";
import { ChevronRight, Layers, Plus, Server } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Pot } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AgentKeyModal } from "@/components/pots/agent-key-modal";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { notify } from "@/lib/toast";

function heartbeatBadge(p: Pot) {
  if (p.heartbeat_online) return <Badge tone="success">Live</Badge>;
  if (p.last_heartbeat_at) return <Badge tone="danger">Offline</Badge>;
  return <Badge tone="warning">No heartbeat</Badge>;
}

export default function PotsPage() {
  const { formatDateTime } = useFormatDateTime();
  const fetchPots = useCallback(() => apiFetch<Pot[]>("/pots"), []);
  const { data: pots, loading, error, refetch } = useAsyncData(fetchPots);

  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdPotId, setCreatedPotId] = useState<string | null>(null);
  const [createdPotName, setCreatedPotName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const list = pots ?? [];

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreatedKey(null);
    setCreatedPotId(null);
    setCreatedPotName(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<Pot & { agent_key: string }>("/pots", {
        method: "POST",
        json: { name },
      });
      setCreatedKey(res.agent_key);
      setCreatedPotId(res.id);
      setCreatedPotName(res.name);
      setName("");
      await refetch();
      notify.success(`Pot "${res.name}" created`);
    } catch (err) {
      notify.apiError(err, "Could not create pot");
    } finally {
      setSubmitting(false);
    }
  }

  function dismissKeyModal() {
    setCreatedKey(null);
    setCreatedPotId(null);
    setCreatedPotName(null);
  }

  return (
    <div className="space-y-10">
      <AgentKeyModal
        open={Boolean(createdKey && createdPotId)}
        agentKey={createdKey ?? ""}
        potId={createdPotId ?? ""}
        potName={createdPotName ?? undefined}
        onClose={dismissKeyModal}
      />
      <PageHeader
        title="Pots"
        description="Honeypot hosts running the watchPot agent. Open a pot to manage Docker stacks, restarts, and compose revisions — actions are recorded in the event stream and audit log."
      />

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-emerald-500/90" />
              Register a pot
            </CardTitle>
            <CardDescription>
              Create a pot, then run the install command on your honeypot host. Docker required on the pot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="space-y-4">
              <div>
                <Label htmlFor="pot-name">Display name</Label>
                <Input
                  id="pot-name"
                  placeholder="e.g. lab-east-01"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="off"
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? (
                  <>
                    <Spinner size="sm" className="mr-2 border-t-zinc-100" />
                    Creating…
                  </>
                ) : (
                  "Create pot"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-200">All pots</h2>
            <span className="text-xs text-zinc-500">{loading ? "…" : `${list.length} total`}</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-zinc-800/90 py-20 text-zinc-500">
              <Spinner />
              <span className="text-sm">Loading pots…</span>
            </div>
          ) : list.length === 0 ? (
            <Card className="border-dashed border-zinc-700/80 bg-zinc-950/30">
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <Server className="h-10 w-10 text-zinc-600" />
                <p className="text-sm text-zinc-500">No pots yet. Create one to get an install command.</p>
              </CardContent>
            </Card>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {list.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/pots/${p.id}`}
                    className="group flex flex-col rounded-2xl border border-zinc-800/90 bg-zinc-900/25 p-5 shadow-sm transition-[border-color,background-color,transform] hover:border-zinc-700 hover:bg-zinc-900/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-zinc-100">{p.name}</p>
                        <p className="font-mono text-[11px] text-zinc-500 truncate">{p.id}</p>
                      </div>
                      {heartbeatBadge(p)}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      {p.last_heartbeat_at ? (
                        <span className="tabular-nums">{formatDateTime(p.last_heartbeat_at)}</span>
                      ) : (
                        <span>Never</span>
                      )}
                      {p.last_ip ? <span>· {p.last_ip}</span> : null}
                      {p.agent_version ? <span>· agent {p.agent_version}</span> : null}
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-zinc-800/80 pt-4">
                      <span className="flex items-center gap-1 text-xs font-medium text-emerald-400/90">
                        <Layers className="h-3.5 w-3.5" />
                        Manage stacks & compose
                      </span>
                      <ChevronRight className="h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-400/80" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
