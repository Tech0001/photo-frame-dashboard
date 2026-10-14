# Homelab integration

Based on `pr/hub`. Retains our Pi-hole v5/v6, Gitea and GitHub activity,
Plane/RustDesk availability and Omarchy Time Machine backup panels. Proxmox is
not required and there is no inherited ProxMenux implementation.

Set service URLs, GitHub username, optional Gitea organization, RustDesk ports
and the local backup status.json path in Hub → Connections → Homelab. The backup
adapter reads the Time Machine plugin's reported last success, count and size;
it does not equate a responding VM with a successful backup.

Write-only secret fields: piholeToken (v5), piholePassword (v6 application
password), giteaToken and githubToken. A blank value keeps a saved secret;
null clears it. Status flags ending in Set never contain the secret itself.

Pi-hole management uses the optional server-side SSH helper in tools/pihole.
Configure piholeSsh only after following that setup. Reboot/update actions stay
in authenticated server settings/API and require explicit confirmation strings;
there are no frame-side management buttons. No query history is requested.

The frame checks on opening the tab and at five-minute intervals while visible.
It stops polling when hidden and visibly marks stale status. API tokens and SSH
credentials stay on the server. All examples and tests are generic.
