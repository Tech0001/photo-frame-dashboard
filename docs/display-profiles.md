# Display profiles in Hub

Household data stays shared. Each display has a stable browser identity and a
profile containing its tabs, theme, screensaver style and idle timers.

Open **Hub → Display → Displays** to name displays and assign profiles. Under
**Profiles**, edit a profile or add one. **Swap profiles** exchanges the profile
assignments of two displays without moving their household data or app logins.
Changes appear on the next normal state refresh; no ADB connection is required.

The dashboard registers automatically on its first load. Android 6 frames start
with Household (household tabs). Other displays start with Personal (all available
tabs). Assign the profile you want in Hub. Profiles are presentation preferences,
not access controls: household API data remains available on your LAN.

A browser stores its generated identity in local storage. Clearing browser/app
storage gives it a new identity. A kiosk can use a stable named identity instead
by saving a URL such as `http://YOUR-HUB:8099/?display=kitchen`.

**Defaults** supplies values to newly created profiles. Editing a profile's theme
or timers, including through the clock settings on a registered display, changes
that profile only. Displays intentionally sharing a profile share those settings.
Weather and grocery/chores data remain shared.

Spotify is a native app shortcut, and needs Spotify installed and signed in on
that device. Profile swapping does not transfer Spotify logins. Voice needs the
optional voice integration and the updated kiosk for microphone capture.

Profiles and assignments live in the household state file and its normal backups.
Registration records last-seen addresses in memory; presence is approximate and
means the dashboard recently checked in, not proof that a person is present.
