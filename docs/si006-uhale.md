# SI006 Uhale frame access notes

This fork retains the local kiosk features described below. The upstream device
report separates those local features from its stock hosted dashboard setup.

One 10.1-inch Uhale frame tested on Linux on 2026-10-11. **Root USB ADB, a verified
firmware backup, WebView 106, and the repo's dashboard are working.** The frame
boots into Home HQ and reconnects over USB without an SD card or another RSA
prompt. This is a record of this unit, not a universal SI006 setup script.

This frame uses Spreadtrum hardware. The
[PF1007L start guide](pf1007l-start-here.md) is for Allwinner A33 hardware; its FEL,
U-Boot, partition offsets, and boot patches do not apply to this unit.

## Confirmed identity

| Field | Observed value |
| --- | --- |
| Model | `SI006` |
| Product / hardware | `si006asb` / `sp7731g_1h10` |
| Android / ABI | Android 6.0, SDK 23 / `armeabi-v7a` |
| Build fingerprint | `SPRD/si006asb/sp7731g_1h10:6.0/MRA58K/W25.22.5-11:user/release-keys` |
| Working USB mode | MTP + ADB, `1782:4002`, USB name `Spreadtrum` |
| Internal eMMC | 30,535,680 sectors of 512 bytes |

## Hardware read through ADB

| Component | Observed value |
| --- | --- |
| SoC | Kernel reports `sc7731`; board `sp7731gea_hdr`, platform `sc8830`. The board name suggests SC7731G, but the exact chip variant is not independently confirmed |
| CPU | Four cores present (`0-3`), ARM implementer `0x41`, part `0xc07` (Cortex-A7), maximum frequency 1,300,000 kHz |
| RAM | `MemTotal: 976420 kB` (about 954 MiB usable), consistent with a nominal 1 GiB device |
| GPU | SurfaceFlinger reports `ARM, Mali-400 MP, OpenGL ES 2.0`; GPU core count not exposed |
| Display | Android reports 1280 × 800 at approximately 60 Hz; hardware composer reports an 800 × 1280 panel mode with rotation |
| Storage | eMMC product `F312MB`, manufacturer ID `0x15`, 15,634,268,160 bytes (16 GB class) |

