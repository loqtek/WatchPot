/** Preset Docker Compose stacks for honeypots, decoys, and intentionally vulnerable lab apps. */

/** Pinned T-Pot tag — telekomsecurity/* and several community honeypot tags were removed from Docker Hub. */
const TPOT = "24.04.1";

export type StackTemplateCategory =
  | "honeypot"
  | "vulnerable"
  | "network"
  | "bundle"
  | "minimal";

export type RiskLevel = "info" | "low" | "medium" | "high" | "lab";

export type TweakField = {
  key: string;
  label: string;
  hint?: string;
  kind: "port" | "text" | "select" | "toggle";
  default: string;
  options?: { value: string; label: string }[];
};

export type StackTemplate = {
  id: string;
  name: string;
  category: StackTemplateCategory;
  description: string;
  tags: string[];
  risk: RiskLevel;
  suggestedName: string;
  images: string[];
  ports: { port: number; proto: string; label: string }[];
  tweaks: TweakField[];
  compose: string;
};

export const CATEGORY_LABELS: Record<StackTemplateCategory, string> = {
  honeypot: "Honeypots & decoys",
  vulnerable: "Vulnerable apps (lab)",
  network: "Network & protocol traps",
  bundle: "Multi-service bundles",
  minimal: "Start from scratch",
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  info: "Sensor / passive",
  low: "Low interaction",
  medium: "Medium interaction",
  high: "High interaction",
  lab: "Lab only — real vulns",
};

const HARDENING_ON = `    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true`;

const HARDENING_OFF = "";

/** T-Pot images redirect stdout to log files as uid 2000; fresh named volumes are root-owned. */
const TPOT_LOG_USER = `    user: "0:0"`;

/** Hellpot writes rotating logs under /logs (not stdout). */
const HELLPOT_LOGS_TMPFS = `    tmpfs:
      - /logs:rw,noexec,nosuid,size=64m`;

const RESTART_OPTS = [
  { value: "unless-stopped", label: "Unless stopped" },
  { value: "always", label: "Always" },
  { value: "on-failure", label: "On failure" },
  { value: "no", label: "No (manual)" },
];

function baseTweaks(extra: TweakField[] = []): TweakField[] {
  return [
    {
      key: "RESTART_POLICY",
      label: "Restart policy",
      kind: "select",
      default: "unless-stopped",
      options: RESTART_OPTS,
    },
    {
      key: "ENABLE_HARDENING",
      label: "Container hardening",
      hint: "read_only, cap_drop ALL, no-new-privileges (recommended for honeypots)",
      kind: "toggle",
      default: "true",
    },
    ...extra,
  ];
}

