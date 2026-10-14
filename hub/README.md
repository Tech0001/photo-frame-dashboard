# Hub

An optional server for the dashboard. The frame connects over Wi-Fi; it does
not need USB tethering or a cloud service. The original static demo still works.

This foundation is a new implementation for this fork: configuration loading,
HTTP routes, persistence, calendar/weather adapters, photo serving, the admin UI,
and browser synchronization were written here. It preserves the dashboard data
contract so our existing integrations can be connected without rewriting them.

[artificialmusik’s hub](https://github.com/artificialmusik/photo-frame-dashboard/tree/hub/frame-hub)
inspired the local-hub architecture and informed the feature requirements.
Its implementation is not included in this foundation. The underlying dashboard
comes from [Wes Bos’s photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard).
Third-party libraries retain their own licenses; see package-lock.json.

## Start

Use Node 22 or newer. Build the dashboard and install the hub dependencies:

```sh
npm ci --prefix dashboard
npm run build --prefix dashboard
npm ci --prefix hub
cp hub/config/config.example.json hub/config/config.json
cp hub/config/secrets.example.json hub/config/secrets.json
chmod 600 hub/config/secrets.json
```

Change the example admin password and timezone before starting. Choose the photo
folder; mounted NAS storage is fine. Run `npm start --prefix hub` and open
`http://SERVER:8099/`. Open `/admin` from a phone or computer using username
`admin` and your configured password. Add your people, chores, grocery stores,
usual items, calendar feeds and weather coordinates. New installs start empty;
no personal household or project data is shipped.

Config paths can be set with HUB_CONFIG/HUB_SECRETS. Path overrides: DATA_DIR,
PHOTOS_DIR, CACHE_DIR, DASHBOARD_DIR. PORT, HUB_HOST, TZ and HUB_ADMIN_PASSWORD
also work. Run with HUB_HOST=127.0.0.1 if using a local reverse proxy.

## What is stored

`hub/data/state.json` contains household lists and display settings. Updates
write a new file and rename it atomically. The last 20 states are backed up;
admin can restore one, and the current state is backed up before restoration.
Config and write-only credentials live separately in `hub/config/`. Back up
those directories yourself. They, resized images and uploaded photos are ignored
by git. Never put credentials or household snapshots in a contribution branch.

Calendar feed URLs stay in secrets.json. Weather is fetched on the hub and cached;
opening a forecast panel does not increase the provider request rate. An upstream
failure keeps the previous weather with `stale: true`. Photos are scanned from
configured folders, resized on demand with sharp, and served by opaque IDs.
Symlinks and paths outside the photo library are not served. Uploads accept
validated image data up to 40 MB.

## Access boundary

The service is intended for a trusted home LAN. Household viewing and touch
edits are available to that LAN; administration requires the password. Writes
reject foreign browser origins. Frame display settings use a rotating,
same-origin token and can change only idle timers and optional themes.
Use a TLS reverse proxy if connecting through an untrusted network. Do not
forward the bare hub port to the internet.

## Contributions

The Agents and Homelab integrations are separate branches based on this one.
The weather, themes and tap-to-open display settings branches also work with the
static demo; merging them supplies those UI features to the local hub.
There is no project-progress feed or project-specific data in this branch.

Tests: `npm test --prefix hub`. Integration tests use temporary directories and
local servers; they never contact your live hub or edit its data.
