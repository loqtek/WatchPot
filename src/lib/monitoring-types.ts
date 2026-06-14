export type DashboardWidget = {
  id: string;
  widget_type: string;
  title: string;
  config: Record<string, unknown> | null;
  x: number;
  y: number;
  w: number;
  h: number;
  order_index: number;
};

export type OperatorDashboard = {
  id: string;
  user_id: string;
  name: string;
  grid_cols: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  widgets: DashboardWidget[];
};

/** Analytics widget API payloads (kind discriminant). */
export type WidgetPayload =
  | { kind: "stat_total"; value: number; subtitle: string }
  | { kind: "stat_rate"; value: number; subtitle: string }
  | {
      kind: "comparison_24h";
      current_total: number;
      previous_total: number;
      delta: number;
      delta_percent: number | null;
    }
  | { kind: "pie_severity"; items: { key: string; count: number }[] }
  | { kind: "donut_source"; items: { key: string; count: number }[] }
  | { kind: "bar_source"; items: { key: string; count: number }[] }
  | { kind: "bar_event_type"; items: { key: string; count: number }[] }
  | { kind: "horizontal_types"; items: { key: string; count: number }[] }
  | { kind: "timeseries_line"; points: { t: string; count: number }[]; since: string; until: string }
  | {
      kind: "area_severity";
      buckets: string[];
      severities: string[];
      series: Record<string, number[]>;
    }
  | { kind: "top_pots"; items: { pot_id: string; name: string; count: number }[] }
  | { kind: "heatmap_hours"; hours: number[]; counts: number[] }
  | {
      kind: "table_recent" | "log_stream";
      items: {
        id: string;
        pot_id: string;
        event_type: string;
        severity: string;
        source: string;
        received_at: string;
      }[];
    }
  | { kind: "radar_types"; axes: string[]; values: number[] }
  | { kind: "stack_services"; items: { name: string; count: number }[] }
  | { kind: "stacks_bar"; items: { stack_id: string | null; name: string; count: number }[] };
