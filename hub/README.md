# frame-hub

The small service that sits behind the wall frame. It runs on your NAS and does these things:

- serves the dashboard to the frame (`http://<nas>:8099/`)
- stores your **chores, groceries, schedule and people**, and lets you edit them from any phone or computer at `/admin`
- reads your **Google Calendar** (a read-only iCal link) and merges it with schedule items you add
- serves your **photos** from the NAS, resized so the frame's 1 GB of RAM can cope
- checks **Pi-hole, Gitea, Plane and RustDesk**, and reads **Omarchy Time Machine** backup status for Homelab; ProxMenux remains optional
- shows the **weather** (Open-Meteo, no key needed) and the **AI usage** the Agents screen reads from `tools/agent-usage/`

The frame itself never sees a calendar link or a token. If the hub is down it shows a clock and keeps retrying.

## 0. Once it is running, change settings in /admin

Open `http://<hub>:8099/admin` and use the **Connections** page (Calendars & services). You can add or remove calendars (iCal links) and choose who each one is for, set the
Homelab service addresses and backup status file, set the weather location, units and timezone, change the admin password, and generate a new collector token. Links, tokens and
passwords are **write-only**: the page shows that one is saved, but never the value. Changes apply immediately, with no restart. There are "Test" buttons for
each calendar link and for ProxMenux.

Under **Weather & time**, search for a city or postal code, choose a result, select
Fahrenheit or Celsius, and click **Save changes**. The selected city fills in its
coordinates and time zone. Nothing is hardcoded into the dashboard. **Use this
device’s location** is also available when the browser supports location access
on a secure connection; ordinary HTTP on a NAS should use city search instead.
Manual coordinates remain available, and **Clear location** removes the setting.
The live dashboard shows a setup prompt until weather is configured.

**The hub's own copy of `config.json` and `secrets.json` is the master once it is running.** In the LXC they live in `/etc/frame-hub/`, and the
Connections tab edits those. The files in `hub/config/` on the share only seed the first install. The update script therefore **keeps** the container's
settings; to replace them with the share's copies on purpose, run it with `SYNC_CONFIG=1`.

### Homelab services and Time Machine

Open **Connections → Homelab**. Enter the Pi-hole web interface address, Gitea
base address, Plane web address, and RustDesk hostname/IP and TCP ports. Save,
then use **Check saved connections**. Blank addresses disconnect that service.
Addresses stay in server settings; the frame receives only names and results.

- **Pi-hole / Plane:** an HTTP GET checks whether the web interface responds.
  This does not establish DNS blocking status or complete application health.
- **Gitea:** checks `/api/healthz` beneath the configured base address and requires
  `status: "pass"`. An older server without this endpoint shows an unavailable check.
- **RustDesk:** connects to the ID and relay TCP ports (defaults 21116 and 21117,
  per the [RustDesk server documentation](https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/install/)).
  This does not test UDP, an actual remote desktop session, or client credentials.

The **Overview**, **Pi-hole** and **Gitea** buttons stay inside Homelab. Add API
tokens in the same server Connections form to enable details. Tokens are
write-only, stored in `secrets.json` as `homelab_pihole_token`,
`homelab_pihole_password` (v6) and `homelab_gitea_token`, and never sent to the
frame. Changing an address requires re-entering its credential; restoring
settings with a different address clears it. Blank fields preserve saved
credentials; tick **Remove saved token/credentials** to unlink.

- **Pi-hole details** support the v5 PHP API (`admin/api.php`) and the v6 REST
  API. For v5, copy the token from **Settings → API / Web interface → Show API
  token**. After upgrading to v6, select **Version 6** in the hub and save an
  application password generated in Pi-hole's **Settings → Web interface / API**
  (Expert mode). The two credentials are stored separately; selecting v6 does
  not upgrade the Pi. Each v6 poll signs in, reads aggregate endpoints, and
  closes its session. Neither API connection requests DNS query history.
  The page shows DNS queries (today for v5, last 24 hours for v6), blocked
  queries/percentage, active clients, blocklist
  size, blocking status, component versions and available updates. The last
  blocklist refresh comes from `gravity_last_updated`, not a software update.
  Unknown component versions are never presented as up to date. This API does
  not report the last host reboot or software installation time. The optional
  [restricted SSH helper](../tools/pihole/README.md) adds uptime, last boot,
  installed versions and admin-only reboot/DNS restart/blocklist refresh/software
  update controls. It records successful software updates made through the hub.
  Old OS releases, unknown versions and major migrations disable the software
  update action. Normal dashboard checks never execute maintenance commands.
  See [Pi-hole's API authentication guide](https://docs.pi-hole.net/api/auth/)
  for application passwords and two-factor authentication.
- **Gitea details** use a token with read access to user, repository, issue and
  organization APIs. They show accessible repository totals, open issues/pull
  requests, the signed-in user's contribution history (in the hub's timezone),
  and recent pushes. Set an optional organization name to focus the push feed;
  otherwise it uses the user's activity feed. Counts remain account-wide.
  Contribution counts include other activity besides commits. Pushes come from
  at most 100 feed events, with duplicate companion events combined; they are
  not lifetime totals. API failures leave affected counts unknown, not zero.
  Private repository names and first-line commit titles accessible to this token
  appear on the household frame. Raw events, commit bodies, email addresses and
  server URLs are not exposed. Authenticated requests reject redirects and never
  follow pagination links to other origins.

