export type IntegrationProvider = "grafana_loki" | "grafana_alerting" | "zabbix" | "wazuh";

export type Integration = {
  id: string;
  name: string;
  provider: IntegrationProvider;
  enabled: boolean;
  channels: string[];
  config: Record<string, unknown>;
};

export type IntegrationsResponse = {
  version: number;
  integrations: Integration[];
};

export type IntegrationTestResponse = {
  results: { integration_id: string; ok: boolean; message: string }[];
};

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  grafana_loki: "Grafana Loki",
  grafana_alerting: "Grafana Alerting",
  zabbix: "Zabbix",
  wazuh: "Wazuh",
};

export const PROVIDER_HINTS: Record<IntegrationProvider, string> = {
  grafana_loki:
    "Pushes JSON streams to POST /loki/api/v1/push with nanosecond timestamps. Use X-Scope-OrgID when multi-tenant.",
  grafana_alerting:
    "POSTs a Grafana unified alerting webhook payload to your contact point URL.",
  zabbix:
    "Trapper item on the host; connect via TCP 10051 (server trapper) or HTTP API if 10051 is not reachable.",
  wazuh:
    "Indexes documents via the OpenSearch-compatible API (POST /{index}/_doc). Typical Wazuh indexer port is 9200.",
};

export const CHANNEL_OPTIONS = [
  { id: "runtime", label: "Runtime events" },
  { id: "infra", label: "Infra / container logs" },
  { id: "control", label: "Control plane" },
] as const;
