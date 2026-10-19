# Lead GUI notes for the display-verdict click (2026-10-19 3:00 AM PDT)

The app window is ON SCREEN, visible, on the Plugins list page (Installed plugins section,
Notifications row visible). pid 4848, window_id 20261.

What works (verified): cua get_window_state(pid, window_id) with a session label; the returned
PNG is 1568x1005 but click x/y are in the RAW 2x pixel space (3136x2010) — click positions are
preview_x*2, preview_y*2. The Plugins sidebar row navigated with click x=150 y=422 (raw).

What failed: background px clicks on the Notifications row report "pressed the background
element via AX" and never navigate; a real foreground HID click at the row's title also did
not navigate (three attempts). The zoom tool's coordinate mapping is inconsistent with the
preview scale — do not trust it for this window.

The click that remains: open the plugin's detail page (click the Notifications ROW — maybe its
title text exactly, or it needs the row's own button element), then click "Send a test
notification" (added in 44eb6f8; the button is in the dshn-section[data-notifications-test]
block at the top of the plugin's settings panel). The verdict line appears right there and the
same info is written to the app renderer's localStorage (SHOW_ERROR_KEY) — greppable in
~/.dsh-test-glass-notifications-electron/Local Storage/leveldb (scan ASCII + UTF-16LE).

Albert can also just click it by hand: the window is frontmost-center of the screen.
