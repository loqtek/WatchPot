export type UserOut = {
  id: string;
  email: string;
  username: string | null;
  is_active: boolean;
  timezone: string;
};

export type UserAdmin = UserOut & {
  created_at: string;
};

export type Pot = {
  id: string;
  name: string;
  description: string | null;
  last_heartbeat_at: string | null;
  last_ip: string | null;
  agent_version: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  /** True when last_heartbeat_at is within heartbeat_stale_minutes (server-side, from app_settings). */
  heartbeat_online: boolean;
};

export type Stack = {
  id: string;
  pot_id: string;
  name: string;
  description: string | null;
  restart_generation: number;
  created_at: string;
  latest_revision: number | null;
};

export type PotStats = {
  range: string;
  events_total: number;
  events_per_hour: number;
  stacks_total: number;
  stacks_with_revision: number;
  containers_running: number;
  containers_total: number;
  docker_ok: boolean | null;
  hostname: string | null;
  infra_at: string | null;
  by_severity: { key?: string; label?: string; count: number }[];
  by_event_type: { key?: string; label?: string; count: number }[];
  events_by_stack: { stack_id: string; stack_name: string; count: number }[];
};

export type PotContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  stack_id: string | null;
  stack_name: string | null;
  project: string | null;
  created: string | null;
};

export type PotInfra = {
  snapshot_at: string | null;
  docker_ps_ok: boolean | null;
  docker_info_ok: boolean | null;
  hostname: string | null;
  system: string | null;
  containers: PotContainer[];
};

export type PotCommand = {
  id: string;
  pot_id: string;
  stack_id: string | null;
  action: string;
  container: string | null;
  params: string | null;
  status: string;
  output: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

export type StackDeleteResult = {
  teardown_command_id: string | null;
};

export type PotDeleteResult = {
  teardown_command_ids: string[];
};

export type StackRevision = {
  id: string;
  stack_id: string;
  revision: number;
  compose_yaml: string;
  note: string | null;
  created_at: string;
};

export type SnapshotRow = {
  id: string;
  name: string;
  description: string | null;
  image_reference: string;
  image_id: string | null;
  pot_id: string | null;
  created_by_user_id: string | null;
  labels: Record<string, unknown> | null;
  created_at: string;
};

export type BackupArtifactRow = {
  id: string;
  job_id: string;
  container: string | null;
  image_reference: string | null;
  artifact_format: string;
  storage_location: "agent" | "server" | "external" | "mixed";
  agent_path: string | null;
  server_path: string | null;
  external_uri: string | null;
  size_bytes: number | null;
  sha256: string | null;
  transfer_sha256: string | null;
  transfer_verified_at: string | null;
  created_at: string;
};

export type BackupJobRow = {
  id: string;
  name: string;
  backup_type: "container" | "pot" | "host";
  pot_id: string;
  pot_name?: string | null;
  container: string | null;
  status: "pending" | "running" | "completed" | "failed";
  command_id: string | null;
  ingest_command_id?: string | null;
  schedule_id: string | null;
  storage_location: "agent" | "server" | "external" | "mixed";
  artifact_path: string | null;
  artifact_size: number | null;
  artifact_format: string | null;
  artifact_sha256: string | null;
  server_artifact_path: string | null;
  ingest_status: string | null;
  image_reference: string | null;
  image_id: string | null;
  detail_json: string | null;
  error: string | null;
  requested_by_user_id: string | null;
  created_at: string;
  completed_at: string | null;
  artifacts?: BackupArtifactRow[] | null;
};

export type BackupScheduleRow = {
  id: string;
  name: string;
  backup_type: "container" | "pot" | "host";
  pot_id: string;
  pot_name?: string | null;
  container: string | null;
  interval_hours: number;
  enabled: boolean;
  retention_count: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

export type OperatorSettings = {
  cors_origins: string[];
  deployment_stack_mode: string;
  allow_public_registration: boolean;
  access_token_expire_minutes: number;
  external_log_paths: string[];
  jwt_algorithm: string;
  /** Pots with heartbeats older than this many minutes are shown as offline. */
  heartbeat_stale_minutes: number;
};

export type EventRow = {
  id: string;
  pot_id: string;
  stack_id: string | null;
  service_name: string | null;
  event_type: string;
  severity: string;
  channel: string;
  source: string;
  payload: Record<string, unknown> | null;
  received_at: string;
  raw_log?: string | null;
};

export type AuditLogRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
};
