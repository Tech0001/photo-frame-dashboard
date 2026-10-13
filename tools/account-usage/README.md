# PC login usage sync

Read current Codex/Claude credentials on the source PC and send only selected
subscription-usage windows to the household frame. No model calls are made.
The existing clients own credential rotation: the collector never exchanges
refresh tokens, rewrites their login files, or sends credentials to the hub.

The user timer checks once a minute. It fetches usage every five minutes, or
sooner if a login file changes or the frame requests Refresh. Its cache contains
only file modification times, request time and last fetch time. It never caches
login contents. If a provider fails, the hub retains the last successful reading
with its original timestamp and a warning. When the PC sleeps or is offline,
readings eventually become stale; this does not keep an unused login alive.

Install this tool and its shared read-only parsers, preserving their paths:

- `tools/account-usage/collect.cjs`
- `hub/lib/accounts.js`
- `hub/lib/account-providers.js`

Under `~/.local/lib/frame-account-sync/`, then create a private config:

```json
{
  "hub": "http://YOUR-HUB:8099",
  "tokenFile": "/absolute/private/local-accounts-token",
  "cacheFile": "/absolute/private/cache.json",
  "credentials": {
    "codex": "/home/USER/.codex/auth.json",
    "claude": "/home/USER/.claude/.credentials.json"
  }
}
```

The dedicated token must match `local_accounts_token` in the hub's secrets,
be owned by the source user, and have mode 0600. It authorizes only selected
Codex/Claude usage, not credentials, OpenRouter, progress or server settings.
Set those two server account records to `{ "source": "local" }`, retaining
other linked accounts. Back up existing secrets before changing source mode.
Never put the token or full login files in the repository or logs.

The included user service/timer runs Node; adjust the Node path for your machine.
Test the collector before enabling the timer. Once configured, server admin
shows **PC login sync**. Entering a saved credential switches that provider back
to server mode; **Use PC login** switches back to the already-configured PC sync.
Unlink disables the selected feed and removes its hub-owned display data.

The CLI usage readers are unofficial endpoints and can change. Codex auth may
be stored in a keyring or an alternate `CODEX_HOME`; this collector uses the
explicit configured files, not arbitrary discovered account directories.
