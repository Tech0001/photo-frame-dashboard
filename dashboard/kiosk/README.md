# Home HQ kiosk navigation

Hold two fingers still on the dashboard for 1.5 seconds to open the native controls:

- **Open launcher** opens another installed Home app, such as Rootless Launcher.
  If none is available, it opens Android Settings.
- **Android settings** opens the device's Settings app.
- **Wi-Fi settings** opens Android's Wi-Fi list directly.
- **Reload dashboard** reloads the current URL.
- **Back to dashboard** dismisses the controls.

## Dashboard URL

The kiosk opens the hosted demo dashboard by default. To show your own, save its URL once:

```sh
adb shell am start -n com.wesbos.homehq/.MainActivity --es url https://your-dashboard/
```

Every later launch, including after a reboot, opens the saved URL. This fork also
remembers HTTP(S) URLs supplied by VIEW intents, preserving existing frame setups.
`--ez reset_url true` clears the saved URL and returns to bundled assets when
available, otherwise the hosted demo. `KIOSK_BUNDLE=1 bash kiosk/build.sh` includes
`dashboard/dist` in the APK after building the web dashboard.

## Start at boot

This fork keeps Home HQ available in Android's Home chooser and starts it on
`BOOT_COMPLETED`. Choose **Home HQ → Always** on the frame to make it the default
Home app. Its existing `.MainActivity` component is preserved so updates do not
break that choice. Unlike upstream's optional `.Home` alias, no `--ez home true`
step is needed in this fork.

```sh
adb shell am start -a android.intent.action.MAIN -c android.intent.category.HOME
```

Keep another launcher installed so **Open launcher** has somewhere to go.
To undo the default, choose another Home app in Settings → Apps → Default apps.
The kiosk keeps retrying if Wi-Fi or the hub isn't ready at startup, with a
native offline screen and a button for Wi-Fi settings. Retry timers pause while
another app is in front; failed images and API requests do not reload the page.

## Frames without Home or Back buttons

Some frame firmware omits Android's navigation bar. The two-finger gesture only
works inside Home HQ, so it cannot bring you back from another app's settings.

Enable **Home HQ navigation** in Android **Settings → Accessibility**. The
optional service adds floating **Back** and **Dashboard** buttons outside Home HQ:

- **Back** performs Android's normal Back action.
- **Dashboard** returns directly to Home HQ, keeping the current dashboard URL.
- Drag the dots to move the buttons. Their position is saved.

The buttons hide while Home HQ is active and return when you leave it. Android
keeps the service enabled across reboots. It requests no accessibility events or
screen-content access and does not require root. Disable **Home HQ navigation**
in Accessibility settings to remove the buttons.

On a PF1007L (`20260519` firmware), the vendor `BackgroundManagerService` dropped the
service from the enabled list after every `adb install -r` or force stop of Home HQ, so the
buttons silently disappeared. To have Home HQ put the service back each time it starts, grant
it this permission once:

```sh
adb shell pm grant com.wesbos.homehq android.permission.WRITE_SECURE_SETTINGS
```

The grant survives updates. To turn the buttons off for good, revoke it first
(`pm revoke` with the same arguments), then disable the service in Accessibility settings.

Keep an ADB connection available while enabling the service on a frame with no
other way back. If needed, return to the kiosk with:

```sh
adb shell am start -n com.wesbos.homehq/.MainActivity
```

This service supplies navigation controls only. To start the dashboard at boot,
make Home HQ the default Home app (see [Start at boot](#start-at-boot)).

To build your own dashboard for a PF1007L frame, see
[building-for-the-frame.md](../../docs/building-for-the-frame.md): what WebView 106 supports,
what to avoid, and how to test on the frame.

## When the dashboard can't load

If the dashboard fails to load, Home HQ covers WebView's error page with its own
screen. The error page would print the full URL, including any token in it.

- **No Wi-Fi:** "Connect to Wi-Fi?" with an **Open Wi-Fi settings** button.
- **Wi-Fi is up but the dashboard is unreachable:** "Can't reach the dashboard".

Home HQ keeps retrying every 5 seconds, and the screen disappears once a load
succeeds. Wi-Fi settings open only when tapped, because Wi-Fi is often still
connecting for the first minute after boot.

On frames without a navigation bar (most PF1007L units), set up the navigation service in
[Frames without Home or Back buttons](#frames-without-home-or-back-buttons) first. Otherwise
**Open Wi-Fi settings** leaves no way back to the dashboard.

## Build and install

Use JDK 17, Android build-tools 34.0.0, and platform 34. From `dashboard/`:

```sh
ANDROID_HOME=/path/to/android-sdk bash kiosk/build.sh
adb install -r kiosk/build/homehq.apk
```

The kiosk loads the existing hosted dashboard over the frame's Wi-Fi. A USB
connection is only needed for installation or diagnostics, not normal use.
