/** Copy-paste values that match deploy/zabbix/watchpot-template.xml and WatchPot sender output. */

export const ZABBIX_TEMPLATE_URL = "/zabbix/watchpot-template.xml";
export const ZABBIX_TEMPLATE_ITEMS_ONLY_URL = "/zabbix/watchpot-template-items-only.xml";

export type ZabbixPreset = {
  id: string;
  label: string;
  value: string;
  hint?: string;
};

export const ZABBIX_HOST_PRESETS: ZabbixPreset[] = [
  {
    id: "host-name",
    label: "Zabbix host name (WatchPot + template)",
    value: "watchpot",
    hint: "Data collection → Hosts → Host name field",
  },
  {
    id: "item-event",
    label: "Trapper item key — full JSON",
    value: "watchpot.event",
  },
  {
    id: "item-severity",
    label: "Trapper item key — severity graph (0–4)",
    value: "watchpot.severity.num",
  },
  {
    id: "item-count",
    label: "Trapper item key — event rate graph",
    value: "watchpot.events.count",
  },
];

export const ZABBIX_JSONPATH_PRESETS: ZabbixPreset[] = [
  {
    id: "jp-severity",
    label: "JSONPath (optional, on watchpot.event)",
    value: "$.severity",
    hint: "Only if you add manual dependent items instead of importing the template",
  },
  { id: "jp-type", label: "JSONPath — event type", value: "$.event_type" },
  { id: "jp-pot", label: "JSONPath — pot id", value: "$.pot_id" },
  { id: "jp-sev-num", label: "JSONPath — severity number", value: "$.severity_num" },
];

export const ZABBIX_DASHBOARD_STEPS = [
  "Monitoring → Dashboards → Create dashboard (e.g. WatchPot)",
  "Edit dashboard → Add widget → Graph (classic)",
  "Data set → Host: your host (e.g. watchpot) — not the template name WatchPot",
  "Item: WatchPot severity level (key watchpot.severity.num)",
  "Optional second series: WatchPot events (counter) — function Sum for event rate",
  "Set refresh 30s–1m, save",
] as const;

export const ZABBIX_TRIGGER_PRESETS: ZabbixPreset[] = [
  {
    id: "tr-error-json",
    label: "Trigger — error in JSON text",
    value: 'last(/watchpot/watchpot.event,#1) contains "error"',
    hint: "Replace watchpot with your host name if different",
  },
  {
    id: "tr-severity",
    label: "Trigger — included in template (severity ≥ error)",
    value: "last(/WatchPot/watchpot.severity.num)=3 or last(/WatchPot/watchpot.severity.num)=4",
    hint: "Uses template name WatchPot after import; link template to host first",
  },
];

export const ZABBIX_SEVERITY_LEGEND =
  "0=debug · 1=info · 2=warning · 3=error · 4=critical (auto-sent as watchpot.severity.num)";