export const STACK_TEMPLATES: StackTemplate[] = [
  {
    id: "cowrie-ssh",
    name: "Cowrie SSH/Telnet",
    category: "honeypot",
    description:
      "Low-interaction SSH and Telnet honeypot. Logs credentials, commands, and downloaded malware samples.",
    tags: ["ssh", "telnet", "cowrie", "low-interaction"],
    risk: "low",
    suggestedName: "cowrie-ssh",
    images: ["cowrie/cowrie:latest"],
    ports: [
      { port: 2222, proto: "tcp", label: "SSH (mapped)" },
      { port: 2223, proto: "tcp", label: "Telnet (mapped)" },
    ],
    tweaks: baseTweaks([
      { key: "SSH_PORT", label: "Host SSH port", kind: "port", default: "2222" },
      { key: "TELNET_PORT", label: "Host Telnet port", kind: "port", default: "2223" },
    ]),
    compose: `services:
  cowrie:
    image: cowrie/cowrie:latest
    ports:
      - "{{SSH_PORT}}:2222"
      - "{{TELNET_PORT}}:2223"
    restart: {{RESTART_POLICY}}
{{HARDENING}}`,
  },
  {
    id: "dionaea",
    name: "Dionaea (multi-protocol)",
    category: "honeypot",
    description:
      "Catches exploits over many protocols (SMB, MSSQL, SIP, etc.). Higher resource use; may need extra caps on some hosts.",
    tags: ["dionaea", "malware", "multi-protocol"],
    risk: "medium",
    suggestedName: "dionaea",
    images: [`dtagdevsec/dionaea:${TPOT}`],
    ports: [
      { port: 445, proto: "tcp", label: "SMB" },
      { port: 1433, proto: "tcp", label: "MSSQL" },
      { port: 3306, proto: "tcp", label: "MySQL" },
    ],
    tweaks: baseTweaks([
      { key: "SMB_PORT", label: "Host SMB port", kind: "port", default: "445" },
      { key: "MSSQL_PORT", label: "Host MSSQL port", kind: "port", default: "1433" },
    ]),
    compose: `services:
  dionaea:
    image: dtagdevsec/dionaea:${TPOT}
    ports:
      - "{{SMB_PORT}}:445"
      - "{{MSSQL_PORT}}:1433"
      - "3306:3306"
    restart: {{RESTART_POLICY}}
    volumes:
      - dionaea-log:/var/log/dionaea
${TPOT_LOG_USER}
{{HARDENING}}
    # Some kernels need: privileged: true — enable only if Dionaea fails to bind.
volumes:
  dionaea-log:`,
  },
  {
    id: "honeytrap",
    name: "Honeytrap",
    category: "network",
    description: "Network sensor that profiles attackers and can proxy or respond to unexpected traffic.",
    tags: ["honeytrap", "network", "sensor"],
    risk: "medium",
    suggestedName: "honeytrap",
    images: ["honeytrap/honeytrap:latest"],
    ports: [{ port: 2222, proto: "tcp", label: "Listener (example)" }],
    tweaks: baseTweaks([{ key: "LISTEN_PORT", label: "Host listen port", kind: "port", default: "2222" }]),
    compose: `services:
  honeytrap:
    image: honeytrap/honeytrap:latest
    network_mode: host
    restart: {{RESTART_POLICY}}
    volumes:
      - honeytrap-data:/data
volumes:
  honeytrap-data:`,
  },
  {
    id: "glutton",
    name: "Glutton (protocol sink)",
    category: "network",
    description: "All-protocol listener that accepts and logs arbitrary connections — useful for noisy network segments.",
    tags: ["glutton", "sink", "network"],
    risk: "info",
    suggestedName: "glutton",
    images: [`dtagdevsec/glutton:${TPOT}`],
    ports: [],
    tweaks: baseTweaks([]),
    compose: `services:
  glutton:
    image: dtagdevsec/glutton:${TPOT}
    network_mode: host
    restart: {{RESTART_POLICY}}
    privileged: true`,
  },
  {
    id: "mailoney",
    name: "Mailoney (SMTP)",
    category: "honeypot",
    description: "SMTP honeypot that logs spam and phishing delivery attempts.",
    tags: ["smtp", "email", "mailoney"],
    risk: "low",
    suggestedName: "mailoney-smtp",
    images: [`dtagdevsec/mailoney:${TPOT}`],
    ports: [{ port: 25, proto: "tcp", label: "SMTP" }],
    tweaks: baseTweaks([{ key: "SMTP_PORT", label: "Host SMTP port", kind: "port", default: "25" }]),
    compose: `services:
  mailoney:
    image: dtagdevsec/mailoney:${TPOT}
    ports:
      - "{{SMTP_PORT}}:25"
    restart: {{RESTART_POLICY}}
    volumes:
      - mailoney-log:/opt/mailoney/logs
${TPOT_LOG_USER}
{{HARDENING}}
volumes:
  mailoney-log:`,
  },
  {
    id: "adbhoney",
    name: "ADB Honey",
    category: "honeypot",
    description: "Android Debug Bridge honeypot — captures ADB scanning and exploit attempts against port 5555.",
    tags: ["adb", "android", "iot"],
    risk: "low",
    suggestedName: "adbhoney",
    images: [`dtagdevsec/adbhoney:${TPOT}`],
    ports: [{ port: 5555, proto: "tcp", label: "ADB" }],
    tweaks: baseTweaks([{ key: "ADB_PORT", label: "Host ADB port", kind: "port", default: "5555" }]),
    compose: `services:
  adbhoney:
    image: dtagdevsec/adbhoney:${TPOT}
    ports:
      - "{{ADB_PORT}}:5555"
    restart: {{RESTART_POLICY}}
    volumes:
      - adbhoney-log:/opt/adbhoney/log
      - adbhoney-dl:/opt/adbhoney/dl
${TPOT_LOG_USER}
{{HARDENING}}
volumes:
  adbhoney-log:
  adbhoney-dl:`,
  },
  {
    id: "redishoneypot",
    name: "Redis honeypot",
    category: "honeypot",
    description: "Fake Redis instance that logs unauthorized commands and intrusion attempts.",
    tags: ["redis", "database", "decoy"],
    risk: "low",
    suggestedName: "redis-honeypot",
    images: [`dtagdevsec/redishoneypot:${TPOT}`],
    ports: [{ port: 6379, proto: "tcp", label: "Redis" }],
    tweaks: baseTweaks([{ key: "REDIS_PORT", label: "Host Redis port", kind: "port", default: "6379" }]),
    compose: `services:
  redishoneypot:
    image: dtagdevsec/redishoneypot:${TPOT}
    ports:
      - "{{REDIS_PORT}}:6379"
    restart: {{RESTART_POLICY}}
    volumes:
      - redishoneypot-log:/var/log/redishoneypot
${TPOT_LOG_USER}
{{HARDENING}}
volumes:
  redishoneypot-log:`,
  },
  {
    id: "elasticpot",
    name: "ElasticPot",
    category: "honeypot",
    description: "Elasticsearch API honeypot — logs scanning for open ES clusters and exploit payloads.",
    tags: ["elasticsearch", "api", "decoy"],
    risk: "low",
    suggestedName: "elasticpot",
    images: [`dtagdevsec/elasticpot:${TPOT}`],
    ports: [{ port: 9200, proto: "tcp", label: "HTTP API" }],
    tweaks: baseTweaks([{ key: "ES_PORT", label: "Host HTTP port", kind: "port", default: "9200" }]),
    compose: `services:
  elasticpot:
    image: dtagdevsec/elasticpot:${TPOT}
    ports:
      - "{{ES_PORT}}:9200"
    restart: {{RESTART_POLICY}}
    volumes:
      - elasticpot-log:/opt/elasticpot/log
${TPOT_LOG_USER}
{{HARDENING}}
volumes:
  elasticpot-log:`,
  },
  {
    id: "ciscoasa",
    name: "Cisco ASA honeypot",
    category: "honeypot",
    description: "Emulates Cisco ASA VPN endpoints to capture VPN-related scanning and exploits.",
    tags: ["cisco", "vpn", "network-appliance"],
    risk: "medium",
    suggestedName: "ciscoasa-honeypot",
    images: [`dtagdevsec/ciscoasa:${TPOT}`],
    ports: [
      { port: 500, proto: "udp", label: "IKE" },
      { port: 8443, proto: "tcp", label: "HTTPS mgmt (mapped)" },
    ],
    tweaks: baseTweaks([
      { key: "HTTPS_PORT", label: "Host HTTPS port", kind: "port", default: "8443" },
    ]),
    compose: `services:
  ciscoasa:
    image: dtagdevsec/ciscoasa:${TPOT}
    ports:
      - "500:500/udp"
      - "{{HTTPS_PORT}}:8443"
    restart: {{RESTART_POLICY}}
    tmpfs:
      - /tmp/ciscoasa:uid=2000,gid=2000
    volumes:
      - ciscoasa-log:/var/log/ciscoasa
${TPOT_LOG_USER}
{{HARDENING}}
volumes:
  ciscoasa-log:`,
  },
  {
    id: "conpot",
    name: "Conpot (ICS/OT)",
    category: "honeypot",
    description: "Industrial control system honeypot (Modbus, S7, HTTP, SNMP). Use only on isolated lab networks.",
    tags: ["ics", "scada", "modbus", "conpot"],
    risk: "medium",
    suggestedName: "conpot-ics",
    images: ["honeynet/conpot:latest"],
    ports: [
      { port: 80, proto: "tcp", label: "HTTP" },
      { port: 502, proto: "tcp", label: "Modbus" },
      { port: 102, proto: "tcp", label: "S7comm" },
    ],
    tweaks: baseTweaks([
      { key: "HTTP_PORT", label: "Host HTTP port", kind: "port", default: "8800" },
      { key: "MODBUS_PORT", label: "Host Modbus port", kind: "port", default: "5020" },
    ]),
    compose: `services:
  conpot:
    image: honeynet/conpot:latest
    ports:
      - "{{HTTP_PORT}}:80"
      - "{{MODBUS_PORT}}:502"
      - "102:102"
    restart: {{RESTART_POLICY}}
    volumes:
      - conpot-log:/var/log/conpot
volumes:
  conpot-log:`,
  },
  {
    id: "hellpot",
    name: "Hellpot (HTTP tarpit)",
    category: "honeypot",
    description: "HTTP listener that slows down web scanners and crawlers — wastes attacker time.",
    tags: ["http", "tarpit", "web"],
    risk: "low",
    suggestedName: "hellpot",
    images: ["ghcr.io/yunginnanet/hellpot:latest"],
    ports: [{ port: 8080, proto: "tcp", label: "HTTP" }],
    tweaks: baseTweaks([{ key: "HTTP_PORT", label: "Host HTTP port", kind: "port", default: "8080" }]),
    compose: `services:
  hellpot:
    image: ghcr.io/yunginnanet/hellpot:latest
    ports:
      - "{{HTTP_PORT}}:8080"
    restart: {{RESTART_POLICY}}
${HELLPOT_LOGS_TMPFS}
{{HARDENING}}`,
  },
  {
    id: "endlessh",
    name: "Endlessh (SSH tarpit)",
    category: "honeypot",
    description: "SSH tarpit that never completes authentication — ties up bots and scanners.",
    tags: ["ssh", "tarpit", "endlessh"],
    risk: "info",
    suggestedName: "endlessh-tarpit",
    images: ["linuxserver/endlessh:latest"],
    ports: [{ port: 2222, proto: "tcp", label: "SSH tarpit" }],
    tweaks: baseTweaks([{ key: "SSH_PORT", label: "Host SSH port", kind: "port", default: "2222" }]),
    compose: `services:
  endlessh:
    image: linuxserver/endlessh:latest
    ports:
      - "{{SSH_PORT}}:2222"
    restart: {{RESTART_POLICY}}`,
  },
  {
    id: "snare-tanner",
    name: "Snare + Tanner (web)",
    category: "honeypot",
    description:
      "Snare mimics vulnerable web apps; Tanner analyzes attacker requests. Two-container web honeynet slice.",
    tags: ["web", "snare", "tanner", "php"],
    risk: "medium",
    suggestedName: "snare-tanner-web",
    images: [`dtagdevsec/snare:${TPOT}`, `dtagdevsec/tanner:${TPOT}`],
    ports: [{ port: 80, proto: "tcp", label: "HTTP (Snare)" }],
    tweaks: baseTweaks([{ key: "HTTP_PORT", label: "Host HTTP port", kind: "port", default: "8080" }]),
    compose: `services:
  tanner:
    image: dtagdevsec/tanner:${TPOT}
    restart: {{RESTART_POLICY}}
  snare:
    image: dtagdevsec/snare:${TPOT}
    depends_on:
      - tanner
    ports:
      - "{{HTTP_PORT}}:80"
    environment:
      - TANNER=tanner
    restart: {{RESTART_POLICY}}`,
  },
  {
    id: "dvwa",
    name: "DVWA",
    category: "vulnerable",
    description:
      "Damn Vulnerable Web Application — classic PHP/MySQL web app with configurable difficulty. Lab networks only.",
    tags: ["web", "php", "dvwa", "training"],
    risk: "lab",
    suggestedName: "dvwa-lab",
    images: ["vulnerables/web-dvwa:latest"],
    ports: [{ port: 80, proto: "tcp", label: "HTTP" }],
    tweaks: [
      {
        key: "RESTART_POLICY",
        label: "Restart policy",
        kind: "select",
        default: "unless-stopped",
        options: RESTART_OPTS,
      },
      { key: "HTTP_PORT", label: "Host HTTP port", kind: "port", default: "4280" },
      {
        key: "PHPMYADMIN",
        label: "Expose phpMyAdmin sidecar",
        kind: "toggle",
        default: "false",
      },
    ],
    compose: `services:
  dvwa:
    image: vulnerables/web-dvwa:latest
    ports:
      - "{{HTTP_PORT}}:80"
    restart: {{RESTART_POLICY}}
    environment:
      - MYSQL_HOSTNAME=db
  db:
    image: mariadb:10
    environment:
      - MYSQL_ROOT_PASSWORD=dvwa
      - MYSQL_DATABASE=dvwa
    restart: {{RESTART_POLICY}}
{{PHPMYADMIN_BLOCK}}`,
  },
  {
    id: "juice-shop",
    name: "OWASP Juice Shop",
    category: "vulnerable",
    description: "Modern vulnerable Node.js e-commerce app — OWASP training and CTF staple.",
    tags: ["web", "nodejs", "owasp", "juice-shop"],
    risk: "lab",
    suggestedName: "juice-shop",
    images: ["bkimminich/juice-shop:latest"],
    ports: [{ port: 3000, proto: "tcp", label: "HTTP" }],
    tweaks: [
      {
        key: "RESTART_POLICY",
        label: "Restart policy",
        kind: "select",
        default: "unless-stopped",
        options: RESTART_OPTS,
      },
      { key: "HTTP_PORT", label: "Host HTTP port", kind: "port", default: "3000" },
    ],
    compose: `services:
  juice-shop:
    image: bkimminich/juice-shop:latest
    ports:
      - "{{HTTP_PORT}}:3000"
    restart: {{RESTART_POLICY}}`,
  },
  {
    id: "webgoat",
    name: "OWASP WebGoat",
    category: "vulnerable",
    description: "Deliberately insecure Java web app for security lessons. Keep off production networks.",
    tags: ["web", "java", "owasp", "webgoat"],
    risk: "lab",
    suggestedName: "webgoat",
    images: ["webgoat/webgoat:latest"],
    ports: [
      { port: 8080, proto: "tcp", label: "WebGoat" },
      { port: 9090, proto: "tcp", label: "WebWolf" },
    ],
    tweaks: [
      {
        key: "RESTART_POLICY",
        label: "Restart policy",
        kind: "select",
        default: "unless-stopped",
        options: RESTART_OPTS,
      },
      { key: "WEBGOAT_PORT", label: "Host WebGoat port", kind: "port", default: "8080" },
      { key: "WEBWOLF_PORT", label: "Host WebWolf port", kind: "port", default: "9090" },
    ],
    compose: `services:
  webgoat:
    image: webgoat/webgoat:latest
    ports:
      - "{{WEBGOAT_PORT}}:8080"
      - "{{WEBWOLF_PORT}}:9090"
    restart: {{RESTART_POLICY}}
    environment:
      - WEBGOAT_PORT=8080
      - WEBWOLF_PORT=9090`,
  },
  {
    id: "bwapp",
    name: "bWAPP",
    category: "vulnerable",
    description: "Buggy web application with 100+ vulnerabilities — PHP/MySQL training target.",
    tags: ["web", "php", "bwapp", "training"],
    risk: "lab",
    suggestedName: "bwapp",
    images: ["raesene/bwapp:latest"],
    ports: [{ port: 80, proto: "tcp", label: "HTTP" }],
    tweaks: [
      {
        key: "RESTART_POLICY",
        label: "Restart policy",
        kind: "select",
        default: "unless-stopped",
        options: RESTART_OPTS,
      },
      { key: "HTTP_PORT", label: "Host HTTP port", kind: "port", default: "8880" },
    ],
    compose: `services:
  bwapp:
    image: raesene/bwapp:latest
    ports:
      - "{{HTTP_PORT}}:80"
    restart: {{RESTART_POLICY}}`,
  },
  {
    id: "mutillidae",
    name: "OWASP Mutillidae II",
    category: "vulnerable",
    description: "PHP web app with OWASP Top 10 style flaws — good for classroom labs.",
    tags: ["web", "php", "owasp", "mutillidae"],
    risk: "lab",
    suggestedName: "mutillidae",
    images: ["citizenstig/nowasp:latest"],
    ports: [{ port: 80, proto: "tcp", label: "HTTP" }],
    tweaks: [
      {
        key: "RESTART_POLICY",
        label: "Restart policy",
        kind: "select",
        default: "unless-stopped",
        options: RESTART_OPTS,
      },
      { key: "HTTP_PORT", label: "Host HTTP port", kind: "port", default: "8666" },
    ],
    compose: `services:
  mutillidae:
    image: citizenstig/nowasp:latest
    ports:
      - "{{HTTP_PORT}}:80"
    restart: {{RESTART_POLICY}}`,
  },
  {
    id: "vulnerable-node",
    name: "Vulnerable Node (vulnnode)",
    category: "vulnerable",
    description: "Small Node.js API with known flaws — lightweight alternative to full web stacks.",
    tags: ["nodejs", "api", "training"],
    risk: "lab",
    suggestedName: "vuln-node",
    images: ["sirappsec/nodejs-vulnerable-app:latest"],
    ports: [{ port: 3000, proto: "tcp", label: "HTTP API" }],
    tweaks: [
      {
        key: "RESTART_POLICY",
        label: "Restart policy",
        kind: "select",
        default: "unless-stopped",
        options: RESTART_OPTS,
      },
      { key: "API_PORT", label: "Host API port", kind: "port", default: "3001" },
    ],
    compose: `services:
  vulnerable-node:
    image: sirappsec/nodejs-vulnerable-app:latest
    ports:
      - "{{API_PORT}}:5000"
    restart: {{RESTART_POLICY}}`,
  },
  {
    id: "wordpress-old",
    name: "WordPress (outdated)",
    category: "vulnerable",
    description: "Pinned older WordPress image for plugin/theme exploit practice — pair with isolated DB.",
    tags: ["wordpress", "cms", "php"],
    risk: "lab",
    suggestedName: "wordpress-vuln-lab",
    images: ["wordpress:4", "mysql:5.7"],
    ports: [{ port: 80, proto: "tcp", label: "HTTP" }],
    tweaks: [
      {
        key: "RESTART_POLICY",
        label: "Restart policy",
        kind: "select",
        default: "unless-stopped",
        options: RESTART_OPTS,
      },
      { key: "HTTP_PORT", label: "Host HTTP port", kind: "port", default: "8081" },
      { key: "MYSQL_ROOT_PASSWORD", label: "MySQL root password", kind: "text", default: "wordpress" },
    ],
    compose: `services:
  db:
    image: mysql:5.7
    environment:
      MYSQL_ROOT_PASSWORD: {{MYSQL_ROOT_PASSWORD}}
      MYSQL_DATABASE: wordpress
    restart: {{RESTART_POLICY}}
  wordpress:
    image: wordpress:4
    depends_on:
      - db
    ports:
      - "{{HTTP_PORT}}:80"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: root
      WORDPRESS_DB_PASSWORD: {{MYSQL_ROOT_PASSWORD}}
      WORDPRESS_DB_NAME: wordpress
    restart: {{RESTART_POLICY}}`,
  },
  {
    id: "mini-honeynet",
    name: "Mini honeynet",
    category: "bundle",
    description: "Cowrie SSH + Redis honeypot + Hellpot HTTP — three decoys on non-default ports.",
    tags: ["bundle", "ssh", "redis", "http"],
    risk: "medium",
    suggestedName: "mini-honeynet",
    images: ["cowrie/cowrie:latest", `dtagdevsec/redishoneypot:${TPOT}`, "ghcr.io/yunginnanet/hellpot:latest"],
    ports: [
      { port: 2222, proto: "tcp", label: "SSH" },
      { port: 6379, proto: "tcp", label: "Redis" },
      { port: 8080, proto: "tcp", label: "HTTP tarpit" },
    ],
    tweaks: baseTweaks([
      { key: "SSH_PORT", label: "Cowrie SSH port", kind: "port", default: "2222" },
      { key: "REDIS_PORT", label: "Redis honeypot port", kind: "port", default: "6379" },
      { key: "HTTP_PORT", label: "Hellpot HTTP port", kind: "port", default: "8088" },
    ]),
    compose: `services:
  cowrie:
    image: cowrie/cowrie:latest
    ports:
      - "{{SSH_PORT}}:2222"
    restart: {{RESTART_POLICY}}
{{HARDENING}}
  redishoneypot:
    image: dtagdevsec/redishoneypot:${TPOT}
    ports:
      - "{{REDIS_PORT}}:6379"
    restart: {{RESTART_POLICY}}
    volumes:
      - redishoneypot-log:/var/log/redishoneypot
${TPOT_LOG_USER}
{{HARDENING}}
  hellpot:
    image: ghcr.io/yunginnanet/hellpot:latest
    ports:
      - "{{HTTP_PORT}}:8080"
    restart: {{RESTART_POLICY}}
${HELLPOT_LOGS_TMPFS}
{{HARDENING}}
volumes:
  redishoneypot-log:`,
  },
  {
    id: "web-lab-duo",
    name: "Web lab duo (DVWA + Juice Shop)",
    category: "bundle",
    description: "Two popular web training targets on separate host ports — isolated lab use only.",
    tags: ["bundle", "dvwa", "juice-shop", "training"],
    risk: "lab",
    suggestedName: "web-lab-duo",
    images: ["vulnerables/web-dvwa:latest", "bkimminich/juice-shop:latest"],
    ports: [
      { port: 4280, proto: "tcp", label: "DVWA" },
      { port: 3000, proto: "tcp", label: "Juice Shop" },
    ],
    tweaks: [
      {
        key: "RESTART_POLICY",
        label: "Restart policy",
        kind: "select",
        default: "unless-stopped",
        options: RESTART_OPTS,
      },
      { key: "DVWA_PORT", label: "DVWA host port", kind: "port", default: "4280" },
      { key: "JUICE_PORT", label: "Juice Shop host port", kind: "port", default: "3000" },
    ],
    compose: `services:
  dvwa:
    image: vulnerables/web-dvwa:latest
    ports:
      - "{{DVWA_PORT}}:80"
    restart: {{RESTART_POLICY}}
  juice-shop:
    image: bkimminich/juice-shop:latest
    ports:
      - "{{JUICE_PORT}}:3000"
    restart: {{RESTART_POLICY}}`,
  },
  {
    id: "ssh-and-web-decoy",
    name: "SSH decoy + HTTP tarpit",
    category: "bundle",
    description: "Cowrie plus Endlessh on different SSH ports — splits bot traffic across personalities.",
    tags: ["bundle", "ssh", "cowrie", "endlessh"],
    risk: "low",
    suggestedName: "ssh-decoy-bundle",
    images: ["cowrie/cowrie:latest", "linuxserver/endlessh:latest"],
    ports: [
      { port: 2222, proto: "tcp", label: "Cowrie" },
      { port: 2223, proto: "tcp", label: "Endlessh" },
    ],
    tweaks: baseTweaks([
      { key: "COWRIE_PORT", label: "Cowrie host port", kind: "port", default: "2222" },
      { key: "ENDLESSH_PORT", label: "Endlessh host port", kind: "port", default: "2223" },
    ]),
    compose: `services:
  cowrie:
    image: cowrie/cowrie:latest
    ports:
      - "{{COWRIE_PORT}}:2222"
    restart: {{RESTART_POLICY}}
{{HARDENING}}
  endlessh:
    image: linuxserver/endlessh:latest
    ports:
      - "{{ENDLESSH_PORT}}:2222"
    restart: {{RESTART_POLICY}}`,
  },
  {
    id: "blank",
    name: "Empty stack",
    category: "minimal",
    description: "Minimal compose skeleton — add your own services, images, volumes, and networks.",
    tags: ["custom", "blank"],
    risk: "info",
    suggestedName: "custom-stack",
    images: [],
    ports: [],
    tweaks: [],
    compose: `services:
  # Add services here, e.g.:
  # myhoneypot:
  #   image: your/image:tag
  #   ports:
  #     - "8080:80"
  #   restart: unless-stopped`,
  },
  {
    id: "custom-yaml",
    name: "Custom YAML only",
    category: "minimal",
    description: "Start with a commented example — full control, no preset image.",
    tags: ["custom", "yaml"],
    risk: "info",
    suggestedName: "my-stack",
    images: [],
    ports: [],
    tweaks: [],
    compose: `# Paste or write full Docker Compose YAML below.
# watchPot stores revisions; the agent runs \`docker compose up\` on the pot.
services:
  example:
    image: nginx:alpine
    ports:
      - "8080:80"
    restart: unless-stopped`,
  },
];

