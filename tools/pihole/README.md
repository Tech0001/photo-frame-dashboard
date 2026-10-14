# Pi-hole management connection

For a Pi-hole v5 or v6 installation directly on a systemd Linux host, `frame-pihole`
adds read-only uptime/version reporting and a small set of maintenance commands.
Docker installations need a different management integration.

The helper is optional. HTTP availability and token-based statistics work without
it. The frame remains read-only; actions are available in the password-protected
hub admin under **Connections → Homelab → Pi-hole management**.

## Install

1. Review `frame-pihole`, then install it on the Pi-hole host as
   `/usr/local/sbin/frame-pihole`, owned by root, mode 0755. It needs Python 3,
   systemd, and `/usr/local/bin/pihole`. It stores root-only action history and
   the latest command log in `/var/lib/frame-pihole`.
2. Create a dedicated SSH key on the hub server, readable only by the hub user.
   Enroll the verified Pi-hole host key in that user's `~/.ssh/known_hosts`.
3. Add the public key to the Pi-hole SSH user's `authorized_keys`, restricted to
   the hub's IP and this forced command (substitute your public key and IP):

   ```text
   from="HUB_IP",restrict,command="sudo -n /usr/local/sbin/frame-pihole \"$SSH_ORIGINAL_COMMAND\"" ssh-ed25519 PUBLIC_KEY frame-hub-pihole
   ```

   The SSH user must be allowed to run that helper with passwordless sudo. If
   it does not already have permission, a narrowly scoped sudoers entry is:

   ```text
   pi ALL=(root) NOPASSWD: /usr/local/sbin/frame-pihole
   ```

   Install sudoers changes using `visudo`. The helper must remain root-owned;
   the SSH user must not be able to edit it or its parent directory. The forced
   command passes the original request as **one quoted argument**. Do not remove
   those escaped quotes: only exact `status`, `gravity`, `restart`, `reboot` and
   `update` requests are accepted. No shell, arbitrary commands, forwarding or
   interactive terminal is available through this key.
4. In the hub's server Connections form, enter the host, username, port and
   absolute path to the private key **on the hub server**. Save, then click
   **Check management**. Test with `status` only during installation.

## Behavior

- `status` reads uptime, boot time, locally cached component versions and the
  last helper job. This runs with the existing five-minute Homelab checks. It
  reads v5's `localversions`/`GitHubVersions` or v6's `versions` file under
  `/etc/pihole` as data; it never sources these files or fetches versions online.
- `gravity` runs `pihole -g`; `restart` restarts `pihole-FTL`; `reboot` reboots the
  host. Every action requires its own confirmation in server settings.
- `update` runs `pihole -up` only when locally known v5 or v6 component versions
  are complete, use the same supported major version, and remain within that
  major version. Old Raspberry Pi OS releases,
  unknown versions and major migrations disable it. This is not an OS upgrade
  tool. Read the [Pi-hole update guidance](https://docs.pi-hole.net/main/update/)
  before software maintenance. Do major upgrades separately with a backup.
  After moving to v6, select Version 6 and save a v6 application password in
  the hub's Homelab settings. After a fresh OS install, also reinstall this
  helper and its restricted SSH connection; the dashboard cannot do that itself.
- Jobs run as transient systemd services, independent of the requesting SSH
  session. Only one job is allowed at a time. Completion is based on the command
  exit code; a queued request is not reported as finished. Reboot completion is
  recognized by a changed Linux boot ID. Job runtime is bounded at 1900 seconds.
- **Last software update through the hub** starts empty. It is recorded only
  after this helper completes a software update successfully, never inferred
  from a Git commit date, file modification time or blocklist refresh.
- The admin briefly polls an active job, then allows manual checks. Reopening
  the page and checking management reads persistent job state. Raw command logs
  remain on the Pi-hole host and are never returned to the dashboard.

To disconnect, clear the management host in server settings. To revoke access,
remove this specific public key line from `authorized_keys`, then remove its
dedicated private key from the hub. Removing the helper does not change Pi-hole.

Tests run without executing maintenance commands:

```sh
python3 -B tools/pihole/test_helper.py
node --test hub/test/pihole-management.test.js
```
