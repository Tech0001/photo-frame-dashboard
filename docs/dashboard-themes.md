# Dashboard themes

In the hub's **Settings → Display → Dashboard theme**, choose a theme from
the menu or select its color preview. Choices save automatically and reach
connected frames on their next normal poll; a reboot is not needed.

- **Paper:** the original warm paper palette, still the default.
- **Charcoal:** dark gray with a quiet sage accent.
- **Sakura Mochi:** pink and green on midnight, adapted from the installed
  Omarchy Sakura Mochi palette.
- **Mechanoonna:** cream and aged brass on deep brown, adapted from the
  installed Omarchy Mechanoonna palette.
- **Autumn:** warm parchment and burnt orange.
- **Winter:** deep blue, snow white, and a muted icy blue accent.

Themes change colors, keeping the layout, font sizes and touch targets.
Person colors remain distinct; black accents use readable light ink on dark
themes. Text and navigation contrast is checked for the new palettes.
Choose **Paper** or **Default: Paper** to restore the original colors.

Photos, the hollow white screensaver clock/temperature, and the dim red night
clock keep their own colors. The 10 PM–6 AM night schedule is independent of
theme selection. Seasonal choices are manual; there is no seasonal rotation.

`dashboard/js/theme-palettes.json` supplies both the server's validated choices
and the frame's color values. `dashboard/js/themes.js` applies those colors to
the stage when live settings arrive. Paper removes all palette overrides so
the original stylesheet remains authoritative.
