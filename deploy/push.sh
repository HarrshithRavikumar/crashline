#!/usr/bin/env bash
# Runs on YOUR Mac, from the crashline folder. Uploads the app to a Vultr
# server and sets it up. Usage:
#   bash deploy/push.sh SERVER_IP            → https://SERVER-IP.sslip.io
#   bash deploy/push.sh SERVER_IP your.domain → https://your.domain
# Run it again any time to push code changes.
set -euo pipefail
IP="${1:?Usage: bash deploy/push.sh SERVER_IP [domain]}"
DOMAIN="${2:-}"
cd "$(dirname "$0")/.."

if [ ! -f server.js ]; then echo "Run this from inside the crashline folder."; exit 1; fi
[ -f .env ] || echo "Note: no .env file here, so AI translation will be off on the server."

echo "==> Uploading to root@$IP (enter the server password from the Vultr dashboard)"
# --no-mac-metadata / --no-xattrs keep macOS file tags out of the upload (only on Mac tar).
EXTRA=""
if tar --help 2>&1 | grep -q -- --no-mac-metadata; then EXTRA="--no-mac-metadata --no-xattrs"; fi
# shellcheck disable=SC2086
COPYFILE_DISABLE=1 tar $EXTRA --exclude=node_modules --exclude=data --exclude=.git --exclude=.DS_Store -czf - . \
  | ssh -o StrictHostKeyChecking=accept-new "root@$IP" \
      "mkdir -p /opt/crashline && tar --warning=no-unknown-keyword -xzf - -C /opt/crashline && bash /opt/crashline/deploy/setup-server.sh '$DOMAIN'"
