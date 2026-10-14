# Art frame experiment

Branch: `experiment/mado-art-display`.

This first experiment borrows the visual direction of
[Mado](https://github.com/abradburne/mado): a picture-led display, colours from
the current image, and a quiet side panel. The implementation here is original
JavaScript/CSS for our existing dashboard; no native Mado code is imported.

Tap the sidebar clock and choose **Screensaver style → Art frame**. The same
setting appears in server Settings → Display. **Classic photos** remains the
default and retains its hollow clock. The night schedule is unchanged.

Art frame uses the existing photo collection, a stacked clock and weather rail,
and an **At a glance** panel with calendar, shopping and current-routine chores
(including Anytime chores). Tap a note to open that dashboard page. Next picture
advances the slideshow; Dashboard returns to Today. No agent feed is required.

Image colours are sampled locally from an 8×8 canvas. Same-origin hub photos use
the already displayed image. Public demo images can use a CORS thumbnail; failed
or unreadable images retain a neutral palette. No photograph or sampled colour
is sent to an external analysis service. Background/text colours remain within
fixed dark/light ranges for readability. Reduced motion disables transitions.

The setting currently follows the hub's shared display settings, as themes and
idle timers already do. Device-specific profiles are a separate future change.
Museum artwork sources, notifications and a native renderer are not included in
this first experiment. Preview screenshots use the existing synthetic demo data;
real household and proprietary project data are not part of this branch.
