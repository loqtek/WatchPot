<p align="center">
  <img src="public/watchPotLogoNoBg.png" alt="watchPot" width="268" />
</p>

<h1 align="center">Watch <span style="color:#10b981">Pot</span></h1>

<p align="center">
  <strong>Self-hosted control plane for honeypots and honeynets.</strong>
</p>

<p align="center">
  Deploy Docker honeypots on one host or many, stream live container logs,<br />
  and centralize events all from a single operator dashboard.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="#-quick-start-docker"><img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker ready" /></a>
  <img src="https://img.shields.io/badge/stack-PostgreSQL%20%7C%20FastAPI%20%7C%20Next.js-10b981" alt="Stack" />
</p>

<p align="center">
  <a href="#quick-start-docker"><strong>Quick start</strong></a> ·
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#deployment-options">Deployment</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<br />

> **Run your own honeynet in minutes.**  
> `docker compose up` brings up the UI, API, database, and a local agent — no manual pot registration on the control-plane host.

---

## Features

<table>
  <tr>
    <td width="50%" valign="top">

**Lab in one command**  
Docker Compose starts Postgres, API, Web UI, and a bundled local agent.

**Multi-pot honeynets**  
Register agents on remote VPS hosts and deploy stacks from the UI.

**Live log wall**  
Stream docker logs across many containers and pots — up to 8 resizable windows with saved presets.

**SIEM-style dashboards**  
Custom monitoring grids, widgets, and preset templates for at-a-glance visibility.

**Unified event pipeline**  
Container logs, infra snapshots, and an operator audit trail in one place.

**Compose-native stacks**  
Versioned Docker Compose per stack — reviewable, reproducible honeypot profiles.

**SIEM integrations**  
Export events to external systems; Zabbix templates included out of the box.

**Agent on the server is automatic**  
The Docker stack registers a local agent for you. No token copy step on the control-plane host.

  </tr>
</table>

---

## Quick start (Docker)

