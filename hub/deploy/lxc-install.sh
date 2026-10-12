#!/usr/bin/env bash
# Runs INSIDE the container (started by proxmox-create-lxc.sh). Safe to run again: it updates the code and restarts.
# Expects: the repo at /srv/repo (read-only), the photos mounted under /photos, config in /etc/frame-hub/.
set -euo pipefail
# `pct exec` starts us with a minimal environment: no /usr/local/bin in PATH (where Node goes) and no locale.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export LC_ALL=C LANG=C

NODE_VERSION="v24.21.0"
NODE_SHA256="fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6"   # node-v24.21.0-linux-x64.tar.xz, from nodejs.org/dist/v24.21.0/SHASUMS256.txt
PHOTOS_CT_DIR="${PHOTOS_CT_DIR:-/photos}"

say() { printf '\n--> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ -f /srv/repo/hub/server.js ] || die "/srv/repo is not mounted (the repo bind mount is missing)"
[ -r /srv/repo/hub/server.js ] || die "the container cannot read /srv/repo: the files need 'other' read permission on the host (chmod -R o+rX on the hub and dashboard/dist folders)"
[ -d "$PHOTOS_CT_DIR" ] || { [ -d /photos ] && PHOTOS_CT_DIR=/photos && echo "note: default photo folder is gone, using /photos"; } || die "photo folder $PHOTOS_CT_DIR is not visible in the container"

say "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl xz-utils rsync >/dev/null

say "Node.js $NODE_VERSION (checksum pinned)"
if [ "$(command -v node >/dev/null && node -v || true)" != "$NODE_VERSION" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/node.tar.xz" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"
  echo "$NODE_SHA256  $tmp/node.tar.xz" | sha256sum -c - || die "Node.js download does not match the pinned SHA-256"
  tar -xJf "$tmp/node.tar.xz" -C /usr/local --strip-components=1 --no-same-owner
  rm -rf "$tmp"
fi
node -v

say "Service user and folders"
id framehub >/dev/null 2>&1 || useradd --system --home-dir /var/lib/frame-hub --create-home --shell /usr/sbin/nologin framehub
install -d -o framehub -g framehub /var/lib/frame-hub/data /var/lib/frame-hub/cache
# The hub edits these two files itself (the Connections tab in /admin), so the service user owns them.
chown -R framehub:framehub /etc/frame-hub
chmod 0750 /etc/frame-hub
chmod 0640 /etc/frame-hub/*.json

say "Hub code and dependencies"
install -d /opt/frame-hub
rsync -a --delete --exclude node_modules --exclude data --exclude cache --exclude config --exclude deploy /srv/repo/hub/ /opt/frame-hub/
( cd /opt/frame-hub && npm ci --omit=dev --no-audit --no-fund )

say "systemd service"
cat > /etc/systemd/system/frame-hub.service <<EOF
[Unit]
Description=frame-hub (wall frame data service)
After=network-online.target
Wants=network-online.target

[Service]
User=framehub
Group=framehub
WorkingDirectory=/opt/frame-hub
Environment=NODE_ENV=production
Environment=PORT=8099
Environment="PHOTOS_DIR=${PHOTOS_CT_DIR}"
Environment=PHOTOS_ROOT=/photos
Environment=DASHBOARD_DIR=/srv/repo/dashboard/dist
Environment=DATA_DIR=/var/lib/frame-hub/data
Environment=CACHE_DIR=/var/lib/frame-hub/cache
Environment=HUB_CONFIG=/etc/frame-hub/config.json
Environment=HUB_SECRETS=/etc/frame-hub/secrets.json
ExecStart=/usr/local/bin/node server.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable frame-hub >/dev/null 2>&1
systemctl restart frame-hub

say "Checking it is up"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8099/api/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:8099/api/health; echo
    echo "photos visible to the hub: $(curl -fsS http://127.0.0.1:8099/api/photos | grep -o '"id"' | wc -l)"
    exit 0
  fi
  sleep 1
done
journalctl -u frame-hub -n 30 --no-pager || true
die "frame-hub did not start; see the log above"
