export type ReportFocus = "activity" | "threats" | "commands" | "stream";
export type ReportRange = "1h" | "1d" | "7d" | "14d" | "30d" | "90d" | "all";

export type IncidentReportRequest = {
  title: string;
  range?: ReportRange | null;
  since?: string | null;
  until?: string | null;
  pot_id?: string | null;
  src_ip?: string | null;
  focus: ReportFocus;
  analyst_notes: string;
  include_raw: boolean;
  limit: number;
};

export type ReportScope = {
  title: string;
  focus: string;
  focus_label: string;
  range_key: string;
  since: string;
  until: string;
  pot_id: string | null;
  pot_name: string | null;
  src_ip: string | null;
  include_raw: boolean;
  analyst_notes: string;
  generated_at: string;
  generated_by: string;
  events_truncated: boolean;
  commands_truncated: boolean;
  scan_capped: boolean;
  truncation_notes: string[];
};

export type ReportCounts = {
  events: number;
  matched_events: number;
  commands: number;
  shell: number;
  http: number;
  login: number;
  download: number;
  other_commands: number;
  source_ips: number;
  usernames: number;
  cves: number;
  pots: number;
  sessions: number;
  services: number;
};

export type ReportPot = {
  id: string;
  name: string;
  description: string | null;
  last_ip: string | null;
  event_count: number;
  command_count: number;
};

export type ReportGeo = {
  country: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  org: string | null;
  asn: number | null;
  asn_label: string | null;
  is_hosting: boolean | null;
  is_proxy: boolean | null;
};

export type ReportAttacker = {
  ip_address: string;
  status: string;
  tracked: boolean;
  hit_count: number | null;
  match_count: number | null;
  abuse_score: number | null;
  is_tor: boolean | null;
  is_hosting: boolean | null;
  geo: ReportGeo | null;
  attack_types: string[];
  tools: string[];
  cve_ids: string[];
  tags: string[];
  user_notes: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  command_count: number;
  event_count: number;
  usernames: string[];
};

export type CountItem = { key: string; label: string; count: number };

export type ReportCveDetail = {
  cve_id: string;
  summary: string | null;
  severity: string | null;
  cvss_score: number | null;
};

export type ReportEvent = {
  id: string;
  received_at: string;
  pot_id: string;
  pot_name: string | null;
  stack_id: string | null;
  stack_name: string | null;
  service_name: string | null;
  event_type: string;
  event_title: string;
  summary: string | null;
  severity: string;
  channel: string;
  source: string;
  source_ips: string[];
  attack_types: string[];
  tools: string[];
  techniques: string[];
  cve_ids: string[];
  rule_names: string[];
  confidence: number | null;
  enrichment_status: string | null;
  cve_details: ReportCveDetail[];
  payload: Record<string, unknown> | null;
  payload_truncated: boolean;
  raw_log: string | null;
  raw_log_truncated: boolean;
};

export type ReportCommand = {
  id: string;
  pot_id: string;
  pot_name: string | null;
  container: string | null;
  kind: string;
  command: string;
  src_ip: string | null;
  session_id: string | null;
  username: string | null;
  hit_count: number;
  observed_at: string;
  first_seen_at: string;
  last_seen_at: string;
  event_id: string | null;
  context: string | null;
  context_truncated: boolean;
};

export type ReportCve = {
  cve_id: string;
  summary: string | null;
  severity: string | null;
  cvss_score: number | null;
  category: string | null;
  vendor: string | null;
  product: string | null;
  references: string[];
  notes: string | null;
  event_count: number;
  source_ips: string[];
  in_cache: boolean;
};

export type IncidentReport = {
  scope: ReportScope;
  paragraphs: string[];
  counts: ReportCounts;
  pots: ReportPot[];
  services: string[];
  attackers: ReportAttacker[];
  by_attack_type: CountItem[];
  by_tool: CountItem[];
  by_severity: CountItem[];
  by_technique: CountItem[];
  usernames: string[];
  timeline: ReportEvent[];
  commands: ReportCommand[];
  cves: ReportCve[];
};

export const FOCUS_OPTIONS: { value: ReportFocus; label: string; help: string }[] = [
  {
    value: "activity",
    label: "Incident writeup",
    help: "Threat matches, captured commands, attacker profiles, and the logs those came from.",
  },
  {
    value: "threats",
    label: "Threat matches",
    help: "Fingerprint and CVE hits, with commands from the same sources.",
  },
  {
    value: "commands",
    label: "Commands and requests",
    help: "Shell commands, HTTP requests, login attempts, and downloads, with their source events.",
  },
  {
    value: "stream",
    label: "Full sensor stream",
    help: "Every runtime and infra event in the window, plus captured commands.",
  },
];

export const RANGE_OPTIONS: { value: ReportRange | "custom"; label: string }[] = [
  { value: "1h", label: "Past hour" },
  { value: "1d", label: "Past 24 hours" },
  { value: "7d", label: "Past 7 days" },
  { value: "14d", label: "Past 14 days" },
  { value: "30d", label: "Past 30 days" },
  { value: "90d", label: "Past 90 days" },
  { value: "all", label: "All retained events" },
  { value: "custom", label: "Custom window" },
];

export function isReportFocus(value: string | null): value is ReportFocus {
  return value === "activity" || value === "threats" || value === "commands" || value === "stream";
}

export function isReportRange(value: string | null): value is ReportRange {
  return value === "1h" || value === "1d" || value === "7d" || value === "14d" || value === "30d" || value === "90d" || value === "all";
}
