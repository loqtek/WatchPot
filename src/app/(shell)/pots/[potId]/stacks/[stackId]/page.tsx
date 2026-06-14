"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight, History } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Stack, StackRevision } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { notify } from "@/lib/toast";

export default function StackEditorPage() {
  const { formatDateTime } = useFormatDateTime();
  const params = useParams();
  const potId = params.potId as string;
  const stackId = params.stackId as string;

  const fetchStackMeta = useCallback(async (): Promise<Stack | null> => {
    const rows = await apiFetch<Stack[]>(`/pots/${potId}/stacks`);
    return rows.find((s) => s.id === stackId) ?? null;
  }, [potId, stackId]);

  const fetchRevisions = useCallback(
    () => apiFetch<StackRevision[]>(`/pots/${potId}/stacks/${stackId}/revisions`),
    [potId, stackId],
  );

  const { data: stackRow, loading: metaLoading, refetch: refetchMeta } = useAsyncData(fetchStackMeta);
  const { data: revisions, loading: revLoading, refetch: refetchRevisions } = useAsyncData(fetchRevisions);

  const [compose, setCompose] = useState("");
  const [editorHydrated, setEditorHydrated] = useState(false);
  const [note, setNote] = useState("edit from UI");
  const [busy, setBusy] = useState(false);

  const revList = revisions ?? [];
  const latest = revList[0];

  useEffect(() => {
    if (editorHydrated || !latest) return;
    setCompose(latest.compose_yaml);
    setEditorHydrated(true);
  }, [latest, editorHydrated]);

  async function onPush(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/pots/${potId}/stacks/${stackId}/revisions`, {
        method: "POST",
        json: { compose_yaml: compose, note: note || undefined },
      });
      await refetchRevisions();
      await refetchMeta();
      notify.success("New revision saved. The agent will apply it on the next poll.");
    } catch (er) {
      notify.apiError(er, "Push failed");
    } finally {
      setBusy(false);
    }
  }

  const loading = metaLoading || revLoading;

  return (
    <div className="space-y-8">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-zinc-500" aria-label="Breadcrumb">
        <Link href="/pots" className="hover:text-emerald-400 transition-colors">
          Pots
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
        <Link href={`/pots/${potId}`} className="hover:text-emerald-400 transition-colors">
          Pot
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
        <span className="truncate text-zinc-400">{stackRow?.name ?? "Stack"}</span>
      </nav>


      {loading && !stackRow ? (
        <div className="flex items-center gap-2 py-16 text-zinc-500">
          <Spinner />
          Loading stack…
        </div>
      ) : !stackRow ? (
        <Alert>Stack not found on this pot.</Alert>
      ) : (
        <>
          <PageHeader
            title={stackRow.name}
            description={`Compose editor · latest rev ${stackRow.latest_revision ?? "—"} · restart generation ${stackRow.restart_generation ?? 0}`}
            actions={
              <Button variant="outline" size="sm" asChild>
                <Link href={`/pots/${potId}`}>Back to pot</Link>
              </Button>
            }
          />

          <div className="grid gap-6 xl:grid-cols-[1fr_minmax(0,20rem)]">
            <Card>
              <CardHeader>
                <CardTitle>Push new revision</CardTitle>
                <CardDescription>
                  Each save creates an append-only revision. Roll back by pasting older YAML and pushing again.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={(e) => void onPush(e)} className="space-y-4">
                  <div>
                    <Label htmlFor="note">Note</Label>
                    <input
                      id="note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="yaml">Compose YAML</Label>
                    <Textarea
                      id="yaml"
                      value={compose}
                      onChange={(e) => setCompose(e.target.value)}
                      rows={22}
                      className="mt-1 font-mono text-xs"
                      required
                    />
                  </div>
                  <Button type="submit" disabled={busy}>
                    {busy ? (
                      <>
                        <Spinner size="sm" className="mr-2 border-t-zinc-100" />
                        Saving…
                      </>
                    ) : (
                      "Save as new revision"
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="h-fit xl:sticky xl:top-20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4 text-zinc-500" />
                  Revision history
                </CardTitle>
                <CardDescription>Most recent first.</CardDescription>
              </CardHeader>
              <CardContent className="max-h-[min(32rem,60vh)] space-y-2 overflow-y-auto">
                {revLoading ? (
                  <Spinner />
                ) : revList.length === 0 ? (
                  <p className="text-sm text-zinc-500">No revisions.</p>
                ) : (
                  revList.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setCompose(r.compose_yaml);
                        setNote(`restored from r${r.revision}`);
                      }}
                      className="w-full rounded-lg border border-zinc-800/90 bg-zinc-950/40 px-3 py-2.5 text-left text-sm transition-colors hover:border-zinc-700 hover:bg-zinc-900/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone="info">rev {r.revision}</Badge>
                        <span className="text-[10px] text-zinc-500 tabular-nums">
                          {formatDateTime(r.created_at)}
                        </span>
                      </div>
                      {r.note ? <p className="mt-1 text-xs text-zinc-500">{r.note}</p> : null}
                      <p className="mt-1 text-[10px] text-zinc-600">Click to load into editor</p>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
