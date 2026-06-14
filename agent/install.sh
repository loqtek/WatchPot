#!/usr/bin/env bash
# watchPot agent installer — enrolls this host as a pot and starts the agent container.
#
# Usage (from the watchPot UI after creating a pot):
#   curl -fsSL "https://control-plane.example/api/public/agent/install.sh" | \
#     WATCHPOT_API_URL="https://control-plane.example/api" \
#     WATCHPOT_POT_ID="<uuid>" \
#     WATCHPOT_AGENT_TOKEN="wp_…" \
#     bash
set -euo pipefail

: "${WATCHPOT_API_URL:?Set WATCHPOT_API_URL (must include /api, e.g. https://control.example/api)}"
: "${WATCHPOT_POT_ID:?Set WATCHPOT_POT_ID}"
: "${WATCHPOT_AGENT_TOKEN:?Set WATCHPOT_AGENT_TOKEN}"

WATCHPOT_API_URL="${WATCHPOT_API_URL%/}"
IMAGE="${WATCHPOT_AGENT_IMAGE:-watchpot-agent:latest}"
CONTAINER="${WATCHPOT_AGENT_CONTAINER:-watchpot-agent}"
WORK_VOL="${WATCHPOT_AGENT_VOLUME:-watchpot-agent-data}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install it first: https://docs.docker.com/engine/install/" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running or you lack permission. Try: sudo usermod -aG docker \$USER" >&2
  echo "After running you might need to logout and log back in for it to take affect." >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "→ Downloading agent bundle…"
curl -fsSL "$WATCHPOT_API_URL/public/agent/bundle.tar.gz" | tar -xz -C "$tmpdir"

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
  -e WATCHPOT_API_URL="$WATCHPOT_API_URL" \
  -e WATCHPOT_POT_ID="$WATCHPOT_POT_ID" \
  -e WATCHPOT_AGENT_TOKEN="$WATCHPOT_AGENT_TOKEN" \
  -e WATCHPOT_WORK_DIR=/var/lib/watchpot \
  "$IMAGE"

echo ""
echo "Done. The pot should show as connected in watchPot within ~30 seconds."
echo "Logs: docker logs -f $CONTAINER"
