export type DashboardOverview = {
  range: string;
  since: string;
  until: string;
  heartbeat_stale_minutes: number;
  events: {
    total: number;
    rate_per_hour: number;
    by_severity: { key: string; count: number }[];
    by_event_type: { key: string; count: number }[];
  };
  comparison: {
    current_total: number;
    previous_total: number;
    delta: number;
    delta_percent: number | null;
  };
  timeseries: {
    points: { t: string; count: number }[];
    since: string;
    until: string;
  };
  pots: {
    total: number;
    live: number;
    offline: number;
    awaiting: number;
    rows: DashboardPotRow[];
  };
  stacks: {
    total: number;
    with_compose: number;
    without_compose: number;
  };
  containers: {
    total: number;
    running: number;
    stopped: number;
  };
  top_pots: { pot_id: string; name: string; count: number }[];
  recent_events: {
    id: string;
    pot_id: string;
    event_type: string;
    severity: string;
    source: string;
    received_at: string;
  }[];
};

export type DashboardPotRow = {
  id: string;
  name: string;
  heartbeat_online: boolean;
  last_heartbeat_at: string | null;
  containers_total: number;
  containers_running: number;
};

export const DASHBOARD_RANGES = [
  { key: "1d", label: "1d" },
  { key: "7d", label: "7d" },
  { key: "14d", label: "14d" },
  { key: "31d", label: "31d" },
] as const;
