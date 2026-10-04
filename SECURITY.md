# Security Info

## Supported versions

Security fixes are applied to the latest release on the default branch. Older tags are not maintained unless noted in release notes.

## Deployment hardening checklist (VPC / internet-facing)

Before exposing watchPot outside a lab network:

1. **TLS** — Docker Compose includes nginx with a self-signed local CA by default (`https://localhost`). Trust `deploy/tls/out/watchpot-local-ca.crt` for a clean browser experience, or use a real certificate in production. Set `WATCHPOT_ALLOW_LOOPBACK_CORS=false` when internet-facing.
2. **Secrets** — Rotate the bootstrap admin password, JWT secret (`app_settings.jwt_secret`), and all agent tokens after first login.
3. **OpenAPI** — Set `EXPOSE_OPENAPI=false` on the API (disables `/docs`, `/redoc`, `/openapi.json`).
4. **CORS** — Configure allowed origins in **Settings → CORS**; set `WATCHPOT_ALLOW_LOOPBACK_CORS=false` in production.
5. **Metrics** — Set `WATCHPOT_METRICS_TOKEN` and scrape `/metrics` with that bearer token; do not expose metrics publicly without auth.
6. **Registration** — Keep `allow_public_registration=false` (default) unless you explicitly want open sign-up. Login and register are rate-limited per IP.
7. **Database** — `./setup` generates `POSTGRES_PASSWORD`. Helper databases bind to `127.0.0.1` only. Do not publish Postgres or reuse a well-known password.
8. **Agent tokens** — Treat like passwords; store only in secret managers or restricted `.env` files (never commit).
9. **Docker socket** — Agents with `docker.sock` access can control containers on the host; isolate honeypot hosts accordingly.
10. **Operator access** — Authenticated operators can queue shell commands on pots via `docker exec`; restrict UI access.
11. **Browser sessions** — Operator auth uses HttpOnly cookies plus CSRF (`X-CSRF-Token`). Do not put JWTs in `localStorage`.
12. **Public agent assets** — Keep `WATCHPOT_PUBLIC_AGENT_OPEN` unset/false in production. Install commands include a short-lived enrollment token. Optionally set `WATCHPOT_AGENT_ENROLLMENT_TOKEN` as a static shared secret.
13. **Integrations** — Outbound SIEM URLs cannot target loopback, link-local, or cloud metadata unless `WATCHPOT_INTEGRATION_ALLOW_LOOPBACK=true` (lab).

## Known trust boundaries

| Component | Trust level |
|-----------|-------------|
| Operator UI + session cookie | Full control-plane access (CSRF required on mutations) |
| Agent bearer token | Pot-scoped: stacks, events, backup upload, command execution |
| Public agent install bundle | Gated by enrollment token unless `WATCHPOT_PUBLIC_AGENT_OPEN=true` |
| Honeypot containers | Untrusted; assume compromise |
