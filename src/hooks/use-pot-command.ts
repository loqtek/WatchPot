import { useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import type { PotCommand } from "@/lib/types";

function pollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 12_000) return 350;
  if (elapsedMs < 30_000) return 800;
  return 1500;
}

const INFRA_REFRESH_ACTIONS = new Set([
  "rm",
  "kill",
  "stop",
  "start",
  "compose_down",
  "compose_stop",
  "compose_start",
  "compose_restart",
]);

export function usePotCommand(potId: string) {
  const abortRef = useRef(false);

  const waitForCommand = useCallback(
    async (commandId: string, maxMs = 60_000): Promise<PotCommand> => {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        if (abortRef.current) throw new Error("Cancelled");
        const cmd = await apiFetch<PotCommand>(`/pots/${potId}/commands/${commandId}`);
        if (cmd.status === "completed" || cmd.status === "failed") return cmd;
        await new Promise((r) => setTimeout(r, pollDelayMs(Date.now() - start)));
      }
      throw new Error("Timed out waiting for the agent — is it online?");
    },
    [potId],
  );

  const runCommand = useCallback(
    async (body: {
      action: string;
      container?: string;
      stack_id?: string;
      tail?: number;
      command?: string;
    }): Promise<PotCommand> => {
      const created = await apiFetch<PotCommand>(`/pots/${potId}/commands`, {
        method: "POST",
        json: body,
      });
      return waitForCommand(created.id);
    },
    [potId, waitForCommand],
  );

  return { runCommand, waitForCommand, infraRefreshActions: INFRA_REFRESH_ACTIONS };
}
