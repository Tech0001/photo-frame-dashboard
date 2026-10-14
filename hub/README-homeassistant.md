# Home Assistant integration

Based on `pr/hub`. Retains our Home page: selected device groups, thermostat,
sunrise/sunset events, camera snapshots and explicit thermostat controls. Ring
and ecobee connect through Home Assistant; the hub does not log into their apps.

Set `homeassistant` in Hub → Connections: url, climate (entity id), entities
(selected camera/sensor/event ids), controls and ecobeeResume. Add the long-lived
access token in the write-only `token` field. Blank keeps it; `unlink: true`
removes it. The token never reaches the frame. Changing hosts requires reentry
so an existing token is not sent to a different server.

GET /api/admin/homeassistant/entities lists eligible entities for setup. Camera
views are snapshots, labelled as such, not live streams. Unsupported/missing
motion reports stay unavailable. Optional controls are restricted to the
selected thermostat, validated against its reported capabilities, require a
same-origin action token, and report acceptance without claiming physical
completion. They remain disabled by default.

No household entity names, private images or tokens are included in this branch.
Tests use local fake Home Assistant servers.
