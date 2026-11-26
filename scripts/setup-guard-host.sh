#!/bin/bash
# One-time setup of the elizaplus guard on the web host (Ubuntu 24.04). Run it as a person, once, after reading it:
#   sudo bash scripts/setup-guard-host.sh
# It installs Node.js 26 (Active LTS) from the NodeSource apt repository, installs the service files, and starts nothing
# until /etc/elizaplus-guard.env exists. It never touches the site docroot or the existing nginx config.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "${SRC}/guard/guard.js" ] && [ -f "${SRC}/deploy/elizaplus-guard.service" ] || { echo "run this from an elizaplus checkout"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "run with sudo"; exit 1; }

echo "Checkout: ${SRC}"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" != "26" ]; then
  echo "Installing Node.js 26 from NodeSource..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_26.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi
node -v

install -d -m 0755 /opt/elizaplus-guard
install -m 0644 "${SRC}/guard/guard.js" /opt/elizaplus-guard/guard.js
install -m 0644 "${SRC}/deploy/elizaplus-guard.service" /etc/systemd/system/elizaplus-guard.service
systemctl daemon-reload
if [ -f /etc/elizaplus-guard.env ]; then
  systemctl enable --now elizaplus-guard
  systemctl --no-pager --lines=3 status elizaplus-guard || true
else
  systemctl enable elizaplus-guard
  echo "Not started: create /etc/elizaplus-guard.env first (see deploy/elizaplus-guard.env.example), then: sudo systemctl start elizaplus-guard"
fi