export function getTemplate(id: string): StackTemplate | undefined {
  return STACK_TEMPLATES.find((t) => t.id === id);
}

export function defaultTweakValues(template: StackTemplate): Record<string, string> {
  const v: Record<string, string> = {};
  for (const t of template.tweaks) v[t.key] = t.default;
  return v;
}

const PHPMYADMIN_BLOCK = `  phpmyadmin:
    image: phpmyadmin:latest
    ports:
      - "{{PHPMYADMIN_PORT}}:80"
    environment:
      - PMA_HOST=db
    depends_on:
      - db
    restart: {{RESTART_POLICY}}`;

export function renderStackCompose(
  template: StackTemplate,
  values: Record<string, string>,
): string {
  const hardeningTweak = template.tweaks.find((t) => t.key === "ENABLE_HARDENING");
  const hardeningOn =
    template.compose.includes("{{HARDENING}}") &&
    (values.ENABLE_HARDENING === "true" ||
      (values.ENABLE_HARDENING === undefined && hardeningTweak?.default === "true"));
  const hardening = hardeningOn ? HARDENING_ON : HARDENING_OFF;
  const phpmyadmin =
    template.id === "dvwa" && values.PHPMYADMIN === "true"
      ? PHPMYADMIN_BLOCK.replace(/\{\{PHPMYADMIN_PORT\}\}/g, values.PHPMYADMIN_PORT ?? "8033")
      : "";

  let yaml = template.compose
    .replace(/\{\{HARDENING\}\}/g, hardening)
    .replace(/\{\{PHPMYADMIN_BLOCK\}\}/g, phpmyadmin);

  if (template.id === "dvwa" && values.PHPMYADMIN === "true" && !values.PHPMYADMIN_PORT) {
    yaml = yaml.replace(/\{\{PHPMYADMIN_PORT\}\}/g, "8033");
  }

  for (const [key, val] of Object.entries(values)) {
    yaml = yaml.replaceAll(`{{${key}}}`, val);
  }

  // Strip any leftover placeholders for optional blocks
  yaml = yaml.replace(/\{\{[A-Z0-9_]+\}\}/g, "");

  return yaml.trim() + "\n";
}

export function countComposeServices(yaml: string): number {
  const m = yaml.match(/^\s{2}[a-zA-Z0-9_.-]+:\s*$/gm);
  return m?.length ?? 0;
}

export function validateComposeYaml(yaml: string): { ok: boolean; message?: string } {
  const t = yaml.trim();
  if (!t) return { ok: false, message: "Compose YAML is empty." };
  if (!/^services\s*:/m.test(t)) return { ok: false, message: 'Missing top-level "services:" section.' };
  if (/\t/.test(t)) return { ok: false, message: "Use spaces instead of tabs for YAML indentation." };
  return { ok: true };
}

export function riskTone(risk: RiskLevel): "default" | "success" | "warning" | "danger" | "info" {
  switch (risk) {
    case "info":
      return "info";
    case "low":
      return "success";
    case "medium":
      return "warning";
    case "high":
    case "lab":
      return "danger";
    default:
      return "default";
  }
}
