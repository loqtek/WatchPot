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

bootstrap_ca() {
  if [ -f "$CA_FILE" ] && [ "${WATCHPOT_TLS_CA_REFRESH:-}" != "1" ]; then
    return 0
  fi
  local http_base
  http_base="$(http_api_url)"
  mkdir -p "$(dirname "$CA_FILE")"
  echo "→ Fetching control-plane CA from ${http_base}/public/agent/ca.crt …"
  curl -fsSL "${http_base}/public/agent/ca.crt" -o "$CA_FILE"
  chmod 644 "$CA_FILE"
}

curl_api() {
  curl -fsSL --cacert "$CA_FILE" "$@"
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
