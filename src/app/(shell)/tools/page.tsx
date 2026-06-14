"use client";

import { useCallback, useMemo, useState } from "react";
import {
  BookOpen,
  ClipboardCopy,
  ExternalLink,
  HeartPulse,
  KeyRound,
  Server,
} from "lucide-react";
import { apiFetch, getApiOrigin } from "@/lib/api";
import type { Pot } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncData } from "@/hooks/use-async-data";
import { notify } from "@/lib/toast";

export default function ToolsPage() {
  const fetchPots = useCallback(() => apiFetch<Pot[]>("/pots"), []);
  const { data: pots, loading, error } = useAsyncData(fetchPots);
  const potList = pots ?? [];

  const [selectedPot, setSelectedPot] = useState<string>("");
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const apiOrigin = useMemo(() => getApiOrigin(), []);
  const docsUrl = `${apiOrigin}/docs`;
  const healthUrl = `${apiOrigin}/health`;
  const apiBase = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${apiOrigin}/api`;
  }, [apiOrigin]);

  const envBlock = useMemo(() => {
    const lines = [
      `WATCHPOT_API_URL=${apiBase || "https://your-control-plane.example/api"}`,
      `WATCHPOT_POT_ID=${selectedPot || "<pot-uuid-from-ui>"}`,
      `WATCHPOT_AGENT_TOKEN=${token || "<agent-key-shown-once-at-pot-creation>"}`,
      `WATCHPOT_WORK_DIR=/var/lib/watchpot`,
    ];
    return lines.join("\n");
  }, [apiBase, selectedPot, token]);

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      notify.success("Copied to clipboard");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
      notify.error("Could not copy to clipboard");
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Tools"
        description="Control plane shortcuts, API access, and agent enrollment helpers. Use these while onboarding pots and debugging connectivity."
      />

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-zinc-500" />
              API &amp; health
            </CardTitle>
            <CardDescription>Open the interactive OpenAPI docs or check that the API process is up.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" asChild>
              <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                API docs
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={healthUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                Health check
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </a>
            </Button>
            <p className="w-full pt-2 text-xs text-zinc-500">
              Base URL: <code className="text-zinc-400">{apiOrigin}</code>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-zinc-500" />
              Session
            </CardTitle>
            <CardDescription>
              Your browser talks to <code className="text-zinc-400">NEXT_PUBLIC_API_URL</code> at build time for dev.
              Ensure it matches where the API is reachable from your machine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-zinc-500 break-all">
              Resolved API: <code className="text-emerald-500/90">{apiBase || "—"}</code>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4 text-zinc-500" />
            Agent environment
          </CardTitle>
          <CardDescription>
            Pick a pot and paste a placeholder agent token (optional) to generate a ready-to-copy env block for
            <code className="mx-1 text-zinc-400">systemd</code>, <code className="text-zinc-400">.env</code>, or shell.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-zinc-500">
              <Spinner size="sm" />
              Loading pots…
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="tool-pot">Pot</Label>
                <select
                  id="tool-pot"
                  value={selectedPot}
                  onChange={(e) => setSelectedPot(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-zinc-100 focus-visible:border-emerald-600/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/25"
                >
                  <option value="">Select a pot…</option>
                  {potList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="tool-token">Agent token (optional)</Label>
                <Input
                  id="tool-token"
                  type="password"
                  placeholder="Paste agent key to embed in env block"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          <div className="relative rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 font-mono text-xs leading-relaxed text-zinc-300">
            <pre className="overflow-x-auto whitespace-pre-wrap">{envBlock}</pre>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="absolute right-3 top-3"
              onClick={() => copy(envBlock, "env")}
            >
              <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />
              {copied === "env" ? "Copied" : "Copy"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge tone="info">Agent API</Badge>
            <span className="text-xs text-zinc-500">
              Agents use <code className="text-zinc-400">WATCHPOT_API_URL</code> including the{" "}
              <code className="text-zinc-400">/api</code> prefix and headers{" "}
              <code className="text-zinc-400">Authorization: Bearer &lt;token&gt;</code>,{" "}
              <code className="text-zinc-400">X-WatchPot-Pot-Id</code>.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-zinc-500" />
            Agent keys
          </CardTitle>
          <CardDescription>
            Keys are shown only once when you create a pot. If you lose a key, create a new pot or rotate via a future
            admin API — for now, register a new pot.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-zinc-500">
          <p>
            Go to <strong className="text-zinc-400">Pots</strong> → create a pot → copy the agent key immediately.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