**Requirements:** [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2

```bash
git clone https://github.com/loqtek/watchPot.git
cd watchPot

cp .env.example .env
# Edit WATCHPOT_PUBLIC_HOST to your VPS IP or hostname, then:
docker compose up -d --build
```

**Get your login password** (printed once on first startup):

```bash
docker compose logs api | grep -A4 watchPot
```

<table>
  <tr>
    <th>What</th>
    <th>Where</th>
  </tr>
  <tr>
    <td><strong>Web UI</strong></td>
    <td><a href="https://localhost">https://localhost</a></td>
  </tr>
  <tr>
    <td><strong>Login</strong></td>
    <td><code>wpadmin</code> or <code>wpadmin@watchpot.local</code></td>
  </tr>
  <tr>
    <td><strong>API / OpenAPI</strong></td>
    <td><a href="https://localhost/docs">https://localhost/docs</a></td>
  </tr>
</table>

The stack uses **nginx** with a self-signed local CA. Your browser will warn on first visit — trust `deploy/tls/out/watchpot-local-ca.crt` to silence it (see `docker-compose.yml` header).

The local agent connects automatically and can run honeypot stacks on the same machine via the Docker socket.

<details>
<summary><strong>Non-interactive setup</strong></summary>

```bash
./setup --non-interactive --db postgres --mode full
docker compose up -d --build
```

</details>

<details>
<summary><strong>Stop or reset</strong></summary>

```bash
docker compose down          # stop services
docker compose down -v       # stop and wipe database volume
```

</details>

---

## How it works

```
┌────────────────────────  Control plane  ────────────────────────┐
│  Next.js UI  →  FastAPI  →  PostgreSQL                          │
│       ↑              ↑                                          │
│       └──────────────┴── Agents (desired state + log collection)│
└──────────────────────────────┬──────────────────────────────────┘
                               │ outbound HTTPS / poll
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
   ┌─────────┐           ┌─────────┐           ┌─────────┐
   │  Pot A  │           │  Pot B  │           │  Pot C  │
   │ agent   │           │ agent   │           │ agent   │
   │ Cowrie  │           │ Dionaea │           │ custom  │
   └─────────┘           └─────────┘           └─────────┘
```

| Term | Meaning |
|------|---------|
| **Pot** | A honeypot host (VPS or lab machine) running Docker |
| **Agent** | Pulls desired compose state, runs stacks, ships logs and infra snapshots |
| **Stack** | A versioned Docker Compose definition deployed to a pot |


---

## What's in the repo

| Path | Description |
|------|-------------|
| [`backend/`](backend/) | FastAPI control API |
| [`src/`](src/) | Next.js operator UI |
| [`agent/`](agent/) | Per-pot agent (Docker Compose orchestration + telemetry) |
| [`deploy/`](deploy/) | Example honeypot compose, optional observability configs |
| [`docker-compose.yml`](docker-compose.yml) | Full stack: Postgres · API · Web · Agent |

---

## Deployment options

<table>
  <tr>
    <th>Path</th>
    <th>Best for</th>
    <th>Command</th>
  </tr>
  <tr>
    <td><strong>Full stack</strong></td>
    <td>Lab, homelab, single-machine eval</td>
    <td><code>docker compose up -d --build</code></td>
  </tr>
  <tr>
    <td><strong>Server only</strong></td>
    <td>Dedicated control plane; pots elsewhere</td>
    <td><code>docker compose up -d postgres api web</code></td>
  </tr>
  <tr>
    <td><strong>Remote agent</strong></td>
    <td>Each honeypot VPS</td>
    <td>See <a href="#remote-agent">below</a></td>
  </tr>
  <tr>
    <td><strong>Local dev</strong></td>
    <td>Fast UI / API iteration</td>
    <td>See <a href="#local-development">below</a></td>
  </tr>
</table>

### Server only (control plane)

When honeypots run on **separate machines**, start the API and UI without the bundled agent:

```bash
./setup --non-interactive --db postgres --mode full
docker compose up -d --build postgres api web
```

Set `NEXT_PUBLIC_API_URL` to a URL **reachable from browsers** before building the web image:

```bash
export NEXT_PUBLIC_API_URL="https://your-server.example/api"
docker compose up -d --build web
```

**Production checklist**

- Terminate TLS at a reverse proxy or load balancer
- Use strong Postgres credentials (override defaults in `docker-compose.yml` / `backend/.env`)
- Rotate `jwt_secret` in the `app_settings` table after go-live

### Remote agent

Install an agent on each **pot** — a host that runs honeypot containers.

**1. Register the pot** in the Web UI and copy:

- **Pot ID** → `WATCHPOT_POT_ID` (UUID)
- **Agent token** → `WATCHPOT_AGENT_TOKEN` (starts with `wp_…`)

**2. Run on the pot host:**

```bash
cd agent
docker build -t watchpot-agent:local .
docker run --restart unless-stopped -d \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v watchpot-agent-data:/var/lib/watchpot \
  -e WATCHPOT_API_URL="https://your-control-plane.example/api" \
  -e WATCHPOT_POT_ID="<uuid-from-ui>" \
  -e WATCHPOT_AGENT_TOKEN="wp_…" \
  watchpot-agent:local
```

The pot should appear online within one heartbeat interval.

---

## Local development

For fast iteration without rebuilding Docker images.

**Database**

```bash
docker compose up -d postgres
```

**Backend** (port `6040`, auto-starts a local agent in dev mode)

```bash
cd backend
cp .env.example .env    # set DATABASE_URL
./run
```

**Web UI** (port `3020`)

```bash
npm install
export NEXT_PUBLIC_API_URL="http://127.0.0.1:6040/api"
npm run dev
```

**Agent** (manual, without Docker)

```bash
cd agent
cp env.example .env     # WATCHPOT_POT_ID + WATCHPOT_AGENT_TOKEN
./run
```

SQLite quick path: `./setup --db sqlite --mode local_dev`

---

## Configuration

<details>
<summary><strong>Environment variables</strong></summary>

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Async SQLAlchemy URL (`postgresql+asyncpg://…` or `sqlite+aiosqlite://…`) |
| `WATCHPOT_AUTO_LOCAL_AGENT` | `false` disables auto local agent (default **on**) |
| `WATCHPOT_CORS_ORIGINS` | Comma-separated browser origins (seeded into DB on first run) |

JWT secret, session lifetime, and `allow_public_registration` live in the **`app_settings`** table after first API startup.

### Web (build time)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Public API base for browser calls — rebuild `web` after changing |

### Agent

| Variable | Description |
|----------|-------------|
| `WATCHPOT_API_URL` | Control-plane URL including `/api` |
| `WATCHPOT_POT_ID` | Pot UUID from the UI |
| `WATCHPOT_AGENT_TOKEN` | Secret from pot registration |
| `WATCHPOT_POLL_INTERVAL_SEC` | Desired-state reconcile interval |
| `WATCHPOT_WORK_DIR` | Agent state and per-stack compose files |

On the Docker stack, pot credentials are written automatically to `agent/.env`.

</details>

<details>
<summary><strong>Setup wizard options</strong></summary>

```bash
./setup                              # interactive (Docker-first)
./setup --non-interactive --db postgres --mode full
./setup --non-interactive --db sqlite --mode local_dev
./setup --bare-python                # force local Python instead of Docker
```

</details>

Optional root `.env`: copy [`.env.example`](.env.example) for `NEXT_PUBLIC_API_URL` and compose overrides.

---

## Security

- **Production / internet-facing:** see [`SECURITY.md`](SECURITY.md) — TLS, `EXPOSE_OPENAPI=false`, lock down CORS, set `WATCHPOT_METRICS_TOKEN`
- **Secrets:** rotate bootstrap admin password, JWT secret, and agent tokens after first login; never commit `.env` files
- **Agents:** treat tokens like passwords; use TLS to the API
- **Honeypot hosts:** mounting `docker.sock` is powerful — only on hosts you accept as honeypot infrastructure

---

## More

| Resource | |
|----------|---|
| Example Cowrie stack | [`deploy/compose/cowrie-example.yml`](deploy/compose/cowrie-example.yml) |
| Contributing & CI | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

---

## Contributing

PRs welcome. CI runs frontend lint/build and backend pytest on pull requests. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

<p align="center">
  <sub>MIT License · built for operators who want visibility without the SIEM bill</sub>
</p>

<p align="center">
  <a href="LICENSE">License</a>
</p>
