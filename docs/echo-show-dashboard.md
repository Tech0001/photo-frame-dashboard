# Echo Show dashboard launcher

The Echo Show 8 (`crown`) runs the same Home HQ kiosk launcher as the SI006.
Kiosk 1.5 uses the actual WebView viewport, so higher Android display density
no longer offsets and clips the fixed 1280×800 dashboard. It hides the browser,
status and navigation bars. The saved hub URL survives app restarts.

Set Home HQ as the Android home app. Hold two fingers still for 1.5 seconds to
open controls: Android launcher, Android settings, or reload dashboard. Android
Home returns to Home HQ. The ordinary Android launcher remains installed.

Build with JDK 17 and the Android SDK documented in `dashboard/kiosk/build.sh`.
Install the resulting APK, then select the hub and home activity:

```sh
adb -s DEVICE install --no-incremental -r dashboard/kiosk/build/homehq.apk
adb -s DEVICE shell am start -a android.intent.action.VIEW -d http://YOUR-HUB:8099/ -n com.wesbos.homehq/.MainActivity
adb -s DEVICE shell cmd package set-home-activity com.wesbos.homehq/.MainActivity
```

This Echo's LineageOS 18.1 advertises double-tap wake, but it was disabled. Setting
`settings put secure double_tap_to_wake 1` enabled it; the user confirmed physical
wake and the setting persisted through reboot. This depends on ROM/driver support.

Validation on the Echo: full display fits, Home returns from Settings to Home HQ,
and a real reboot launches Home HQ and restores the Wi-Fi hub connection. The
SI006 installation remains on 1.4. To restore the Echo's original Android home:

```sh
adb -s DEVICE shell cmd package set-home-activity com.android.launcher3/.uioverrides.QuickstepLauncher
adb -s DEVICE shell input keyevent KEYCODE_HOME
```

## Idle display

On this always-powered Echo, Android's separate lock screen and daydream are
turned off. Android stays awake while plugged in; Home HQ's own idle timers then
show its photo screensaver and night theme. This also prevents Spotify's native
app or Android Settings from triggering a device lock between dashboard sessions.

```sh
adb -s DEVICE shell locksettings set-disabled true
adb -s DEVICE shell settings put global stay_on_while_plugged_in 7
adb -s DEVICE shell settings put secure screensaver_enabled 0
```

The locksettings command requires the existing credential if a PIN/password was
set. This device had no PIN/password. Verified a screen-off/wake cycle returns to
Home HQ with keyguard not showing. Double-tap wake remains enabled. Native Spotify
was installed separately and its login is retained. The sidebar shortcut is
described below; an embedded player has not been implemented.

## Household sidebar (kiosk 1.6)

On the Echo, the opt-in household sidebar hides Homelab and Agents and adds a
Spotify button. It opens the installed `com.spotify.music` app and keeps its
existing login. Android Home returns to Home HQ. This is an app shortcut, not an
embedded Spotify player or Web API integration. It requires no developer app.

Enable the preference on a new display when launching the kiosk:

```sh
adb -s DEVICE shell am start -n com.wesbos.homehq/.MainActivity --ez household_sidebar true
```

It survives app restarts. To switch an existing instance back to the default
sidebar, launch with the extra set to false, force-stop Home HQ and launch again.
Only that display changes; the hub and other displays keep their navigation.
The native link handles only `homehq://spotify`, only from the selected dashboard
origin, and launches only the fixed Spotify package. No general Android command
or JavaScript bridge is exposed. Subframe app-link requests are discarded.

Verified on the Echo: button launches Spotify, Home returns to Home HQ, a cold
app restart keeps the household sidebar, fullscreen fit and disabled lock screen.

## Rendering and memory (kiosk 1.7)

Android can retain separate HOME and ordinary app tasks for the same singleTask
activity. On the Echo this left two dashboard activities/WebViews loaded. When
Home HQ is the selected home app, ordinary app launches now forward to its HOME
task before creating a WebView. Non-default-home installations retain their
normal app launch behavior. This also preserves URI/extras during forwarding.

The window, content container and WebView explicitly use opaque black backgrounds,
and the activity clears SHOW_WALLPAPER. This makes photo transitions independent
of the Android wallpaper beneath them. On-device validation found one activity
and one WebView after repeated app/Home launches and a Spotify round trip.

This device has approximately 1 GB of RAM. Android's window, transition and
animator scales were changed from their defaults to 0.5 for quicker navigation;
original values are preserved in local device diagnostics. No ROM change or
Spotify data reset was made. The reported faint ripple pattern was absent from
an ADB screensaver screenshot; physical panel retention or a compositor issue
remains possible if it is still visible on the device after opaque rendering.
