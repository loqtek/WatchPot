#!/usr/bin/env bash
# watchPot agent installer — enrolls this host as a pot and starts the agent container.
#
# Usage (from the watchPot UI after creating a pot):
#   curl -fsSL "http://control-plane.example/api/public/agent/install.sh" | \
#     WATCHPOT_API_URL="https://control-plane.example/api" \
#     WATCHPOT_POT_ID="<uuid>" \
#     WATCHPOT_AGENT_TOKEN="wp_…" \
#     bash
#
# The install script is fetched over HTTP (port 80) so curl works before the watchPot CA
# is trusted. The script downloads the public CA cert, then uses HTTPS with that CA for
# the agent bundle and all agent ↔ control-plane traffic.
set -euo pipefail

: "${WATCHPOT_API_URL:?Set WATCHPOT_API_URL (must include /api, e.g. https://control.example/api)}"
: "${WATCHPOT_POT_ID:?Set WATCHPOT_POT_ID}"
: "${WATCHPOT_AGENT_TOKEN:?Set WATCHPOT_AGENT_TOKEN}"

WATCHPOT_API_URL="${WATCHPOT_API_URL%/}"
IMAGE="${WATCHPOT_AGENT_IMAGE:-watchpot-agent:latest}"
CONTAINER="${WATCHPOT_AGENT_CONTAINER:-watchpot-agent}"
WORK_VOL="${WATCHPOT_AGENT_VOLUME:-watchpot-agent-data}"
CA_FILE="${WATCHPOT_TLS_CA_FILE:-${HOME}/.config/watchpot/ca.crt}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install it first: https://docs.docker.com/engine/install/" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running or you lack permission. Try: sudo usermod -aG docker \$USER" >&2
  echo "After running you might need to logout and log back in for it to take affect." >&2
  exit 1
fi

http_api_url() {
  local base="${WATCHPOT_API_URL%/}"
  if [[ "$base" == https://* ]]; then
    printf '%s\n' "http://${base#https://}"
  else
    printf '%s\n' "$base"
  fi
}

ca_valid() {
  [ -f "$CA_FILE" ] && grep -q "BEGIN CERTIFICATE" "$CA_FILE" 2>/dev/null
}

# Plain HTTP only — never follow redirects to HTTPS (would save HTML/error bytes as the CA).
curl_http() {
  curl -fsS --max-redirs 0 "$@"
}

bootstrap_ca() {
  if ca_valid && [ "${WATCHPOT_TLS_CA_REFRESH:-}" != "1" ]; then
    return 0
  fi
  if [ -f "$CA_FILE" ] && [ "${WATCHPOT_TLS_CA_REFRESH:-}" != "1" ]; then
    echo "→ Removing invalid cached CA at $CA_FILE (not a PEM certificate)…" >&2
    rm -f "$CA_FILE"
  fi
  local http_base
  http_base="$(http_api_url)"
  mkdir -p "$(dirname "$CA_FILE")"
  echo "→ Fetching control-plane CA from ${http_base}/public/agent/ca.crt (HTTP, no redirect)…"
  if ! curl_http "${http_base}/public/agent/ca.crt" -o "$CA_FILE"; then
    echo "Failed to download CA over HTTP. Common causes:" >&2
    echo "  • Control-plane proxy not updated (needs port-80 exceptions for /api/public/agent/*)" >&2
    echo "  • Port 80 redirects to HTTPS — recreate proxy: docker compose up -d --force-recreate proxy" >&2
    echo "  • TLS not initialized yet — ensure proxy is running on the control plane" >&2
    exit 1
  fi
  chmod 644 "$CA_FILE"
  if ! ca_valid; then
    echo "Downloaded file is not a valid PEM certificate (got HTML or an error page?)." >&2
    echo "Try: curl -v '${http_base}/public/agent/ca.crt'" >&2
    rm -f "$CA_FILE"
    exit 1
  fi
}

api_host_port() {
  local url="$1"
  local scheme hostport host port
  if [[ "$url" == https://* ]]; then
    scheme=https
    hostport="${url#https://}"
  elif [[ "$url" == http://* ]]; then
    scheme=http
    hostport="${url#http://}"
  else
    hostport="$url"
    scheme=https
  fi
  hostport="${hostport%%/*}"
  host="${hostport%%:*}"
  port="${hostport#*:}"
  if [ "$port" = "$hostport" ]; then
    if [ "$scheme" = https ]; then
      port=443
    else
      port=80
    fi
  fi
  printf '%s %s\n' "$host" "$port"
}

is_ipv4() {
  local host="$1"
  [[ "$host" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

curl_api() {
  local url="$1"
  shift
  local host port
  read -r host port < <(api_host_port "$url")
  if is_ipv4 "$host"; then
    local resolved="${url//$host/localhost}"
    curl -fsS --cacert "$CA_FILE" --resolve "localhost:${port}:${host}" "$resolved" "$@"
    return
  fi
  curl -fsS --cacert "$CA_FILE" "$url" "$@"
}

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download the agent bundle." >&2
  exit 1
fi

bootstrap_ca

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "→ Downloading agent bundle (HTTPS + watchPot CA)…"
curl_api "$WATCHPOT_API_URL/public/agent/bundle.tar.gz" | tar -xz -C "$tmpdir"

echo "→ Building image $IMAGE …"
docker build -t "$IMAGE" "$tmpdir"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "→ Replacing existing container $CONTAINER …"
  docker rm -f "$CONTAINER" >/dev/null
fi

echo "→ Starting agent (pot $WATCHPOT_POT_ID)…"
docker run --restart unless-stopped -d \
  --name "$CONTAINER" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$WORK_VOL:/var/lib/watchpot" \
  -v "$CA_FILE:$CA_FILE:ro" \
  -e WATCHPOT_API_URL="$WATCHPOT_API_URL" \
  -e WATCHPOT_POT_ID="$WATCHPOT_POT_ID" \
  -e WATCHPOT_AGENT_TOKEN="$WATCHPOT_AGENT_TOKEN" \
  -e WATCHPOT_TLS_CA_FILE="$CA_FILE" \
  -e WATCHPOT_WORK_DIR=/var/lib/watchpot \
  "$IMAGE"

echo ""
echo "Done. The pot should show as connected in watchPot within ~30 seconds."
echo "Logs: docker logs -f $CONTAINER"
