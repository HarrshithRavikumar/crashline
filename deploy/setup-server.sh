#!/usr/bin/env bash
# Runs ON the Vultr server (Ubuntu). Installs Node + Caddy, runs Crashline as a
# service, and serves it over HTTPS. Usage: bash setup-server.sh [your-domain]
# With no domain it uses <ip>.sslip.io, which still gets a real HTTPS certificate.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

APP_DIR=/opt/crashline
DOMAIN="${1:-}"
IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"
if [ -z "$DOMAIN" ]; then DOMAIN="${IP//./-}.sslip.io"; fi

echo "==> Installing Node.js 20"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing app dependencies"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

echo "==> Running Crashline as a service"
cat > /etc/systemd/system/crashline.service <<EOF
[Unit]
Description=Crashline
After=network.target

[Service]
WorkingDirectory=$APP_DIR
Environment=PORT=3000
Environment=NODE_ENV=production
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable crashline >/dev/null
systemctl restart crashline

echo "==> Installing Caddy (automatic HTTPS)"
# Remove the old third-party Caddy repo if an earlier run added it (it now returns 402).
rm -f /etc/apt/sources.list.d/caddy-stable.list /usr/share/keyrings/caddy-stable-archive-keyring.gpg

install_caddy_binary() {
  # Fallback: official release binary from GitHub.
  local arch url tmp
  arch="$(dpkg --print-architecture)"   # amd64 or arm64
  url="$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest \
        | grep -o "https://[^\"]*caddy_[0-9.]*_linux_${arch}\.tar\.gz" | head -1)"
  [ -n "$url" ] || { echo "Could not find a Caddy download."; return 1; }
  tmp="$(mktemp -d)"
  curl -fsSL "$url" | tar xz -C "$tmp" caddy
  install -m 0755 "$tmp/caddy" /usr/bin/caddy
  rm -rf "$tmp"
  id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
  mkdir -p /etc/caddy
  cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable caddy >/dev/null
}

if ! command -v caddy >/dev/null; then
  apt-get update -qq || true
  apt-get install -y caddy || install_caddy_binary
fi
mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy localhost:3000
}
EOF
systemctl restart caddy

echo "==> Opening web ports"
if command -v ufw >/dev/null; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

sleep 2
if curl -fsS localhost:3000/api/health >/dev/null; then
  echo
  echo "Crashline is live:  https://$DOMAIN"
  echo "City map:           https://$DOMAIN/map.html"
  echo "(The HTTPS certificate can take up to a minute on first visit.)"
else
  echo "The app didn't start. See logs with: journalctl -u crashline -n 50"
  exit 1
fi
