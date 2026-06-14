"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Box,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode2,
  Layers,
  RotateCcw,
  Search,
  Server,
  Settings2,
  Shield,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { parseExposedPorts } from "@/lib/stack-compose";
import type { Stack, StackRevision } from "@/lib/types";
import { usePotCommand } from "@/hooks/use-pot-command";
import {
  StackDeployedModal,
  type StackDeployedInfo,
} from "@/components/stacks/stack-deployed-modal";
import {
  CATEGORY_LABELS,
  RISK_LABELS,
  STACK_TEMPLATES,
  defaultTweakValues,
  getTemplate,
  renderStackCompose,
  riskTone,
  validateComposeYaml,
  type StackTemplate,
  type StackTemplateCategory,
} from "@/lib/stack-templates";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";

const CATEGORIES: (StackTemplateCategory | "all")[] = [
  "all",
  "honeypot",
  "network",
  "vulnerable",
  "bundle",
  "minimal",
];

type NewStackFormProps = {
  potId: string;
};

export function NewStackForm({ potId }: NewStackFormProps) {
  const router = useRouter();
  const { runCommand } = usePotCommand(potId);

  const [templateId, setTemplateId] = useState("cowrie-ssh");
  const [tweakValues, setTweakValues] = useState<Record<string, string>>(() =>
    defaultTweakValues(getTemplate("cowrie-ssh")!),
  );
  const [compose, setCompose] = useState(() =>
    renderStackCompose(getTemplate("cowrie-ssh")!, defaultTweakValues(getTemplate("cowrie-ssh")!)),
  );
  const [composeDirty, setComposeDirty] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [revisionNote, setRevisionNote] = useState("initial deploy from catalog");
  const [categoryFilter, setCategoryFilter] = useState<StackTemplateCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showYaml, setShowYaml] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deployPhase, setDeployPhase] = useState<"idle" | "creating" | "starting">("idle");
  const [validationErr, setValidationErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deployedInfo, setDeployedInfo] = useState<StackDeployedInfo | null>(null);
  const [showDeployedModal, setShowDeployedModal] = useState(false);

  const template = getTemplate(templateId);
  const validation = useMemo(() => validateComposeYaml(compose), [compose]);
  const hostPorts = useMemo(() => parseExposedPorts(compose), [compose]);
  const serviceCount = useMemo(() => {
    const m = compose.match(/^\s{2}[a-zA-Z0-9_.-]+:\s*$/gm);
    return m?.length ?? 0;
  }, [compose]);

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return STACK_TEMPLATES.filter((t) => {
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      if (!q) return true;
      const hay = [t.name, t.description, t.suggestedName, ...t.tags, ...t.images].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [categoryFilter, search]);

  const applyTemplate = useCallback(
    (t: StackTemplate, preserveName = false) => {
      const tweaks = defaultTweakValues(t);
      setTemplateId(t.id);
      setTweakValues(tweaks);
      setCompose(renderStackCompose(t, tweaks));
      setComposeDirty(false);
      if (!preserveName || !name.trim()) setName(t.suggestedName);
      if (!description.trim()) setDescription(t.description.slice(0, 500));
      setRevisionNote(`catalog:${t.id}`);
    },
    [name, description],
  );

  useEffect(() => {
    if (composeDirty || !template) return;
    setCompose(renderStackCompose(template, tweakValues));
  }, [tweakValues, template, composeDirty]);

  function onTweakChange(key: string, value: string) {
    setTweakValues((prev) => ({ ...prev, [key]: value }));
    setComposeDirty(false);
  }

  function resetYamlFromTemplate() {
    if (!template) return;
    setCompose(renderStackCompose(template, tweakValues));
    setComposeDirty(false);
  }

  async function copyYaml() {
    try {
      await navigator.clipboard.writeText(compose);
      setCopied(true);
      notify.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.error("Could not copy to clipboard");
    }
  }

  function closeDeployedModal() {
    setShowDeployedModal(false);
    router.push(`/pots/${potId}?tab=containers`);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setValidationErr(null);
    const v = validateComposeYaml(compose);
    if (!v.ok) {
      setValidationErr(v.message ?? "Invalid compose");
      return;
    }
    setBusy(true);
    setDeployPhase("creating");
    try {
      const s = await apiFetch<Stack>(`/pots/${potId}/stacks`, {
        method: "POST",
        json: { name: name.trim(), description: description.trim() || null },
      });
      const rev = await apiFetch<StackRevision>(`/pots/${potId}/stacks/${s.id}/revisions`, {
        method: "POST",
        json: { compose_yaml: compose, note: revisionNote.trim() || "initial" },
      });

      setDeployPhase("starting");
      let status: StackDeployedInfo["status"] = "queued";
      let statusDetail: string | undefined;

      try {
        const cmd = await runCommand({ action: "compose_start", stack_id: s.id });
        if (cmd.status === "completed") {
          status = "deployed";
        } else {
          status = "failed";
          statusDetail = cmd.error || cmd.output?.slice(0, 240) || "The agent reported a deploy failure.";
        }
      } catch (deployErr) {
        const message = deployErr instanceof Error ? deployErr.message : "Deploy command could not complete.";
        if (message.toLowerCase().includes("timed out") || message.toLowerCase().includes("offline")) {
          status = "queued";
          statusDetail = "Deploy was queued — the agent will start containers on its next poll.";
        } else {
          status = "failed";
          statusDetail = message;
        }
      }

      setDeployedInfo({
        stackId: s.id,
        stackName: s.name,
        revision: rev.revision,
        templateLabel: template?.name,
        ports: hostPorts,
        status,
        statusDetail,
      });
      setShowDeployedModal(true);
    } catch (er) {
      notify.apiError(er, "Failed to create stack");
    } finally {
      setBusy(false);
      setDeployPhase("idle");
    }
  }

  const showLabWarning =
    template?.risk === "lab" || template?.category === "vulnerable" || template?.category === "bundle";

  return (
    <>
      <StackDeployedModal
        open={showDeployedModal}
        potId={potId}
        info={deployedInfo}
        onClose={closeDeployedModal}
      />
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-6">
      {validationErr ? <Alert>{validationErr}</Alert> : null}

      {showLabWarning ? (
        <Alert variant="warning">
          <div>
            <p className="font-medium">Lab / exposure notice</p>
            <p className="mt-1 text-sm opacity-90">
              Vulnerable apps and some bundles run real exploitable software. Deploy only on isolated pots, restrict
              firewall rules, and never expose them to the public internet without understanding the risk.
            </p>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Template catalog */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-500" />
              Service catalog
            </CardTitle>
            <CardDescription>
              Pick a honeypot image, protocol trap, vulnerable lab app, or multi-service bundle. Tweaks update the YAML
              unless you edit it manually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                placeholder="Search by name, tag, or image…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Search templates"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                    categoryFilter === cat
                      ? "border-emerald-600/50 bg-emerald-500/10 text-emerald-300"
                      : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
                  )}
                >
                  {cat === "all" ? "All" : CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
            <div className="max-h-[min(28rem,50vh)] space-y-2 overflow-y-auto pr-1">
              {filteredTemplates.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-500">No templates match your search.</p>
              ) : (
                filteredTemplates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t, true)}
                    className={cn(
                      "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                      templateId === t.id
                        ? "border-emerald-600/60 bg-emerald-500/5 ring-1 ring-emerald-500/20"
                        : "border-zinc-800/90 bg-zinc-950/30 hover:border-zinc-700 hover:bg-zinc-900/40",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-zinc-100">{t.name}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{t.description}</p>
                      </div>
                      <Badge tone={riskTone(t.risk)}>{RISK_LABELS[t.risk]}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {t.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {t.images.length > 0 ? (
                      <p className="mt-2 truncate font-mono text-[10px] text-zinc-600">{t.images.join(" · ")}</p>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Configuration */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-4 w-4 text-zinc-500" />
                Stack details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="stack-name">Stack name</Label>
                <Input
                  id="stack-name"
                  placeholder="e.g. cowrie-ssh"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="stack-desc">Description (optional)</Label>
                <Textarea
                  id="stack-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this stack does on the pot…"
                  className="mt-1 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="rev-note">First revision note</Label>
                <Input
                  id="rev-note"
                  value={revisionNote}
                  onChange={(e) => setRevisionNote(e.target.value)}
                  className="mt-1"
                />
              </div>
              {template ? (
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3 text-sm">
                  <p className="text-zinc-400">
                    <span className="text-zinc-300">{template.name}</span>
                    {" · "}
                    {serviceCount} service{serviceCount === 1 ? "" : "s"}
                    {hostPorts.length > 0 ? (
                      <>
                        {" · "}
                        host ports: {hostPorts.join(", ")}
                      </>
                    ) : null}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {template && template.tweaks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-zinc-500" />
                  Quick tweaks
                </CardTitle>
                <CardDescription>Adjust ports and policies — changes sync to compose until you edit YAML.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {template.tweaks.map((tw) => {
                  if (tw.key === "PHPMYADMIN_PORT" && tweakValues.PHPMYADMIN !== "true") return null;
                  return (
                    <div key={tw.key} className={tw.kind === "toggle" ? "sm:col-span-2" : undefined}>
                      <Label htmlFor={`tweak-${tw.key}`}>{tw.label}</Label>
                      {tw.hint ? <p className="text-[11px] text-zinc-600 mt-0.5">{tw.hint}</p> : null}
                      {tw.kind === "select" ? (
                        <select
                          id={`tweak-${tw.key}`}
                          value={tweakValues[tw.key] ?? tw.default}
                          onChange={(e) => onTweakChange(tw.key, e.target.value)}
                          className="mt-1 flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-zinc-100"
                        >
                          {tw.options?.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : tw.kind === "toggle" ? (
                        <div className="mt-2 flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={tweakValues[tw.key] === "true" ? "primary" : "outline"}
                            onClick={() => onTweakChange(tw.key, "true")}
                          >
                            <Shield className="h-3.5 w-3.5" />
                            On
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={tweakValues[tw.key] !== "true" ? "secondary" : "outline"}
                            onClick={() => onTweakChange(tw.key, "false")}
                          >
                            Off
                          </Button>
                        </div>
                      ) : (
                        <Input
                          id={`tweak-${tw.key}`}
                          type={tw.kind === "port" ? "number" : "text"}
                          min={tw.kind === "port" ? 1 : undefined}
                          max={tw.kind === "port" ? 65535 : undefined}
                          value={tweakValues[tw.key] ?? tw.default}
                          onChange={(e) => onTweakChange(tw.key, e.target.value)}
                          className="mt-1"
                        />
                      )}
                    </div>
                  );
                })}
                {template.id === "dvwa" && tweakValues.PHPMYADMIN === "true" ? (
                  <div>
                    <Label htmlFor="tweak-PHPMYADMIN_PORT">phpMyAdmin host port</Label>
                    <Input
                      id="tweak-PHPMYADMIN_PORT"
                      type="number"
                      value={tweakValues.PHPMYADMIN_PORT ?? "8033"}
                      onChange={(e) => onTweakChange("PHPMYADMIN_PORT", e.target.value)}
                      className="mt-1"
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {/* YAML editor */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4 text-zinc-500" />
              Compose YAML
              {composeDirty ? (
                <Badge tone="warning" className="normal-case tracking-normal">
                  manually edited
                </Badge>
              ) : null}
              {validation.ok ? (
                <Badge tone="success" className="normal-case tracking-normal">
                  <Check className="mr-1 h-3 w-3" />
                  valid
                </Badge>
              ) : (
                <Badge tone="danger" className="normal-case tracking-normal">
                  {validation.message}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Fine-tune images, env vars, volumes, and networks. The agent applies this on the next poll.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowYaml((s) => !s)}>
              {showYaml ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showYaml ? "Hide" : "Show"} YAML
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyYaml()}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={resetYamlFromTemplate}>
              <RotateCcw className="h-4 w-4" />
              Reset from template
            </Button>
          </div>
        </CardHeader>
        {showYaml ? (
          <CardContent className="space-y-3">
            <Textarea
              id="compose"
              value={compose}
              onChange={(e) => {
                setCompose(e.target.value);
                setComposeDirty(true);
              }}
              rows={22}
              className="font-mono text-xs leading-relaxed"
              spellCheck={false}
              aria-describedby="compose-hint"
            />
            <p id="compose-hint" className="text-xs text-zinc-600">
              Tip: use non-default host ports when running multiple stacks on one pot. Images are pulled on first deploy.
            </p>
          </CardContent>
        ) : null}
      </Card>

      <button
        type="button"
        onClick={() => setShowAdvanced((s) => !s)}
        className="flex w-full items-center justify-between rounded-lg border border-zinc-800/80 px-4 py-3 text-sm text-zinc-400 hover:bg-zinc-900/40"
      >
        <span className="flex items-center gap-2">
          <Box className="h-4 w-4" />
          Deployment checklist
        </span>
        {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {showAdvanced ? (
        <Card>
          <CardContent className="pt-5">
            <ul className="list-inside list-disc space-y-2 text-sm text-zinc-500">
              <li>Confirm the pot agent is online and can reach Docker Hub (or your registry).</li>
              <li>Open only the host ports you intend in cloud firewall / security groups.</li>
              <li>
                <code className="text-zinc-400">network_mode: host</code> templates bind directly on the pot — plan
                port conflicts accordingly.
              </li>
              <li>Honeypots with hardening enabled use read-only rootfs; disable if an image fails to start.</li>
              <li>Stacks auto-start on deploy when the agent is online. Push further revisions from the stack editor.</li>
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-zinc-800/80 pt-6">
        <Button type="submit" disabled={busy || !validation.ok || !name.trim()}>
          {busy ? (
            <>
              <Spinner size="sm" className="mr-2 border-t-zinc-100" />
              {deployPhase === "starting" ? "Starting containers…" : "Creating stack…"}
            </>
          ) : (
            "Deploy stack"
          )}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href={`/pots/${potId}`}>Cancel</Link>
        </Button>
      </div>
    </form>
    </>
  );
}