Gitea's contribution/feed approach was informed by the
[Omarchy Git plugin](https://github.com/ariadev/omarchy-dev-git). The hub reads
Gitea directly, so the desktop plugin and PC need not stay running.

For [Omarchy Time Machine](https://github.com/jankeesvw/omarchy-time-machine),
enter the absolute path to `~/.local/state/omarchy-time-machine/status.json`
(expand `~` to the backup user's home directory). The hub must be able to read
this file on its own server. In Docker, mount the status **directory** read-only
and use the container path; mounting the directory follows atomic file replacements.
Choose the destination name when there is more than one. You can set the display
name and the overdue threshold (default 36 hours for a nightly backup).

The frame shows the last successful backup, latest failure or overdue warning,
snapshot count, repository size, and latest run duration. It reads the plugin's
cached version-1 report; it does not run backups, verify restoration, or read
repository keys, logs, or backup contents. A missing/unreadable report is unknown,
not successful. The status describes the configured backup destination; use its
label to identify what it actually covers.

Homelab loads when opened, then refreshes every five minutes while visible.
Recent results share a five-minute cache across frames; the refresh button
bypasses that cache for an immediate check. Hidden tabs, the screensaver and
background view preparation do not poll Homelab. Network deadlines are four seconds. If the
frame loses its hub connection, it labels the retained readings as last known
and removes their green status. The collapsed **Optional Proxmox / ProxMenux**
section preserves the original integration; it supplies the Homelab view only
when no service or Time Machine connection is configured.

## 1. First install: put the secrets in one file

Create **`hub/config/secrets.json`** (this repo's `hub/config/` folder, on the NAS share it is `path/to/photo-frame-dashboard/hub/config/`). It is ignored by git and is the only place secrets live:

```json
{
  "ical": {
    "google": "https://calendar.google.com/calendar/ical/.../private-.../basic.ics"
  },
  "proxmenux_token": "the token from ProxMenux Monitor",
  "admin_password": "something you will remember"
}
```

- **Google calendar link:** Google Calendar on the web, the three dots by your calendar, *Settings and sharing*, scroll to **Secret address in iCal format**. Anyone with that link can read the calendar, so keep it private.
- **ProxMenux token:** open `https://proxmenux.example.lan`, *Settings*, *API Access Tokens*, create one. ProxMenux cannot limit a token to read-only, so treat it like a password. The hub only ever makes read (`GET`) requests with it.
- **admin_password:** protects `/admin`. Optional but recommended.

`hub/config/secrets.example.json` shows the shape. `hub/config/config.example.json` has the non-secret settings: copy it to `config.json` and edit.

## 2. Settings: `hub/config/config.json`

```json
{
  "timezone": "UTC",
  "calendars": [ { "name": "Family (Google)", "secret": "google", "people": [] } ],
  "proxmenux": { "url": "https://proxmenux.example.lan", "tokenSecret": "proxmenux_token", "insecureTLS": false },
  "weather": { "lat": 32.22, "lon": -110.97, "units": "f" }
}
```

- `timezone`: an IANA name. Controls "today", chore resets at midnight and all-day events.
- `calendars[].people`: who a calendar's events belong to. Leave empty for everyone. An event titled "Jordan: dentist" is assigned to Jordan automatically.
- `weather`: latitude and longitude (decimal degrees) for [Open-Meteo](https://open-meteo.com/), `"units": "f"` or `"c"`. Leave out for the demo weather.
- `insecureTLS`: set `true` only if ProxMenux uses a certificate your NAS does not trust.
- `photosDir`: folder with your photos (not needed in Docker, see below).

## 3. Run it

### Proxmox LXC (recommended if your NAS is a Proxmox host)

A small unprivileged Debian container with the repo and photos mounted **read-only**, a pinned and checksum-verified Node.js, and a systemd service. Your `config.json` and `secrets.json` are copied into the container, so the secrets live only there.

In the Proxmox web UI open your node, then **Shell**, and run:

```sh
bash /path/to/photo-frame-dashboard/hub/deploy/proxmox-create-lxc.sh
```

It checks that everything it needs exists, downloads a Debian template if you have none, creates the container, installs the hub and prints the address. Options (set before the command): `CTID`, `STORAGE` (default `local-lvm`), `BRIDGE` (`vmbr0`), `CT_IP` and `CT_GW` for a fixed address (default DHCP), `REPO_DIR` and `PHOTOS_DIR` if your host paths differ.

After changing hub code, refresh the container: `MODE=update CTID=<id> bash .../proxmox-create-lxc.sh`. This keeps the settings you edited in `/admin`; add `SYNC_CONFIG=1` to replace them with `hub/config/` from the share. After rebuilding only the dashboard (`npm run build` on the PC) nothing needs doing; the container serves `dashboard/dist` straight from the share. Your chores, groceries and schedule live in the container (`/var/lib/frame-hub/data`), so Proxmox backups of the container include them. Logs: `pct exec <id> -- journalctl -u frame-hub -f`.

If it reports that the container cannot read `/srv/repo`, the files on the share are not readable by "other" users on the host; `chmod -R o+rX` on `hub/` and `dashboard/dist/` fixes that (keep `hub/config/secrets.json` out of it, it is copied in by root).

### Docker (alternative)

On the NAS, in this `hub/` folder:

```sh
cp .env.example .env        # then edit PHOTOS_HOST_DIR to the photo folder's real path on the NAS
docker compose up -d --build
docker compose logs -f      # you should see: frame-hub listening on :8099 ... photos found: N
```

`PHOTOS_HOST_DIR` is the path the NAS itself uses for `photos/frame photos` (for example `/volume1/photos/frame photos` on Synology, `/mnt/user/photos/frame photos` on Unraid, `/mnt/tank/photos/frame photos` on TrueNAS). Update after changes with `docker compose up -d --build`.

The config directory is writable so the admin page can save settings. Set
`HUB_BIND_ADDRESS` in `.env` to the server's LAN address to bind that interface
only (the default is all interfaces). `.env`, settings, secrets, and config
backups are excluded from Git.

### Without Docker

Needs Node.js 22 or newer (the calendar parser requires it).

```sh
cd hub
npm install --omit=dev
PHOTOS_DIR="/path/to/frame photos" node server.js
```

Keep it running with your NAS's service manager (systemd, a Synology task scheduler "boot-up" task, and so on).

### Check it

Open `http://<nas-ip>:8099/` in a browser: you should see the dashboard. `http://<nas-ip>:8099/admin` is the editor.

## 4. Edit things remotely: `/admin`

Works on a phone. A sidebar groups the pages: **Connections** (calendars, accounts, Home Assistant, Homelab, weather and time zone, security), **Frame content** and **Frame**:

- **Chores**: add, rename, choose the routine (morning, midday, evening), who does it, stars, and which days. Ticks reset at midnight.
- **Groceries**: the shopping list, editable stores/categories, and **Usuals & suggestions**.
  Open **Usuals & suggestions** to add, rename or remove reusable search suggestions.
  Search by item/category or tick **Usuals only** to find Quick-add items.
  Tick **Quick-add** for the items shown as usuals on the frame. The tablet sorts
  usuals A–Z in a compact three-column grid and shopping entries A–Z within
  their category. A single toolbar holds store filters and item search. Known
  suggestions add with one tap; adding a new custom name opens category/store
  choices, so those fields do not consume space on the main page.
  Server **Shopping list**, **Usuals & suggestions**, and **Stores & categories**
  tabs retain edits until saving. Save changes to
  sync them automatically; editing common items does not alter the shopping
  entries. You can keep up to 500 common items, with unique names. Renaming a
  category updates both shopping and common items.
  Open **Stores & categories** to add or rename them, then **Save changes**.
  You can keep up to 8 stores and 32 categories. Renaming a category updates its
  items; removing a category or store requires moving its items first. Changes
  save together, so an invalid store or category cannot partially save the list.
  The tablet uses these categories and store names, with a category selector for
  new items. Existing categories and items are retained when updating older hubs.
- **Schedule**: one-off or repeating events (daily, weekly, monthly). Your Google events appear on top automatically.
- **People**: name, colour, whether they earn stars.
- **Status**: whether the calendar, ProxMenux and photos are working.

Changes show up on the frame within about 20 seconds. Ticking a chore or editing groceries on the frame goes back to the hub straight away.

## 5. Photos

Put JPEG, PNG or WebP files in the folder (subfolders are fine; the folder name is used as the photo's "place"). The date comes from the photo's EXIF data, then the filename (`20230708_160947.jpg`), then the file date. **HEIC files are skipped** (convert them to JPEG first). Resized copies are cached in `hub/cache/` and can be deleted at any time.

## 6. Point the frame at the hub

The kiosk app opens any address you give it. With the frame connected over ADB:

```sh
adb shell am start -a android.intent.action.VIEW -d http://<nas-ip>:8099/ -n com.wesbos.homehq/.MainActivity
```

(Run `npm run build` in `dashboard/` first whenever the dashboard code changed. The hub serves `dashboard/dist`, so rebuilding it updates the frame without touching the app.) Give the NAS a fixed IP, or a DHCP reservation, so the frame can always find it. If the hub is unreachable the dashboard keeps running on its demo data and retries.

**Status.** `GET /api/status` reports the hub, its uptime, the time zone and how many calendars are set up.

After changing hub code, update the container (see section 3). Dashboard-only changes need just `npm run build` in `dashboard/` and a reload.

### Linked AI accounts (`lib/accounts.js`)

Open **/admin → Connections → Accounts** to configure the Agents screen. Each connection is optional. Save changes, then use **Test** to check it.

| Account | What to provide | What appears on the frame |
| --- | --- | --- |
| ChatGPT / Codex | The `auth.json` from your Codex login | Available subscription usage windows |
| Claude | `~/.claude/.credentials.json` from a computer signed into Claude Code; paste the JSON or choose the file | Session, weekly and available model-specific limits |
| OpenRouter | The API key whose spending you want to track | That key's daily, weekly and monthly spending, plus its remaining budget if capped |

Claude follows the read-only usage request used by [AI Usagebar](https://github.com/akitaonrails/ai-usagebar). **Claude and Codex use undocumented endpoints** that may change or stop working. Their login tokens can access the account. The hub saves only the access credential and required metadata, discards refresh tokens, and never rotates the original CLI login. When a copied login expires, update the JSON here. OpenRouter uses its [documented current-key endpoint](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key); its figures describe the selected key, **not the whole account's credit balance**. No model requests are made.

Credentials are write-only in the editor, saved in `config/secrets.json` with owner-only permissions, and never sent to the frame. Blank inputs preserve existing connections; **Unlink** deletes the saved credential and hub-fetched readings. Independent collector records from `tools/agent-usage/` are retained.

The hub refreshes linked accounts at startup, after saving, and every five minutes. The frame's refresh button also requests a check. A failed refresh keeps the last successful figures with a connection warning; readings older than 15 minutes are marked stale.

### Evergreen project progress

**Agents → Evergreen** shows the current objective, reported delivery stages,
recent completions, blockers and decisions requiring you. It uses a separate
authenticated progress feed; account usage remains under **Usage**. Built,
reviewed, integrated and live are independently reported, with unknown stages
clearly marked. Stale source reports and disconnected publishers show warnings.
See [the Ledger handoff and automatic sync setup](../tools/project-progress/README.md).
Generate its dedicated publisher token in **Connections → Security**; it is
stored write-only in `config/secrets.json` as `progress_token`. Selected reports
are saved in `data/evergreen-progress.json`. The page waits for its first real
report until a source adapter is connected.

### Emoji on older Android frames

The dashboard bundles Twemoji SVG graphics and serves them from the hub, so supported emoji render even when the tablet's system font lacks them. This also applies to newly added chores and groceries; no emoji CDN or Android font installation is needed. Run `npm ci` and `npm run build` in `dashboard/` when deploying from source. Attribution and the graphics/code licenses are included in `dashboard/public/licenses/` and the built dashboard's `/licenses/` directory.

### Home Assistant: thermostat and Ring

In **/admin → Connections → Home Assistant**, enter the Home Assistant address
reachable from the hub. A pasted dashboard address is reduced to its server
address. In Home Assistant, open your profile's **Security** page and create a
long-lived access token named **Photo frame hub**. Paste it into the hub settings
and save. Use **Find devices**, select a thermostat and up to 16 camera, sensor
or event entities, then save again. Ring and ecobee must already be connected in
Home Assistant; the hub does not need their separate cloud credentials.

The live **Home** page shows the selected thermostat's temperature, humidity,
mode, activity and targets, plus selected Ring events, battery levels and camera
status. **View image** requests a still image from Home Assistant when available;
it is not a live video player, and no capture time is inferred. Ring image
availability depends on the entities and services available to Home Assistant.
Live mode shows a setup prompt until connected rather than sample devices.

Thermostat controls are off by default. Enable **Allow thermostat controls from
this dashboard** in the server's Home Assistant settings to add **Adjust
thermostat** to the Home card. The sheet offers modes, temperature targets and
comfort presets reported by the selected device. Enable **Ecobee: show Resume
schedule** only for an ecobee thermostat with that service available in Home
Assistant. Temperature and comfort changes may create a hold; Resume schedule
requests that ecobee resume its scheduled program.

Before each action, the hub checks the current selected device, availability,
reported capabilities, temperature limits and registered service. It accepts
only those actions, never arbitrary Home Assistant service calls. Requests use
a same-origin action token bound to the saved connection; changing that
connection invalidates an open sheet. Controls are available to people using
the dashboard on the home network. The page distinguishes a request accepted
by Home Assistant from a target/mode subsequently reported by the thermostat.
An unconfirmed change is marked after about a minute; writes are never
automatically retried. Resume requests cannot confirm the active schedule, so
the page asks you to check ecobee. The thermostat's normal scheduling and hold
settings still apply.

With controls disabled, the hub makes only GET requests to Home Assistant.
With controls enabled, explicit actions POST to its service API. The token
still has the permissions of its Home Assistant account: keep it private. It is stored with
owner-only permissions in `config/secrets.json`, never returned to the editor
or frame. Only selected readings reach the frame; camera images are proxied
through the hub without exposing Home Assistant tokens or media URLs. Like
other frame data, those selected readings are available to clients on the hub's
home network. Do not expose the hub publicly.

The visible dashboard checks every 30 seconds; the hub caches requests for 20
seconds. Failed checks retain the last successful readings with a warning, and
readings older than 90 seconds are marked stale. Missing devices appear as
unavailable. Blank token fields preserve the saved token; changing servers
requires a replacement token. **Disconnect** removes the hub's saved connection
and readings. Revoke the token in Home Assistant as well if it is no longer used.

## 8. Where settings live, and how /admin saves them

| What | Where it is kept | Edited from |
| --- | --- | --- |
| Passwords, tokens, calendar links | `config/secrets.json` (write-only in /admin, never backed up or shown) | Connections |
| Calendars, ProxMenux, weather, time zone | `config/config.json` | Connections |
| Chores, groceries, schedule, people | `data/state.json` | their own tabs |
| Everything adjustable about behaviour, **including the away-from-screen timers** | `data/state.json`, validated by one list in `lib/tune.js` | Settings |

**One list of settings.** Add a row to `SCHEMA` in `lib/tune.js` and /admin builds the control, search finds it, "Changed only" lists it when it differs from the default, and the hub validates every save. A row's `store` says where its value is kept; the timers stay where the frame already reads them, so nothing on the frame had to change.

**Two ways to save, never mixed on a page.**
- *Settings, photo folders and the Status page save as you go.* A dot marks anything not at its default; each setting is tagged Frame or Hub.
- *Everything else is a form* (chores, groceries, schedule, people, connections). Edits stay on the page until you press **Save changes**. A dot on the tab and "Unsaved changes: ..." at the bottom show what is waiting, one Save writes every changed form (so nothing typed on one tab is lost by saving on another), and the browser warns before you leave with unsaved changes. Ctrl+S saves.

**Automatic backups.** Before the hub changes `state.json` or `config.json` it keeps a copy in `backups/` beside the file: at most one every 10 minutes, the newest 40 of each. **Status > Backups** lists them with a Restore button; a restore first keeps what you have now, so it can be undone. `secrets.json` is never copied.

**Status** lists what is working (hub, admin password, each calendar, photos, weather, ProxMenux, backups) with a Fix or Set up button that jumps to the right page.

## Security notes

- The hub has no login except the optional admin password, and the frame's own edits are unauthenticated. It is meant for your home network only. **Do not expose port 8099 to the internet.**
- `config/secrets.json` holds your private calendar link and a ProxMenux token that can control your VMs. Do not commit it, share it or put it in a cloud-synced folder.
- Back up `hub/data/state.json`: it is your chores, groceries and schedule.

## Files

| Path | What |
| --- | --- |
| `server.js`, `lib/` | the service |
| `public/admin.html` | the editor |
| `config/config.json` | settings (you create from the example) |
| `config/secrets.json` | calendar link, ProxMenux token, admin password (you create) |
| `data/state.json` | your chores, groceries, events, people (created on first run) |
| `cache/` | resized photos |
