"use client";

import { useCallback, useState } from "react";
import { CheckCircle2, Plug, RefreshCw, Send, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  CHANNEL_OPTIONS,
  type Integration,
  type IntegrationsResponse,
  type IntegrationProvider,
  PROVIDER_HINTS,
  PROVIDER_LABELS,
} from "@/lib/integration-types";
import { useAsyncData } from "@/hooks/use-async-data";
import { notify } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { IntegrationSetupGuide } from "@/components/integrations/integration-setup-guide";
import { ZabbixPresetsPanel } from "@/components/integrations/zabbix-presets-panel";

function ConfigField({
  label,
  id,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function ProviderFields({
  integration,
  onConfigChange,
}: {
  integration: Integration;
  onConfigChange: (key: string, value: unknown) => void;
}) {
  const c = integration.config;
  const str = (k: string) => String(c[k] ?? "");
  const num = (k: string) => Number(c[k] ?? 0);

  switch (integration.provider) {
    case "grafana_loki":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <ConfigField
            label="Loki push URL"
            id={`${integration.id}-push`}
            value={str("push_url")}
            onChange={(v) => onConfigChange("push_url", v)}
            placeholder="http://localhost:3100/loki/api/v1/push"
          />
          <ConfigField
            label="Tenant ID (X-Scope-OrgID)"
            id={`${integration.id}-tenant`}
            value={str("tenant_id")}
            onChange={(v) => onConfigChange("tenant_id", v)}
            hint="Leave empty for single-tenant Loki."
          />
          <ConfigField
            label="Username"
            id={`${integration.id}-user`}
            value={str("username")}
            onChange={(v) => onConfigChange("username", v)}
          />
          <ConfigField
            label="Password"
            id={`${integration.id}-pass`}
            type="password"
            value={str("password")}
            onChange={(v) => onConfigChange("password", v)}
            hint="Stored server-side; shown as •••• after save."
          />
          <div className="sm:col-span-2">
            <Label htmlFor={`${integration.id}-labels`}>Extra labels (JSON object)</Label>
            <Textarea
              id={`${integration.id}-labels`}
              className="mt-1.5 font-mono text-xs min-h-[72px]"
              value={JSON.stringify(c.extra_labels ?? { job: "watchpot" }, null, 2)}
              onChange={(e) => {
                try {
                  onConfigChange("extra_labels", JSON.parse(e.target.value));
                } catch {
                  /* allow typing */
                }
              }}
            />
          </div>
        </div>
      );
    case "grafana_alerting":
      return (
        <div className="grid gap-4">
          <ConfigField
            label="Webhook URL"
            id={`${integration.id}-wh`}
            value={str("webhook_url")}
            onChange={(v) => onConfigChange("webhook_url", v)}
            placeholder="https://grafana.example/api/v1/webhooks/..."
          />
          <ConfigField
            label="Bearer token (optional)"
            id={`${integration.id}-token`}
            type="password"
            value={str("bearer_token")}
            onChange={(v) => onConfigChange("bearer_token", v)}
          />
        </div>
      );
    case "zabbix": {
      const mode =
        str("connection_mode") ||
        (str("api_url") ? "api" : "sender");
      return (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${integration.id}-mode`}>Connection mode</Label>
            <select
              id={`${integration.id}-mode`}
              value={mode}
              onChange={(e) => {
                const next = e.target.value;
                onConfigChange("connection_mode", next);
                if (next === "api") {
                  onConfigChange("server_host", "");
                }
              }}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="sender">TCP sender (port 10051)</option>
              <option value="api">HTTP API (history.push)</option>
            </select>
            <p className="text-xs text-zinc-500">
              Use API if port 10051 is closed or WatchPot cannot reach the trapper port (common with Docker /
              agent-only hosts).
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {mode === "api" ? (
              <>
                <div className="sm:col-span-2">
                  <ConfigField
                    label="API URL"
                    id={`${integration.id}-api-url`}
                    value={str("api_url")}
                    onChange={(v) => onConfigChange("api_url", v)}
                    placeholder="https://zabbix.example/zabbix/api_jsonrpc.php"
                    hint="Zabbix frontend JSON-RPC endpoint (same URL as the UI, plus /api_jsonrpc.php)."
                  />
                </div>
                <ConfigField
                  label="API token"
                  id={`${integration.id}-api-token`}
                  type="password"
                  value={str("api_token")}
                  onChange={(v) => onConfigChange("api_token", v)}
                  hint="Administration → Users → API tokens. Needs write access to history.push."
                />
              </>
            ) : (
              <>
                <ConfigField
                  label="Zabbix server host"
                  id={`${integration.id}-host`}
                  value={str("server_host")}
                  onChange={(v) => onConfigChange("server_host", v)}
                  placeholder="10.0.50.32"
                  hint="IP/DNS of Zabbix server or proxy — not 127.0.0.1 unless server runs on the same machine as the API."
                />
                <ConfigField
                  label="Sender port"
                  id={`${integration.id}-port`}
                  value={String(num("server_port") || 10051)}
                  onChange={(v) => onConfigChange("server_port", parseInt(v, 10) || 10051)}
                  hint="Must be 10051 (trapper). Port 10050 is the agent and will refuse sender traffic."
                />
              </>
            )}
            <ConfigField
              label="Zabbix host name"
              id={`${integration.id}-zhost`}
              value={str("zabbix_host")}
              onChange={(v) => onConfigChange("zabbix_host", v)}
              hint="Host name from Data collection → Hosts (not Visible name)."
            />
            <ConfigField
              label="Trapper item key"
              id={`${integration.id}-key`}
              value={str("item_key")}
              onChange={(v) => onConfigChange("item_key", v)}
            />
          </div>
        </div>
      );
    }
    case "wazuh":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <ConfigField
            label="Indexer base URL"
            id={`${integration.id}-base`}
            value={str("base_url")}
            onChange={(v) => onConfigChange("base_url", v)}
            placeholder="https://127.0.0.1:9200"
          />
          <ConfigField
            label="Index name"
            id={`${integration.id}-idx`}
            value={str("index")}
            onChange={(v) => onConfigChange("index", v)}
          />
          <ConfigField
            label="Username"
            id={`${integration.id}-wuser`}
            value={str("username")}
            onChange={(v) => onConfigChange("username", v)}
          />
          <ConfigField
            label="Password"
            id={`${integration.id}-wpass`}
            type="password"
            value={str("password")}
            onChange={(v) => onConfigChange("password", v)}
          />
          <label className="flex items-center gap-2 text-sm text-zinc-300 sm:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(c.verify_ssl)}
              onChange={(e) => onConfigChange("verify_ssl", e.target.checked)}
              className="rounded border-zinc-600"
            />
            Verify TLS certificate
          </label>
        </div>
      );
    default:
      return null;
  }
}

export function IntegrationsPanel() {
  const fetchIntegrations = useCallback(() => apiFetch<IntegrationsResponse>("/integrations"), []);
  const { data, loading, error, refetch } = useAsyncData(fetchIntegrations);

  const [draft, setDraft] = useState<Integration[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const integrations = draft ?? data?.integrations ?? [];

  function patchIntegration(id: string, patch: Partial<Integration>) {
    setDraft((prev) => {
      const base = prev ?? data?.integrations ?? [];
      return base.map((i) => (i.id === id ? { ...i, ...patch } : i));
    });
  }

  function patchConfig(id: string, key: string, value: unknown) {
    setDraft((prev) => {
      const base = prev ?? data?.integrations ?? [];
      return base.map((i) =>
        i.id === id ? { ...i, config: { ...i.config, [key]: value } } : i,
      );
    });
  }

  function toggleChannel(id: string, channel: string) {
    const item = integrations.find((i) => i.id === id);
    if (!item) return;
    const set = new Set(item.channels);
    if (set.has(channel)) set.delete(channel);
    else set.add(channel);
    patchIntegration(id, { channels: [...set] });
  }

  async function save() {
    setSaving(true);
    try {
      const body = { version: data?.version ?? 1, integrations };
      await apiFetch<IntegrationsResponse>("/integrations", { method: "PUT", json: body });
      setDraft(null);
      notify.success("Integrations saved");
      void refetch();
    } catch (err) {
      notify.apiError(err, "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(integration: Integration) {
    const { id, provider } = integration;
    setTestingId(id);
    setTestResults((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
    try {
      const res = await apiFetch<{ results: { ok: boolean; message: string }[] }>(
        `/integrations/test/${encodeURIComponent(id)}?provider=${encodeURIComponent(provider)}`,
        {
          method: "POST",
          json: { config: integration.config },
        },
      );
      const first = res.results[0];
      if (first) {
        setTestResults((r) => ({ ...r, [id]: { ok: first.ok, message: first.message } }));
        if (first.ok) notify.success(first.message || "Connection test passed");
        else notify.error(first.message || "Connection test failed");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Test failed";
      setTestResults((r) => ({
        ...r,
        [id]: { ok: false, message },
      }));
      notify.apiError(err, "Test failed");
    } finally {
      setTestingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 py-8">
        <Spinner size="sm" />
        Loading integrations…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-zinc-500">Could not load integrations.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void save()} disabled={saving || !draft}>
          {saving ? (
            <>
              <Spinner size="sm" className="mr-2" />
              Saving…
            </>
          ) : (
            "Save changes"
          )}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Reload
        </Button>
        {draft ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
            Discard edits
          </Button>
        ) : null}
      </div>
      <div className="grid gap-6">
        {integrations.map((integration) => {
          const provider = integration.provider as IntegrationProvider;
          const test = testResults[integration.id];
          return (
            <Card key={integration.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Plug className="h-4 w-4 text-emerald-500/80" />
                      {integration.name}
                    </CardTitle>
                    <CardDescription className="mt-1.5">
                      {PROVIDER_LABELS[provider]} — {PROVIDER_HINTS[provider]}
                    </CardDescription>
                    <IntegrationSetupGuide provider={provider} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={integration.enabled ? "success" : "default"}>
                      {integration.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <label className="flex items-center gap-2 text-sm text-zinc-400">
                      <input
                        type="checkbox"
                        checked={integration.enabled}
                        onChange={(e) => patchIntegration(integration.id, { enabled: e.target.checked })}
                        className="rounded border-zinc-600"
                      />
                      Enable
                    </label>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-2">
                    Event channels
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {CHANNEL_OPTIONS.map((ch) => (
                      <label key={ch.id} className="flex items-center gap-2 text-sm text-zinc-300">
                        <input
                          type="checkbox"
                          checked={integration.channels.includes(ch.id)}
                          onChange={() => toggleChannel(integration.id, ch.id)}
                          className="rounded border-zinc-600"
                        />
                        {ch.label}
                      </label>
                    ))}
                  </div>
                </div>

                <ProviderFields
                  integration={integration}
                  onConfigChange={(key, value) => patchConfig(integration.id, key, value)}
                />

                {provider === "zabbix" ? <ZabbixPresetsPanel /> : null}

                <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-zinc-800/80">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={testingId === integration.id}
                    onClick={() => void testConnection(integration)}
                  >
                    {testingId === integration.id ? (
                      <>
                        <Spinner size="sm" className="mr-2" />
                        Testing…
                      </>
                    ) : (
                      <>
                        <Send className="mr-1.5 h-3.5 w-3.5" />
                        Test connection
                      </>
                    )}
                  </Button>
                  {test ? (
                    <span
                      className={`inline-flex items-center gap-1.5 text-sm ${test.ok ? "text-emerald-400" : "text-amber-400"}`}
                    >
                      {test.ok ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 shrink-0" />
                      )}
                      <span className="font-mono text-xs break-all">{test.message}</span>
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
