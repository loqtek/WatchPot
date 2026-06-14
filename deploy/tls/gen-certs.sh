#!/bin/sh
# Generate a local CA + server certificate for watchPot compose TLS (idempotent).
set -e

TLS_DIR="${TLS_DIR:-/etc/nginx/tls}"
EXPORT_DIR="${EXPORT_DIR:-/export}"

mkdir -p "$TLS_DIR" "$EXPORT_DIR"

if [ -f "$TLS_DIR/server.crt" ] && [ -f "$TLS_DIR/server.key" ]; then
  if [ -f "$TLS_DIR/ca.crt" ]; then
    cp "$TLS_DIR/ca.crt" "$EXPORT_DIR/watchpot-local-ca.crt"
  fi
  exit 0
fi

echo "watchPot TLS: generating local CA and server certificate…"

openssl genrsa -out "$TLS_DIR/ca.key" 4096 2>/dev/null
openssl req -x509 -new -nodes -key "$TLS_DIR/ca.key" -sha256 -days 3650 \
  -subj "/CN=watchPot Local CA/O=watchPot/C=US" \
  -out "$TLS_DIR/ca.crt"

openssl genrsa -out "$TLS_DIR/server.key" 2048 2>/dev/null

# Optional LAN / custom host IPs (comma-separated), e.g. WATCHPOT_TLS_EXTRA_IPS=10.0.50.32
EXTRA_IPS="${WATCHPOT_TLS_EXTRA_IPS:-}"
if [ -n "${WATCHPOT_PUBLIC_HOST:-}" ]; then
  case "$WATCHPOT_PUBLIC_HOST" in
    *[!0-9.]*) ;; # hostname — nginx accepts IP access without SAN match if user trusts CA
    *) EXTRA_IPS="${EXTRA_IPS:+$EXTRA_IPS,}$WATCHPOT_PUBLIC_HOST" ;;
  esac
fi

{
  cat <<'EOF'
[req]
distinguished_name = req_dn
req_extensions = v3_req
prompt = no
[req_dn]
CN = localhost
[v3_req]
subjectAltName = @alt_names
[alt_names]
DNS.1 = localhost
DNS.2 = watchpot.local
DNS.3 = web
DNS.4 = api
IP.1 = 127.0.0.1
IP.2 = ::1
EOF
  ip_idx=3
  if [ -n "$EXTRA_IPS" ]; then
    OLDIFS=$IFS
    IFS=,
    for ip in $EXTRA_IPS; do
      ip=$(echo "$ip" | tr -d ' ')
      [ -n "$ip" ] || continue
      echo "IP.${ip_idx} = ${ip}"
      ip_idx=$((ip_idx + 1))
    done
    IFS=$OLDIFS
  fi
} > "$TLS_DIR/server.cnf"

openssl req -new -key "$TLS_DIR/server.key" -out "$TLS_DIR/server.csr" -config "$TLS_DIR/server.cnf"
openssl x509 -req -in "$TLS_DIR/server.csr" \
  -CA "$TLS_DIR/ca.crt" -CAkey "$TLS_DIR/ca.key" -CAcreateserial \
  -out "$TLS_DIR/server.crt" -days 825 -sha256 \
  -extensions v3_req -extfile "$TLS_DIR/server.cnf"

chmod 600 "$TLS_DIR/server.key" "$TLS_DIR/ca.key"
chmod 644 "$TLS_DIR/server.crt" "$TLS_DIR/ca.crt"
cp "$TLS_DIR/ca.crt" "$EXPORT_DIR/watchpot-local-ca.crt"
chmod 644 "$EXPORT_DIR/watchpot-local-ca.crt"

echo "watchPot TLS: certificate ready — trust $EXPORT_DIR/watchpot-local-ca.crt to silence browser warnings."