The CPU part ID is defined in the
[ARM Cortex-A7 reference manual, section 4.3.1](https://documentation-service.arm.com/static/5e8f089d88295d1e18d3b906).
Exact RAM package, Wi-Fi chipset, and display panel part number are not confirmed.

## What worked

1. In Uhale **Settings → About**, repeatedly tapping **System version** opened
   native Android Settings. The documented range is about 15–30 taps; the exact
   count on this unit was not recorded.
2. Tapping Android's **Build number** seven times enabled Developer options.
   USB debugging was enabled, but the frame stayed `unauthorized` on the PC.
   The generic debugging warning appeared; a computer RSA fingerprint prompt did
   not appear.
3. Installed **Terminal Emulator for Android 1.0.70** from a FAT32 SD card using
   **Settings → Storage & USB**. The APK came from the
   [author's download page](https://jackpal.github.io/Android-Terminal-Emulator/); its hash was
   not recorded. The F-Droid archive build
   ([`jackpal.androidterm_72.apk`](https://f-droid.org/archive/jackpal.androidterm_72.apk),
   1.0.70-rebuild) has SHA-256
   `95095176ca3fa421102352ecaea0fffb6d13527db023967a7cfa280f7bc05cb5`. Use that build and check
   the hash before installing.
   Running `su -c id` in the terminal returned `uid=0(root)`.
4. Put a local helper, `f.sh`, on that SD card and ran it with `su`. The root shell
   could read the card at `/mnt/media_rw/<SD-UUID>/f.sh`. This helper backed up
   `/data/misc/adb/adb_keys`, preserved existing keys, appended **this PC's public
   ADB key**, restored its SELinux label, and saved an undo script under
   `/data/local/tmp/`. It did not flash firmware or change network ADB settings.
   The PC's private key stayed on the PC.
5. With the frame in **MTP** USB configuration and the USB data connection
   re-established, `adb devices -l` changed to `device`.
   Both `adb -d shell id` and `adb -d shell su -c id` returned `uid=0(root)`.

The trust file is on internal storage, so the SD card is no longer needed for
an already established ADB connection; removing the card did not interrupt access.
An unexpected reboot initially lost authorization. Its cause and the persistent
fix are described below. The original helper remains a private local artifact
because it embeds the owner's public key; a reusable version must accept each
owner's key.

## Useful findings and failed attempts

- **`ro.adb.secure=0` did not mean USB ADB accepted an untrusted PC.** Authentication
  was observed in practice. An initial helper requiring this property to equal
  `1` stopped before making changes; the successful helper only added the USB
  trust key. Later inspection found TCP port 5555 already listening, and a fresh
  ADB connection received an `AUTH` challenge. A Wi-Fi shell was not tested.
- **PTP and ADB-only mode were unreliable on this unit.** Linux sometimes reported
  `no configurations` and error `-22`. Selecting **MTP** in Developer options
  restored enumeration. MTP file transfer itself remained unreliable; using the
  SD card avoided that transfer problem. Continuous kernel USB and ADB monitoring
  helped distinguish failed enumeration from an authorization problem.
- **Use the root-visible SD mount path.** After a network transfer to `/sdcard/f.sh`,
  `su -c 'sh /sdcard/f.sh'` reported no such file. A different storage view in the
  root shell is suspected, not proven. The direct `/mnt/media_rw/` path worked.
- **No Home/Back controls were visible.** Reopening the terminal APK through
  Settings, installing it again, and choosing **Open** worked after a restart.
- The alternate Uhale **Powered by** tapping sequence and code `770880` did not
  open a menu on this unit. Do not assume all Uhale hidden menus behave alike.

The hidden Settings and local-terminal approach was informed by the
[Quokka Uhale security assessment, Appendix J](https://go.quokka.io/hubfs/App-Intel/Technical_Uhale-Digital-Picture-Frame-Security-Assessment.pdf).

## Verified backup before system changes

The backup is stored privately on the host, not on the SD card:

- First 3,334,144 eMMC sectors: 1,707,081,728 bytes (1628 MiB), covering the
  firmware partitions before this unit's userdata partition.
- Both 4 MiB eMMC boot areas and the final 33 sectors containing the secondary GPT.
- Exact byte counts, SHA-256, complete gzip readback, and checks for `0xCC` filler.
- Independent re-reads matched the boot partition, recovery partition, and a
  16 MiB system sample.
- Original ADB key files, package state, build properties, WebView APK,
  framework resources, and APKs of disabled apps were also saved separately.

This excludes userdata and is **not a full backup of personal photos or app data**.
An offline flash restore has not been tested. Derive partition boundaries from
each device's GPT; these numbers are observations, not generic dump commands.
The old toolbox `dd` failed when seeking near the end of the 16 GB eMMC;
`toybox dd` read the secondary GPT successfully.

## Why ADB authorization disappeared

This unit's `/init.sc8830.rc` contains:

```text
on post-fs-data
    copy /system/etc/security/adb_keys /data/misc/adb/adb_keys
```

The factory source exactly matched the key file recovered after reboot. Adding
a public key only to `/data/misc/adb/adb_keys` therefore lasted until the next boot.

After verifying the backup, we preserved the original keys and added the host's
public key to **`/system/etc/security/adb_keys`** as well. The source file has
owner `root:root`, mode `0644`, and SELinux type `system_file`. The active data
file retains its Android ADB ownership, mode, and label. Readback matched the
prepared file; `/system` was remounted read-only. Never put a private `adbkey`
on the device. Keep both original files for undo.

MTP + ADB (`persist.sys.usb.config=mtp,adb`) survives controlled reboot on this
unit. Home HQ also has an **opt-in**, exact-model boot workaround that restores
MTP + ADB using the shipped `su`:

```sh
adb -d shell am start -n com.wesbos.homehq/.MainActivity --ez keep_usb true
```

Use `--ez keep_usb false` to turn that workaround off. It does not import keys or
enable network ADB. The workaround is gated on `SI006` and `sp7731g_1h10` and is
disabled by default. SELinux remains enforcing.

This firmware also had `service.adb.tcp.port=5555` in `/system/build.prop`.
Setting only `persist.adb.tcp.port=-1` did **not** prevent the service property
from re-enabling network ADB after reboot. With the original build properties
backed up, that one line was changed to `service.adb.tcp.port=-1`; ownership,
mode, and label were preserved, and readback matched. `adb usb` restarted the
daemon in USB-only mode. Restore the backed-up file to undo this change.
The final reboot reported both TCP properties as `-1`, with no port-5555
listener in either `/proc/net/tcp` or `/proc/net/tcp6`. USB ADB still connected.

The earlier unexpected reboot reported boot mode `wdgreboot`. Its trigger is
unresolved; no useful last-kernel log was available. It happened during read-only
hardware queries and should not be described as a proven fix for a watchdog bug.

## WebView: different from the other frames

The factory WebView is version **80.0.3987.132**, package
`com.google.android.webview`, re-signed by the vendor. The framework's
`config_webViewPackageName` also names `com.google.android.webview`. A normal
Google-signed update conflicts with the vendor signature; the other frames'
`com.android.webview` replacement recipe cannot be applied unchanged.

The bundled dashboard initially showed only its sidebar. WebView debugging
confirmed a JavaScript syntax error in the Chromium-106-targeted bundle.

The working solution on this unit:

1. Install the ARMv7 standalone `com.android.webview` 106.0.5249.126 APK as a
   normal data app. Package Manager extracts its native libraries, keeping the
   small system partition free.
2. Build the small [resource overlay](../scripts/si006-webview-overlay/) and put
   its APK in `/system/vendor/overlay/si006-webview-overlay.apk`, owned by root,
   mode `0644`, SELinux type `system_file`. It changes only
   `android:string/config_webViewPackageName` to `com.android.webview`.
3. Before reboot, `idmap --path` successfully mapped exactly that one resource
   against this unit's actual `framework-res.apk`. At boot, Android scanned the
   trusted `/vendor/overlay` directory and generated the resource mapping.
4. After reboot, logcat reported `Loading com.android.webview version
   106.0.5249.126`; the dashboard's user agent also reported Chrome 106.

The original WebView and `framework-res.apk` remain intact. To undo the provider
change, remove this overlay APK and reboot **before** uninstalling the new
WebView. Do not uninstall the selected provider while the overlay is active.

This follows Android 6's resource-based provider selection; see
[Chromium's system integration documentation](https://chromium.googlesource.com/chromium/src/+/d4afc97b7/android_webview/docs/aosp-system-integration.md)
and [Android 6 PackageManagerService](https://android.googlesource.com/platform/frameworks/base/+/android-6.0.1_r81/services/core/java/com/android/server/pm/PackageManagerService.java).

## Fonts and HTTPS photos

The old trust store rejected the dashboard's external fonts and photos with
`ERR_CERT_AUTHORITY_INVALID`. Three public roots were obtained from their
official CA repositories, matched against roots already trusted by the Linux
host, and added to `/system/etc/security/cacerts/` with mode `0644`, root ownership,
and the original directory's SELinux type:

| Certificate | Android filename | SHA-256 of DER certificate |
| --- | --- | --- |
| [GTS Root R1](https://pki.goog/repo/certs/gtsr1.pem) | `f013ecaf.0` | `d947432abde7b7fa90fc2e6b59101b1280e0e1c7e4e40fa3c6887fff57a7f4cf` |
| [GTS Root R4](https://pki.goog/repo/certs/gtsr4.pem) | `5acf816d.0` | `349dfa4058c5e263123b398ae795573c4e1313c83fe68f93556cd5e8031b3c7d` |
| [ISRG Root X1](https://letsencrypt.org/certs/isrgrootx1.pem) | `6187b673.0` | `96bcec06264976f37460779acf28c5a7cfe8a3c0aae11a8ffcee05c0bddf08c6` |

These files were absent on this unit. Check for filename collisions on another
device; do not overwrite an existing certificate based only on its short hash.
After restarting Home HQ, Archivo, Instrument Serif, and sample photos loaded
correctly. No certificate checks were bypassed. This is a targeted compatibility
update, not a complete modernization of Android's trust store.

## Dashboard, launcher, and disabled apps

Installed Rootless Pixel Launcher 3.9.1 as an escape route, Firefox 143.0.4 ARMv7,
and the repo's Home HQ kiosk with the dashboard bundled in its APK:

```sh
cd dashboard
npm ci
npm run build
ANDROID_HOME=/path/to/android-sdk KIOSK_BUNDLE=1 bash kiosk/build.sh
adb -d install -r kiosk/build/homehq.apk
adb -d shell am start -n com.wesbos.homehq/.MainActivity --ez keep_usb true
```

The kiosk build used JDK 17, Android build-tools 34.0.0, and platform 34. This host's
JDK 21 caused D8 compilation errors; JDK 17 built successfully. Select **Home HQ →
Always** in Android's Home chooser. Home HQ also starts on `BOOT_COMPLETED`.
The two-finger hold opens a native menu with **Open launcher**, **Android settings**,
and **Reload dashboard**, avoiding a loop back into the kiosk when it is default Home.
The gesture works only inside Home HQ. This firmware still showed no system
navigation bar with `qemu.hw.mainkeys=0`, so opening launcher settings or Android
Settings initially left the owner without a way back. Home HQ 1.2 adds an optional
**Home HQ navigation** accessibility service: floating **Back** and **Dashboard**
buttons outside the kiosk. Drag the dots to move them. They hide when Home HQ is
active and return when it pauses. Enable it in Android **Settings → Accessibility**;
disable that service to undo. The service requests no screen-content access or
accessibility events and uses Android's global Back action. It was enabled on
this unit while preserving the original accessibility settings for rollback.
On-device checks passed for Back from Wi-Fi to Settings, Dashboard from both
Android Settings and launcher Home settings, dragging the buttons, and returning
automatically after a further reboot. The buttons were absent inside the kiosk.
The APK serves local dashboard assets from `https://appassets.androidplatform.net/`;
no PC web server or SD card is required. Fonts and sample photos still need internet.

For a hosted dashboard, Home HQ 1.3 remembers the HTTP(S) URL supplied with its
VIEW intent across app restarts and boot. On this SI006, starting the hosted page
at boot produced `net::ERR_ADDRESS_UNREACHABLE`; reloading after Wi-Fi connected
worked. Home HQ 1.4 retries failed main-page network loads every five seconds,
with a **Waiting for dashboard** screen and **Retry now** button. Retries stop
when the page loads, when another URL is selected, or when the activity is
destroyed; they pause while Android Settings or another app is in front.
Temporary HTTP server errors also retry. Failed images and API requests do not
reload the whole page, and certificate errors retain WebView's default handling.
This follows the boot-race fix suggested in [upstream PR #9](https://github.com/wesbos/photo-frame-dashboard/pull/9),
adapted for bundled assets and the native controls. To select a host, substitute
an address that the frame can resolve:

```sh
adb -d shell am start -a android.intent.action.VIEW -d http://SERVER:8099/ -n com.wesbos.homehq/.MainActivity
# Return to the bundled dashboard:
adb -d shell am start -n com.wesbos.homehq/.MainActivity --ez reset_url true
```

On-device 1.4 checks passed: loading with Wi-Fi disabled showed the waiting screen
and repeated retries; enabling Wi-Fi brought back the live dashboard without a
tap or further reloads. A temporary HTTP 503 also recovered, a failed image did
not restart the page, and changing URLs cancelled the old retry. A normal reboot
reproduced five network failures before loading the live dashboard automatically
about one minute after the reboot command. Navigation stayed enabled, and WebView
debugging was turned off after testing.

After backing up their APKs and package state, these packages were disabled with
`pm disable-user --user 0` and force-stopped. Their files and data remain for undo:

```text
com.zeasn.frame
com.adups.fota
com.adups.fota.sysoper
com.fota.wirelessupdate
net.nault.nobel
com.sprd.systemupdate
com.cghs.stresstest
com.zediel.pcbtest
com.rainbow.xk4
com.mobile.applock.xk1
com.mobile.applock.xk3
```

For these previously enabled packages, undo is `adb -d shell pm enable PACKAGE`.
Do not disable shared Android services merely because they have a vendor-looking
name. Core Settings, SystemUI, networking, media, and storage services remain enabled.

Downloads used (keep APKs out of the PR):

| App | Source | SHA-256 of APK |
| --- | --- | --- |
| Rootless Launcher | [F-Droid, version 30911](https://f-droid.org/repo/amirz.rootless.nexuslauncher_30911.apk) | `7fa44d560dc4577374d45176220de2c0b00a71e09d6d148cdea4e0a52d38404a` |
| Firefox 143.0.4 ARMv7 | [Mozilla archive](https://archive.mozilla.org/pub/fenix/releases/143.0.4/android/fenix-143.0.4-android-armeabi-v7a/fenix-143.0.4.multi.android-armeabi-v7a.apk) | `af560738627d4efc9ace75e708fc48aad6a24c78ef43a89daca27e16ff3829f8` |
| WebView 106 ARMv7 | [LineageOS prebuilt at 4b0ae494a7dd](https://raw.githubusercontent.com/LineageOS/android_external_chromium-webview_prebuilt_arm/4b0ae494a7dd/webview.apk) | `e2edc1f89ec1608b169da9e7ffc037190b70c7825f0be29694f4cae719980580` |

## Limits and remaining work

On-device validation covered all seven tabs with injected touch taps, loaded
fonts and photos, and no JavaScript or network errors during that check. The
two-finger hold opened the native controls; both launcher and Settings entries
worked, and Home returned to the dashboard. Three controlled reboots preserved the
host key, disabled-app state, and automatic Home HQ startup without an SD card.
WebView remote debugging is off for ordinary launches and after reboot.

- The dashboard is the repo's **prototype with mock data**, including a demo
  clock starting at 3:18 PM. Long-press its sidebar clock for demo controls and
  **Real time**. Calendars, weather, chores, cameras, and home controls are not
  connected to the owner's services.
- Android remains **6.0**. No verified newer firmware for this exact board was
  found; another frame's ROM or a generic system image is not an established
  upgrade path. The old OS and root-enabled firmware remain unsuitable for
  sensitive accounts or exposure to untrusted networks.
- Firefox and WebView versions are chosen for compatibility, not current browser
  security support. They do not make this an up-to-date Android device.
- The watchdog reboot's cause and an offline firmware restore path remain untested.
- A reusable, parameterized initial ADB key-import helper would improve the guide.

Raw diagnostics, photos, keys, dumps, and vendor APKs stay in ignored local
directories. Do not include serial numbers, network addresses, or device dumps
in a PR.
