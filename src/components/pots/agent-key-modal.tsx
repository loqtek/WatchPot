"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import {
  buildAgentInstallCommand,
  buildAgentLogsCommand,
  isLocalhostApiUrl,
  resolveControlPlaneApiUrl,
} from "@/lib/agent-install";
import { getApiBase } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InstallCommandBlock } from "@/components/pots/install-command-block";
import { cn } from "@/lib/utils";

type AgentKeyModalProps = {
  open: boolean;
  agentKey: string;
  potId: string;
  potName?: string;
  onClose: () => void;
};

export function AgentKeyModal({ open, agentKey, potId, potName, onClose }: AgentKeyModalProps) {
  const [closeStage, setCloseStage] = useState<0 | 1 | 2>(0);
  const [prevOpenKey, setPrevOpenKey] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hostInput, setHostInput] = useState("");
  const hostInputRef = useRef<HTMLInputElement>(null);

  const defaultApiUrl = getApiBase().replace(/\/$/, "");
  const apiUrl = useMemo(
    () => resolveControlPlaneApiUrl(hostInput, defaultApiUrl),
    [hostInput, defaultApiUrl],
  );

  const installCommand = useMemo(
    () => buildAgentInstallCommand(potId, agentKey, apiUrl),
    [potId, agentKey, apiUrl],
  );
  const logsCommand = useMemo(() => buildAgentLogsCommand(), []);
  const localhostApi = isLocalhostApiUrl(defaultApiUrl) && !hostInput.trim();

  const openKey = open ? `${agentKey}:${potId}` : "";
  if (open && openKey !== prevOpenKey) {
    setPrevOpenKey(openKey);
    setCloseStage(0);
    setShowAdvanced(false);
    setHostInput("");
  } else if (!open && prevOpenKey !== "") {
    setPrevOpenKey("");
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || !localhostApi) return;
    hostInputRef.current?.focus();
  }, [open, localhostApi, openKey]);

  if (!open) return null;

  function handleCloseClick() {
    if (closeStage === 0) {
      setCloseStage(1);
      return;
    }
    if (closeStage === 1) {
      setCloseStage(2);
      window.setTimeout(onClose, 180);
    }
  }

  const closeLabel =
    closeStage === 0
      ? "I've run the command"
      : closeStage === 1
        ? "Are you sure? Click again to close"
        : "Closing…";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-key-modal-title"
    >
      <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm" aria-hidden />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-emerald-500/30 bg-zinc-900 shadow-2xl shadow-black/50">
        <div className="space-y-5 px-6 py-6">
          <div>
            <div className="flex items-center gap-2 text-emerald-400/90">
              <Terminal className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wide">Deploy agent</span>
            </div>
            <h2 id="agent-key-modal-title" className="mt-2 text-lg font-semibold text-zinc-100">
              Run this on your honeypot host
            </h2>
            {potName ? (
              <p className="mt-1 text-sm text-zinc-400">
                Pot <span className="font-medium text-zinc-200">{potName}</span>
                <span className="mx-2 text-zinc-600">·</span>
                <span className="font-mono text-xs text-zinc-500">{potId}</span>
              </p>
            ) : null}
            <p className="mt-2 text-sm text-zinc-400">
              Requires Docker on the host. The script downloads the agent, builds the image, and connects to this
              control plane. Your pot should show as live within ~30 seconds.
            </p>
            {localhostApi ? (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-xs leading-relaxed text-amber-100/90">
                The UI is using <code className="text-amber-200">{defaultApiUrl}</code>, which remote hosts cannot
                reach. Enter your public control-plane host below — the install command updates automatically.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="control-plane-host">Control plane host</Label>
            <Input
              ref={hostInputRef}
              id="control-plane-host"
              placeholder="e.g. watchpot.example.com or https://watchpot.example.com:6040"
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-zinc-500">
              Agents will connect to{" "}
              <code className="text-emerald-400/90">{apiUrl}</code>
              {hostInput.trim() ? null : (
                <span className="text-zinc-600"> (from this UI session)</span>
              )}
            </p>
          </div>

          <InstallCommandBlock
            label="1. Install & connect (copy and run on the pot host)"
            command={installCommand}
          />

          <InstallCommandBlock
            label="2. Verify (optional)"
            command={logsCommand}
          />

          <div className="rounded-lg border border-amber-500/25 bg-amber-950/20 px-3 py-3">
            <p className="text-xs leading-relaxed text-amber-100/85">
              The agent token is embedded in the command above and shown only once. Save it if you need to reinstall
              later, or rotate the key from the pot page.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            {showAdvanced ? "Hide" : "Show"} manual environment variables
          </button>

          {showAdvanced ? (
            <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/90 p-3 font-mono text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-all">
              {`export WATCHPOT_API_URL="${apiUrl}"
export WATCHPOT_POT_ID="${potId}"
export WATCHPOT_AGENT_TOKEN="${agentKey}"
export WATCHPOT_WORK_DIR="/var/lib/watchpot"`}
            </pre>
          ) : null}
        </div>

        <div className="border-t border-zinc-800 px-6 py-4">
          <Button
            type="button"
            onClick={handleCloseClick}
            disabled={closeStage === 2}
            className={cn(
              "w-full transition-colors duration-200",
              closeStage === 0 && "bg-emerald-600 text-white hover:bg-emerald-500 border border-emerald-500/80",
              closeStage === 1 && "bg-amber-500 text-zinc-950 hover:bg-amber-400 border border-amber-400",
              closeStage === 2 && "bg-zinc-700 text-zinc-300 border border-zinc-600",
            )}
          >
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
