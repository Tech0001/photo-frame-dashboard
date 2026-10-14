# Live display control

`hub-display` gives an agent or a person a general workspace on a paired Android
kiosk. It combines Android Debug Bridge with the kiosk's Chrome DevTools socket.
It does not add a catalog of widgets: HTML, CSS, JavaScript, canvas, DOM changes,
native input, files and shell commands are available directly.

The existing kiosk supports the `debug` intent extra. The CLI enables it without
navigating/reloading the page, opens a temporary loopback ADB forward, and removes
that forward after the command. No Hub deployment, APK rebuild, cloud model or
new LAN service is required. It needs Node 22+ and an already authorized ADB device.

Keep device addresses outside Git. Create `~/.config/hub-display/config.json`:

```json
{"device":"YOUR_DEVICE:5555","adb":"/path/to/adb"}
```

Or set `HUB_DISPLAY_DEVICE`, `HUB_DISPLAY_ADB`, and optionally `HUB_DISPLAY_CONFIG`.
The package defaults to `com.wesbos.homehq`; `package` can override it in config.

```sh
node tools/display/hub-display.mjs status
node tools/display/hub-display.mjs show /path/to/my-workspace.html
node tools/display/hub-display.mjs watch /path/to/my-workspace.html
node tools/display/hub-display.mjs eval --workspace 'document.body.style.background="navy"'
node tools/display/hub-display.mjs eval --workspace --file /path/to/update.js
node tools/display/hub-display.mjs screenshot /tmp/display.png
node tools/display/hub-display.mjs tap 500 300
node tools/display/hub-display.mjs swipe 500 600 500 200 400
node tools/display/hub-display.mjs shell 'am start -a android.settings.SETTINGS'
node tools/display/hub-display.mjs clear
```

`show` accepts a self-contained HTML document. It creates a full-screen iframe over
the existing dashboard, with a Dashboard button outside the content. `eval` updates
that running document without resetting its timers or animation. `watch` reloads
only the workspace document when the source file changes; the dashboard stays
loaded. Ctrl-C leaves the workspace visible. `clear` removes it and resumes the
dashboard. The workspace stays visible while disconnected, until dismissed or the
kiosk page restarts. Save reusable work on the PC; runtime DOM edits are temporary.

This is trusted, owner-authored code: the iframe is intentionally **not sandboxed**
and can access the dashboard origin. It is not a viewer for untrusted HTML. Browser
cross-origin rules still apply to external websites. `cdp METHOD JSON` exposes the
full browser protocol; `adb ARGS...` passes through to the selected device. Android
commands have that device's ADB privileges; this tool does not root the device.
Use `detach` to disable WebView debugging when finished.

`play /path/to/audio.wav` sends audio to the current workspace (or dashboard).
A workspace may listen for `hub-audio`; `event.detail` is its HTMLAudioElement.
It can connect that element to Web Audio for a character's mouth animation.
Speech generation can reuse an existing local service; the CLI contains no TTS model.

Agents with shell access can use this CLI immediately. It does not automatically
route the Echo's local Bonsai conversations into a separate coding-agent session.
Project pages/data can be authored in the workspace using the agent's existing
project tools. Keep private project content outside this public tools directory.

Implementation reference: [Chrome WebView remote debugging](https://developer.chrome.com/docs/devtools/remote-debugging/webviews).
