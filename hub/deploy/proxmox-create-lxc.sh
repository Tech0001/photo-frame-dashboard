#!/usr/bin/env bash
# Run as root in the Proxmox host shell (web UI: your node > Shell).
# Creates a small unprivileged Debian LXC that runs frame-hub, or updates an existing one.
#
#   bash /path/to/photo-frame-dashboard/hub/deploy/proxmox-create-lxc.sh
#
# Everything below can be overridden from the environment, for example:
#   CT_IP=192.168.1.50/24 CT_GW=192.168.1.1 STORAGE=local-zfs bash proxmox-create-lxc.sh
#   MODE=update CTID=120 bash proxmox-create-lxc.sh      # after changing hub code
#   MODE=update SYNC_CONFIG=1 CTID=120 bash ...          # also replace the container's settings with the share's copies
#
# What it does: downloads a Debian template if needed, creates the container with the repo and the photo
# folder mounted READ-ONLY, copies config.json and secrets.json into the container (secrets stay private to it),
# then runs deploy/lxc-install.sh inside it (pinned Node.js, systemd service on port 8099).
set -euo pipefail

REPO_DIR="${REPO_DIR:-/path/to/photo-frame-dashboard}"
PHOTOS_DIR="${PHOTOS_DIR:-/path/to/photos}"
CTID="${CTID:-}"
CT_NAME="${CT_NAME:-frame-hub}"
STORAGE="${STORAGE:-local}"                 # where the container's disk goes (see: pvesm status)
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"   # where templates live
BRIDGE="${BRIDGE:-vmbr0}"
CT_IP="${CT_IP:-dhcp}"                          # dhcp, or an address like 192.168.1.50/24 (then set CT_GW too)
CT_GW="${CT_GW:-}"
MODE="${MODE:-create}"                          # create | update
SYNC_CONFIG="${SYNC_CONFIG:-0}"                # 1 = overwrite the container's config.json/secrets.json from the share on update

say() { printf '\n==> %s\n' "$*"; }
ok()  { printf '    ok: %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run this as root on the Proxmox host"
command -v pct >/dev/null || die "pct not found: this must run on the Proxmox host, not inside a container"

say "Checking the repo and folders"
[ -f "$REPO_DIR/hub/server.js" ] || die "no hub/server.js under REPO_DIR=$REPO_DIR (set REPO_DIR to the photo-frame-dashboard folder as the host sees it)"
[ -f "$REPO_DIR/dashboard/dist/index.html" ] || die "the dashboard is not built: on the PC run 'npm run build' in dashboard/"
[ -f "$REPO_DIR/hub/config/config.json" ] || die "missing hub/config/config.json (copy config.example.json)"
[ -f "$REPO_DIR/hub/config/secrets.json" ] || die "missing hub/config/secrets.json (see hub/README.md)"
PHOTOS_GONE=0
if [ ! -d "$PHOTOS_DIR" ]; then
  # the default folder was deleted or renamed: the folders are chosen in /admin now, so share the parent and carry on
  [ -d "$(dirname "$PHOTOS_DIR")" ] || die "photos folder not found: $(dirname "$PHOTOS_DIR") (set PHOTOS_DIR to a folder on the NAS)"
  printf "    note: %s no longer exists; sharing its parent instead. Pick folders in /admin > Photos.
" "$PHOTOS_DIR"
  PHOTOS_DIR="$(dirname "$PHOTOS_DIR")"; PHOTOS_GONE=1
fi
ok "repo, config, secrets and photos found ($(ls -1 "$PHOTOS_DIR" | wc -l) entries in the photo folder)"

# A path with a space is awkward in container config, so in that case mount the parent folder instead.
PHOTOS_SRC="$PHOTOS_DIR"; PHOTOS_CT="/photos"
case "$PHOTOS_DIR" in
  *" "*) PHOTOS_SRC="$(dirname "$PHOTOS_DIR")"; PHOTOS_CT="/photos/$(basename "$PHOTOS_DIR")" ;;
esac

if [ "$MODE" = update ]; then
  [ -n "$CTID" ] || die "MODE=update needs CTID=<container id>"
  pct status "$CTID" >/dev/null 2>&1 || die "container $CTID does not exist"
  pct status "$CTID" | grep -q running || pct start "$CTID"
