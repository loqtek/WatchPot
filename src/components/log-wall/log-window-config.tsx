"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { LogWindowConfig } from "@/lib/log-wall-presets";
import type { Pot, PotInfra } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncData } from "@/hooks/use-async-data";

type Props = {
  window: LogWindowConfig;
  pots: Pot[];
  open: boolean;
  onClose: () => void;
  onApply: (updated: LogWindowConfig) => void;
};

export function LogWindowConfigDialog({ window: win, pots, open, onClose, onApply }: Props) {
  if (!open) return null;
  return (
    <LogWindowConfigDialogBody
      key={win.id}
      window={win}
      pots={pots}
      onClose={onClose}
      onApply={onApply}
    />
  );
}

function LogWindowConfigDialogBody({
  window: win,
  pots,
  onClose,
  onApply,
}: Omit<Props, "open">) {
  const [draft, setDraft] = useState(win);

  const fetchInfra = useCallback(
    () => (draft.potId ? apiFetch<PotInfra>(`/pots/${draft.potId}/infra`) : Promise.resolve(null)),
    [draft.potId],
  );
  const { data: infra, loading: infraLoading } = useAsyncData(fetchInfra);

  const containers = infra?.containers ?? [];

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
        role="dialog"
        aria-labelledby="log-window-config-title"
      >
        <h2 id="log-window-config-title" className="text-base font-semibold text-zinc-100">
          Configure log window
        </h2>
        <p className="mt-1 text-sm text-zinc-500">Pick a pot and container to stream docker logs.</p>

        <div className="mt-4 space-y-4">
          <div>
            <Label htmlFor="lw-pot">Pot</Label>
            <select
              id="lw-pot"
              value={draft.potId}
              onChange={(e) => setDraft((d) => ({ ...d, potId: e.target.value, container: "" }))}
              className="mt-1 flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-zinc-100"
            >
              <option value="">Select pot…</option>
              {pots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.heartbeat_online ? "· live" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="lw-container">Container</Label>
            {infraLoading && draft.potId ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-zinc-500">
                <Spinner size="sm" />
                Loading containers…
              </div>
            ) : (
              <select
                id="lw-container"
                value={draft.container}
                onChange={(e) => setDraft((d) => ({ ...d, container: e.target.value }))}
                disabled={!draft.potId}
                className="mt-1 flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-zinc-100 disabled:opacity-50"
              >
                <option value="">Select container…</option>
                {containers.map((c) => (
                  <option key={c.id + c.name} value={c.name || c.id}>
                    {c.name || c.id} — {c.status}
                  </option>
                ))}
              </select>
            )}
            {draft.potId && !infraLoading && containers.length === 0 ? (
              <p className="mt-1 text-xs text-zinc-600">No containers reported yet on this pot.</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="lw-tail">Tail lines (live fetch)</Label>
            <Input
              id="lw-tail"
              type="number"
              min={10}
              max={5000}
              value={draft.tail}
              onChange={(e) => setDraft((d) => ({ ...d, tail: Number(e.target.value) || 150 }))}
              className="mt-1 w-28"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!draft.potId || !draft.container}
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
