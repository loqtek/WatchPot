export type EnrichmentConfig = {
  enabled: boolean;
  auto_enrich_on_ingest: boolean;
  cve_lookup_enabled: boolean;
  elevate_severity: boolean;
  min_confidence: number;
  max_events_per_batch: number;
  enrich_channels: string[];
  skip_event_types: string[];
  ip_tracking_enabled: boolean;
  ip_lookup_enabled: boolean;
  ip_lookup_cooldown_hours: number;
  abuseipdb_api_key: string;
  version: number;
};

export type EnrichmentRule = {
  id: string;
  name: string;
  description: string | null;
  pattern: string;
  pattern_type: "regex" | "contains" | "starts_with";
  match_field: "raw_log" | "payload" | "both";
  attack_type: string | null;
  tool: string | null;
  technique: string | null;
  cve_ids: string[] | null;
  severity: string | null;
  enabled: boolean;
  priority: number;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
};

export type EnrichmentSchedule = {
  id: string;
  name: string;
  job_type: "cve_sync" | "batch_reenrich" | "ip_scan";
  interval_hours: number;
  enabled: boolean;
  config: Record<string, unknown> | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

export type CveEntry = {
  cve_id: string;
  summary: string;
  severity: string;
  cvss_score: number | null;
  category: string;
  vendor: string | null;
  product: string | null;
  tags: string[] | null;
  detection_hint: string | null;
  enabled: boolean;
  is_custom: boolean;
  notes: string | null;
  published_at: string | null;
  references: string[] | null;
  synced_at: string;
};

export type CveStats = {
  total: number;
  enabled: number;
  custom: number;
  catalog_size: number;
  by_category: Record<string, number>;
  by_severity: Record<string, number>;
  categories: Record<string, string>;
};

export type ThreatIp = {
  id: string;
  ip_address: string;
  status: "observed" | "suspicious" | "watchlist" | "allowlisted";
  hit_count: number;
  match_count: number;
  pot_ids: string[] | null;
  attack_types: string[] | null;
  cve_ids: string[] | null;
  tools: string[] | null;
  tags: string[] | null;
  user_notes: string | null;
  geo: {
    country?: string;
    country_code?: string;
    region?: string;
    city?: string;
    isp?: string;
    org?: string;
    asn?: number;
    asn_label?: string;
    is_hosting?: boolean;
    is_proxy?: boolean;
  } | null;
  abuse_score: number | null;
  is_tor: boolean | null;
  is_hosting: boolean | null;
  lookup_status: string | null;
  last_lookup_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

export type IpIntelStats = {
  total: number;
  suspicious: number;
  watchlist: number;
  with_geo: number;
  top_countries: { key: string; count: number }[];
  recent: {
    ip_address: string;
    status: string;
    hit_count: number;
    last_seen_at: string | null;
    country: string | null;
  }[];
};

export type EnrichmentMatchRow = {
  event_id: string;
  pot_id: string;
  event_type: string;
  severity: string;
  service_name: string | null;
  received_at: string;
  attack_types: string[];
  tools: string[];
  cve_ids: string[];
  confidence: number | null;
};

export type EnrichmentStats = {
  range: string;
  since: string;
  until: string;
  total_events: number;
  enriched_events: number;
  matched_events: number;
  enrichment_rate: number;
  by_attack_type: { key: string; count: number }[];
  by_tool: { key: string; count: number }[];
  by_cve: { key: string; count: number }[];
  recent_matches: EnrichmentMatchRow[];
  rules_total: number;
  rules_enabled: number;
  cve_cache_size: number;
  schedules_enabled: number;
  config: EnrichmentConfig;
};

export const PATTERN_TYPES = [
  { value: "regex", label: "Regular expression" },
  { value: "contains", label: "Contains (case-insensitive)" },
  { value: "starts_with", label: "Starts with" },
] as const;

export const MATCH_FIELDS = [
  { value: "both", label: "Raw log + payload" },
  { value: "raw_log", label: "Raw log only" },
  { value: "payload", label: "Payload only" },
] as const;

export const JOB_TYPES = [
  { value: "cve_sync", label: "CVE cache sync" },
  { value: "batch_reenrich", label: "Batch re-enrichment" },
  { value: "ip_scan", label: "IP intelligence scan" },
] as const;

export const IP_STATUS_OPTIONS = [
  { value: "observed", label: "Observed" },
  { value: "suspicious", label: "Suspicious" },
  { value: "watchlist", label: "Watchlist" },
  { value: "allowlisted", label: "Allowlisted" },
] as const;

export const ATTACK_TYPE_LABELS: Record<string, string> = {
  brute_force: "Brute force",
  injection: "Injection",
  path_traversal: "Path traversal",
  rce_probe: "RCE probe",
  webshell: "Web shell",
  reconnaissance: "Reconnaissance",
  botnet: "Botnet / IoT",
  reverse_shell: "Reverse shell",
  auth_bypass: "Auth bypass",
  network_exploit: "Network exploit",
  deserialization: "Deserialization",
};

export const SEVERITY_OPTIONS = ["critical", "high", "medium", "low", "unknown"] as const;

export type EventEnrichment = {
  status?: string;
  attack_types?: string[];
  tools?: string[];
  techniques?: string[];
  cve_ids?: string[];
  source_ips?: string[];
  cve_details?: { cve_id: string; summary: string; severity: string; cvss_score?: number | null }[];
  rules_matched?: string[];
  rule_names?: string[];
  confidence?: number;
  max_severity?: string | null;
  enriched_at?: string;
};

export function toneForSeverity(s: string) {
  const x = s.toLowerCase();
  if (x === "critical") return "danger" as const;
  if (x === "high") return "danger" as const;
  if (x === "medium") return "warning" as const;
  if (x === "low") return "info" as const;
  return "default" as const;
}

export function toneForIpStatus(s: string) {
  if (s === "watchlist") return "danger" as const;
  if (s === "suspicious") return "warning" as const;
  if (s === "allowlisted") return "success" as const;
  return "default" as const;
}