else
  [ -n "$CTID" ] || CTID="$(pvesh get /cluster/nextid)"
  pct status "$CTID" >/dev/null 2>&1 && die "container $CTID already exists (use MODE=update CTID=$CTID to refresh it)"
  pvesm status | awk 'NR>1 {print $1}' | grep -qx "$STORAGE" || die "storage '$STORAGE' not found; pick one from: $(pvesm status | awk 'NR>1 {printf "%s ", $1}') (STORAGE=...)"

  say "Debian template"
  pveam update >/dev/null 2>&1 || true
  TPL="$(pveam available --section system | awk '{print $2}' | grep -E '^debian-1[23]-standard_.*_amd64\.tar\.(zst|gz)$' | sort -V | tail -1)"
  [ -n "$TPL" ] || die "no Debian 12/13 template found in 'pveam available'"
  pveam list "$TEMPLATE_STORAGE" | grep -q "$TPL" || pveam download "$TEMPLATE_STORAGE" "$TPL"
  ok "$TPL"

  [ "$PHOTOS_SRC" = "$PHOTOS_DIR" ] || printf '    note: the folder name has a space, so its parent (%s) is mounted read-only; the hub only serves %s\n' "$PHOTOS_SRC" "$PHOTOS_CT"

  NET0="name=eth0,bridge=$BRIDGE,ip=$CT_IP,firewall=0"
  [ -n "$CT_GW" ] && NET0="$NET0,gw=$CT_GW"

  say "Creating container $CTID ($CT_NAME)"
  pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TPL" \
    --hostname "$CT_NAME" --ostype debian --unprivileged 1 --onboot 1 \
    --cores 2 --memory 1024 --swap 512 --rootfs "$STORAGE:6" --net0 "$NET0" --features nesting=1 \
    --mp0 "$REPO_DIR,mp=/srv/repo,ro=1" --mp1 "$PHOTOS_SRC,mp=/photos,ro=1" \
    --description "frame-hub: serves the wall frame dashboard (managed by hub/deploy/proxmox-create-lxc.sh)"
  pct start "$CTID"
  for _ in $(seq 1 40); do pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break; sleep 1; done
  pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 || die "the container has no network/DNS; check BRIDGE, CT_IP and CT_GW"
  ok "container is up and online"
fi

say "Copying config and the installer into the container"
pct exec "$CTID" -- mkdir -p /etc/frame-hub
# From the first install on, the container's own config is the master: you edit it in /admin (Connections tab).
# So an update keeps it, unless SYNC_CONFIG=1 asks for the share's copies to replace it.
if [ "$MODE" = update ] && [ "$SYNC_CONFIG" != 1 ] && pct exec "$CTID" -- test -f /etc/frame-hub/secrets.json; then
  ok "keeping the container's settings (edited in /admin); use SYNC_CONFIG=1 to replace them with hub/config/ from the share"
else
  pct push "$CTID" "$REPO_DIR/hub/config/config.json" /etc/frame-hub/config.json --perms 0644
  pct push "$CTID" "$REPO_DIR/hub/config/secrets.json" /etc/frame-hub/secrets.json --perms 0640
  ok "copied config.json and secrets.json from the share into the container"
fi
pct push "$CTID" "$REPO_DIR/hub/deploy/lxc-install.sh" /root/lxc-install.sh --perms 0755
if [ "$MODE" = update ]; then
  # keep whatever an earlier install used, if there is one; otherwise the value worked out above
  OLD_CT="$(pct exec "$CTID" -- sh -c 'sed -n "s/^Environment=\"PHOTOS_DIR=\(.*\)\"$/\1/p" /etc/systemd/system/frame-hub.service 2>/dev/null' || true)"
  [ -z "$OLD_CT" ] || [ "$PHOTOS_GONE" = 1 ] || PHOTOS_CT="$OLD_CT"
fi

say "Installing frame-hub inside the container"
pct exec "$CTID" -- env PHOTOS_CT_DIR="$PHOTOS_CT" bash /root/lxc-install.sh

IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
say "Done"
echo "    Container:  $CTID ($CT_NAME) at $IP"
echo "    Dashboard:  http://$IP:8099/"
echo "    Admin:      http://$IP:8099/admin"
echo
echo "    Next: give $IP a DHCP reservation on your router (or recreate with CT_IP=<fixed ip>/22 CT_GW=<router>),"
echo "    then tell Claude the address so the frame's app can be pointed at it."
echo "    Logs:       pct exec $CTID -- journalctl -u frame-hub -f"
