# Agents integration

Based on `pr/our-hub`. Keeps our Codex, Claude and OpenRouter account cards and
usage readers. No project-progress interface, payload or publisher is included.
The account storage and Codex adapter are new implementations; our Claude,
OpenRouter and PC-login synchronization modules are retained.

In Hub → Connections, configure the Accounts section with keys `codex`, `claude`
and `openrouter`. Each accepts `{ "authJson": "..." }` or `{ "unlink": true }`.
Codex accepts auth.json, Claude accepts its credentials JSON, and OpenRouter
accepts its API key as the authJson string. Secrets are write-only, stored with
mode 0600 and never returned to the frame. Login refresh remains owned by the CLI.

For PC login synchronization, generate a token with an authenticated POST to
`/api/admin/accounts/token` using `{ "kind": "local" }`; it is returned only by
that response. Then set the selected Codex/Claude entry to `{ "source": "local" }`.
The existing tools/account-usage publisher can transport usage summaries. A
separate `{ "kind": "publisher" }` token protects PUT /api/agents. Empty token
configuration never permits anonymous publishing. The UI shows stale data after
15 minutes and retains previous values with a connection warning after failure.

Subscription usage endpoints are unofficial and can change. OpenRouter credit
figures are reported for the configured key; unknown/unavailable account-wide
figures stay unknown rather than being inferred.
