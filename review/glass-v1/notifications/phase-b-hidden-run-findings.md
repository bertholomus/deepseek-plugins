# Phase B, run 1 (hidden) — evidence + findings (Lead, 2026-10-18 8:00 PM PDT)

Run: phase-b.sh hidden, DSH Test glass-notifications pid 7357, app hidden via System Events
(visible=false, verified false) at ~7:45:5x PM PDT before the run. Script burst: pending polls at
+10..+160 s. Lead desktop burst: 22 full-screen frames at ~3 s spacing, /tmp/dshn-burst-*.png,
covering ~7:47:00-7:48:09 PM PDT (frames 13/19 + the NC zooms are copied here).

Trace (from phase-b): pending empty +10 s through +80 s; item `"Icon proof 1" handed back`
(at=2026-10-19T02:46:24.509Z = 7:46:24 PM PDT) present +100 s through +160 s; empty at the
Lead's manual probe ~7:47:5x. So the item was QUEUED ~7:46:24 PM and the hidden window's
renderer did NOT take it for >= 80 s (it persisted across five polls), then drained silently
between the +160 s poll and 7:47:5x.

No banner: zero of the 13 frames covering the drain window (7:47:00-7:48:09) show a macOS
banner (pixel-diff of the top-right 2400x700 px region across frames: only clock/cursor noise).
Notification Center, opened 8:01 PM: no "Icon proof 1" entry anywhere (only an unrelated
Script Editor entry for the WALLPAPER thread handback — that is the LIVE DSH's old plugin
falling back to osascript, expected until install — plus Home entries).

Conclusion: the hidden-window path fails at renderer poll latency. The host queue correctly
holds the item (no osascript fallback fired for the test instance — that half of the fix
works), but the renderer's poller is throttled/dead while the window is hidden, so the item
is taken late and silently. Candidate fixes (t1's call): webPreferences.backgroundThrottling
:false for the DSH window; move the poller to a Web Worker; or host push over the existing
typert channel instead of renderer polling. Frames kept: hidden-burst-frame-*.png;
center-after-hidden-run.png. Next: the minimised run is NOT meaningful until the hidden case
delivers — t1 to fix and re-run.
