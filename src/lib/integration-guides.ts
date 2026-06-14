import type { IntegrationProvider } from "@/lib/integration-types";

export type GuideStep = {
  title: string;
  description: string;
  bullets?: string[];
};

export type IntegrationGuide = {
  title: string;
  summary: string;
  prerequisites: string[];
  steps: GuideStep[];
  watchpotFields: { label: string; mapsTo: string }[];
  troubleshooting: string[];
};

export const INTEGRATION_GUIDES: Record<IntegrationProvider, IntegrationGuide> = {
  grafana_loki: {
    title: "Grafana Loki setup",
    summary:
      "WatchPot pushes JSON log streams to Loki’s HTTP push API. Each event becomes one log line with labels for filtering in Grafana Explore.",
    prerequisites: [
      "A running Loki instance (self-hosted, Grafana Alloy, or Grafana Cloud Logs).",
      "Network path from the WatchPot API server to Loki’s push port (often 3100).",
      "Optional: basic auth or tenant header if your Loki is secured or multi-tenant.",
    ],
    steps: [
      {
        title: "1. Confirm Loki is reachable",
        description: "From the machine running the WatchPot API, verify the push endpoint responds.",
        bullets: [
          "Default push URL: http://<loki-host>:3100/loki/api/v1/push",
          "Grafana Cloud: use the URL from your stack → Loki → Details → URL + /loki/api/v1/push",
        ],
      },
      {
        title: "2. Note authentication (if any)",
        description: "Single-tenant Loki often needs no auth. Secured setups use basic auth or a reverse proxy.",
        bullets: [
          "Multi-tenant Loki: set Tenant ID to your org name (sent as X-Scope-OrgID).",
          "Grafana Cloud: use the user ID as username and a Grafana Cloud access policy token as password.",
        ],
      },
      {
        title: "3. Plan your labels",
        description:
          "WatchPot always adds event_type, severity, channel, and pot_id when present. Use Extra labels for static tags.",
        bullets: [
          'Example: {"job":"watchpot","env":"lab","site":"dc1"}',
          "In Grafana Explore, query with: {job=\"watchpot\"} |= \"watchpot\"",
        ],
      },
      {
        title: "4. Configure WatchPot",
        description: "Paste the push URL and credentials below, pick event channels, then Save.",
        bullets: [
          "Enable Runtime + Infra to forward honeypot and container log events.",
          "Use Test connection — you should see a test line in Explore within a few seconds.",
        ],
      },
      {
        title: "5. View logs in Grafana",
        description: "Open Grafana → Explore → select your Loki data source.",
        bullets: [
          "Filter by labels: job, pot_id, event_type, severity.",
          "Log line JSON includes message, event_type, and payload fields from WatchPot.",
        ],
      },
    ],
    watchpotFields: [
      { label: "Loki push URL", mapsTo: "Full URL to POST /loki/api/v1/push" },
      { label: "Tenant ID", mapsTo: "X-Scope-OrgID header (multi-tenant only)" },
      { label: "Username / Password", mapsTo: "HTTP basic auth when required" },
      { label: "Extra labels", mapsTo: "Static Loki stream labels (JSON object)" },
    ],
    troubleshooting: [
      "HTTP 401/403: wrong tenant header or credentials.",
      "HTTP 404: URL missing /loki/api/v1/push path.",
      "No lines in Explore: check API server can reach Loki; confirm integration is Enabled and saved.",
    ],
  },

  grafana_alerting: {
    title: "Grafana Alerting webhook setup",
    summary:
      "WatchPot sends alert-shaped JSON to a Grafana contact point webhook. Use this for notifications, incident workflows, or routing — not for long-term log storage (use Loki for that).",
    prerequisites: [
      "Grafana 9+ with unified alerting (or Grafana Cloud).",
      "Permission to create contact points and optional notification policies.",
    ],
    steps: [
      {
        title: "1. Create a webhook contact point",
        description: "In Grafana, add a receiver that accepts HTTP POST JSON.",
        bullets: [
          "Alerting → Contact points → + Add contact point",
          "Integration: Webhook (or Custom webhook)",
          "Copy the generated URL — paste it into WatchPot as Webhook URL",
        ],
      },
      {
        title: "2. Optional: secure the webhook",
        description: "If your endpoint requires a bearer token, create one and paste it in WatchPot.",
        bullets: [
          "Some proxies add Authorization: Bearer — use the Bearer token field.",
          "Leave empty if the webhook is open on your internal network only.",
        ],
      },
      {
        title: "3. Route alerts (optional)",
        description: "Attach the contact point to a notification policy so firing alerts reach it.",
        bullets: [
          "Alerting → Notification policies → add route matching labels you care about",
          "WatchPot test events use alertname watchpot.integration.test",
        ],
      },
      {
        title: "4. Configure WatchPot",
        description: "Paste webhook URL, enable the integration, select channels, Save, then Test connection.",
        bullets: [
          "Test sends a sample firing alert payload Grafana expects.",
          "Check Grafana → Alerting → Contact points → last delivery or your webhook receiver logs.",
        ],
      },
      {
        title: "5. Tune what gets forwarded",
        description: "Higher-severity runtime events map to firing status in the webhook body.",
        bullets: [
          "Enable Control channel for operator actions (stack deploy, pot commands).",
          "For log search, use Grafana Loki integration instead of this webhook.",
        ],
      },
    ],
    watchpotFields: [
      { label: "Webhook URL", mapsTo: "Grafana contact point URL" },
      { label: "Bearer token", mapsTo: "Optional Authorization header" },
    ],
    troubleshooting: [
      "HTTP 404: webhook URL expired or contact point deleted — regenerate URL.",
      "Nothing received: firewall between API and Grafana; verify HTTPS trust.",
      "Duplicate noise: narrow event channels to runtime + infra only.",
    ],
  },

  zabbix: {
    title: "Zabbix trapper setup",
    summary:
      "WatchPot uses the Zabbix sender protocol (TCP port 10051) to push JSON event payloads into a trapper item. Values appear in Latest data and can trigger triggers.",
    prerequisites: [
      "Zabbix server or proxy accepting passive trapper connections on port 10051.",
      "A host in Zabbix representing WatchPot (or your honeypot fleet).",
      "Firewall: allow WatchPot API host → Zabbix server:10051.",
    ],
    steps: [
      {
        title: "1. Create a host (interfaces only — no items yet)",
        description:
          "In Zabbix, adding a host only defines the host record and its interfaces (Agent, SNMP, etc.). Trapper items are added afterward in a separate screen.",
        bullets: [
          "Data collection → Hosts → Create host",
          "Host name: e.g. watchpot — this exact string is what WatchPot sends as Zabbix host name",
          "Visible name: any label you like (display only)",
          "Host interfaces: add at least one interface (often Agent with the IP of your WatchPot API host, or 127.0.0.1 for a logical host). Trapper data does not use the agent for polling, but Zabbix still expects a host interface on create.",
          "Save the host — you will not see Create item on this form",
        ],
      },
      {
        title: "2. Add a trapper item on that host",
        description:
          "Items are created from the hosts list, not inside the host creation wizard.",
        bullets: [
          "Data collection → Hosts → find your host → click Items in that row (link in the table, not inside Edit host)",
          "Click Create item (upper right on the Items page)",
          "Name: e.g. WatchPot events",
          "Type: Zabbix trapper",
          "Key: watchpot.event (must match WatchPot Trapper item key exactly)",
          "Type of information: Text (fits JSON payloads)",
          "Allowed hosts: optional — leave empty to accept from anywhere, or list your WatchPot API server IP/CIDR",
          "Enabled: checked → Add",
          "Wait up to 60 seconds after saving so the server reloads its configuration cache before testing",
        ],
      },
      {
        title: "3. Pick how WatchPot connects (sender vs API)",
        description:
          "Connection refused on port 10051 usually means nothing is listening there — only the Zabbix agent (10050) is up, or the server trapper port is not exposed.",
        bullets: [
          "Check on the Zabbix server: ss -tlnp | grep 10051 — you should see zabbix_server listening",
          "Port 10050 = Zabbix agent (active checks). WatchPot does not use this port.",
          "Port 10051 = Zabbix server/proxy trapper (sender). WatchPot sender mode needs this open.",
          "If 10051 is closed: use Connection mode API in WatchPot (history.push via api_jsonrpc.php + API token)",
          "Docker: publish 10051:10051 on the zabbix-server container, or use API mode to the web URL",
          "WatchPot API in Docker: use the host LAN IP for server host, not 127.0.0.1",
        ],
      },
      {
        title: "4. Configure WatchPot",
        description: "Match host/key in all modes. Sender mode also needs reachable server host + port 10051.",
        bullets: [
          "Sender: Zabbix server host = IP of server/proxy, port 10051",
          "API: API URL = https://your-zabbix/zabbix/api_jsonrpc.php, API token from Users → API tokens",
          "Zabbix host name = Host name from step 1 (not Visible name)",
          "Trapper item key = Key from step 2",
          "Save → Test connection",
        ],
      },
      {
        title: "5. Verify data in Zabbix",
        description: "Confirm events arrive after a successful test or live traffic.",
        bullets: [
          "Monitoring → Latest data → filter Host = your host, Name = your item",
          "If Test works but Latest data is empty, wait 60s after creating the item and test again",
        ],
      },
      {
        title: "6. Dashboard graph (after import)",
        description:
          "The XML template does not include graphs (Zabbix 7.4 import cannot bind them to template items). Add one widget in the UI.",
        bullets: [
          "Import watchpot-template.xml → link template WatchPot to host watchpot",
          "Dashboard → Add widget → Graph → Host: watchpot → Item: WatchPot severity level",
          "Do not select template WatchPot as the host in the graph — use your real host name",
          "Y axis 0–4 optional; Problems widget picks up the template trigger on severity 3–4",
        ],
      },
    ],
    watchpotFields: [
      { label: "Connection mode", mapsTo: "sender = TCP 10051; api = history.push over HTTPS" },
      { label: "Zabbix server host / port", mapsTo: "Sender only — server/proxy trapper (10051)" },
      { label: "API URL / token", mapsTo: "API only — api_jsonrpc.php + bearer token" },
      { label: "Zabbix host name", mapsTo: "Technical host name in Zabbix" },
      { label: "Trapper item key", mapsTo: "Item key (e.g. watchpot.event)" },
    ],
    troubleshooting: [
      "[Errno 111] Connection refused: nothing listening on that host:port — almost always wrong port (10050 vs 10051) or wrong IP (127.0.0.1 from inside Docker). Switch to API mode or open 10051 on zabbix_server.",
      "Cannot find Create item: Data collection → Hosts → Items link on the host row.",
      "processed: 0 / failed: 1: Host name or item key mismatch (case-sensitive).",
      "API mode HTTP 401: invalid or expired API token.",
      "API item errors: trapper item missing/disabled, or Allowed hosts excludes WatchPot API IP.",
      "Test OK but no Latest data: wait 60s after creating the trapper item.",
    ],
  },

  wazuh: {
    title: "Wazuh indexer setup",
    summary:
      "WatchPot indexes each event as a JSON document via the OpenSearch-compatible API on the Wazuh indexer (port 9200). Documents are searchable in Wazuh Dashboard / Discover.",
    prerequisites: [
      "Wazuh indexer (or OpenSearch) reachable from the WatchPot API server.",
      "Indexer API user with permission to index documents (admin or custom role).",
      "TLS: use Verify TLS for production; disable only for lab self-signed certs.",
    ],
    steps: [
      {
        title: "1. Find your indexer URL",
        description: "The indexer listens for REST API traffic, separate from the Wazuh manager API.",
        bullets: [
          "Typical URL: https://<indexer-host>:9200",
          "Single-node installs: often the same host as the dashboard with port 9200",
        ],
      },
      {
        title: "2. Create or choose an index",
        description: "WatchPot creates documents in the index name you provide (default watchpot-events).",
        bullets: [
          "Index is auto-created on first document if your cluster allows it",
          "Use lowercase names: watchpot-events",
        ],
      },
      {
        title: "3. Get API credentials",
        description: "Use indexer internal users or API roles from Wazuh security.",
        bullets: [
          "Default admin user exists on fresh installs — change passwords in production",
          "Role needs: create_index, write, index on the target index pattern",
        ],
      },
      {
        title: "4. Configure WatchPot",
        description: "Enter base URL (no trailing path), index, username, password, TLS option.",
        bullets: [
          "Save → Test connection — expect HTTP 201 from the indexer",
          "Documents include @timestamp, event_type, severity, pot_id, payload, raw_log",
        ],
      },
      {
        title: "5. Search in Wazuh Dashboard",
        description: "Open Dashboard → Discover or Threat Hunting → pick your index pattern.",
        bullets: [
          "Create index pattern watchpot-events* if not auto-detected",
          "Filter: watchpot:true or event_type:watchpot.integration.test",
        ],
      },
      {
        title: "6. Optional: Wazuh rules and alerts",
        description: "For full SIEM correlation, you can also forward manager logs separately; WatchPot feeds the indexer directly.",
        bullets: [
          "Use Wazuh decoders/rules on indexed fields if you normalize JSON in pipelines",
          "Combine with Wazuh agents on pots for host-level telemetry",
        ],
      },
    ],
    watchpotFields: [
      { label: "Indexer base URL", mapsTo: "https://host:9200 (no /_doc suffix)" },
      { label: "Index name", mapsTo: "OpenSearch index (e.g. watchpot-events)" },
      { label: "Username / Password", mapsTo: "Indexer API credentials" },
      { label: "Verify TLS", mapsTo: "Enable for valid CA-signed certs" },
    ],
    troubleshooting: [
      "HTTP 404 with statusCode/error/message JSON: base URL is the manager or dashboard — use port 9200, not 55000 or 443.",
      "HTTP 401: wrong password or user lacks index permissions.",
      "Certificate errors: turn off Verify TLS only for self-signed lab certs.",
      "HTTP 403 cluster block: check index lifecycle / ISM policies not blocking writes.",
    ],
  },
};
